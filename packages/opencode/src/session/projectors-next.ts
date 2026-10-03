import { and, desc, eq } from "@/storage/db"
import type { Database } from "@/storage/db"
import { SessionMessage } from "@/v2/session-message"
import { SessionMessageUpdater } from "@/v2/session-message-updater"
import { SessionEvent } from "@/v2/session-event"
import * as DateTime from "effect/DateTime"
import { SyncEvent } from "@/sync"
import { SessionMessageTable, SessionTable } from "./session.sql"
import type { SessionID } from "./schema"
import { Schema } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import { errorData } from "@/util/error"

const log = Log.create({ service: "session.projectors" })

const decodeMessage = (data: unknown) =>
  Schema.decodeUnknownSync(SessionMessage.Message)(SessionMessage.normalizeForDecode(data))
type SessionMessageData = NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>
type MessageRow = typeof SessionMessageTable.$inferSelect

function encodeMessageData(value: unknown): SessionMessageData {
  return SyncEvent.encodeDateTimes(value) as SessionMessageData
}

// A single undecodable row (legacy shape, corruption) must not poison every
// later projector call for the session: skip it with a warning and let the
// update paths heal it.
function decodeRow(row: MessageRow) {
  try {
    return decodeMessage({ ...row.data, id: row.id, type: row.type })
  } catch (error) {
    log.warn("skipping undecodable session message row", { id: row.id, type: row.type, error: errorData(error) })
    return undefined
  }
}

// SQLite read-model adapter for the SessionMessageUpdater. Exported for tests
// that exercise the zero-changes warning path directly.
export function sqlite(db: Database.TxOrDb, sessionID: SessionID): SessionMessageUpdater.Adapter<void> {
  const updateRow = (message: SessionMessage.Message) => {
    const { id, type, ...data } = message
    const result = db
      .update(SessionMessageTable)
      .set({ data: encodeMessageData(data) })
      .where(
        and(
          eq(SessionMessageTable.id, id),
          eq(SessionMessageTable.session_id, sessionID),
          eq(SessionMessageTable.type, type),
        ),
      )
      .run()
    // drizzle types the update builder's `.run()` as void, but the bun-sqlite
    // session actually returns the statement's `Changes` result.
    const { changes } = result as unknown as { changes: number }
    if (changes === 0) {
      // A zero-row update means the append event never landed (dropped by a
      // failed replay, or the row was pruned) — recording the update event
      // without the read-model write would silently diverge the read model.
      log.warn("session message update matched no rows", { id, sessionID, type })
    }
  }

  return {
    getCurrentAssistant() {
      const rows = () =>
        db
          .select()
          .from(SessionMessageTable)
          .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "assistant")))
          .orderBy(desc(SessionMessageTable.id))
      const isCurrent = (message: ReturnType<typeof decodeMessage>): message is SessionMessage.Assistant =>
        message.type === "assistant" && !message.time.completed

      // Streaming events fire many times per turn and the in-flight assistant
      // is always the newest row, so decoding just that one keeps the hot path
      // O(1) instead of decoding the full history on every event.
      const latest = rows().limit(1).get()
      if (latest) {
        const message = decodeRow(latest)
        if (message && isCurrent(message)) return message
      }

      // The newest assistant is already completed (or undecodable): fall back
      // to a full newest-first scan to preserve the "latest uncompleted"
      // semantics.
      for (const row of rows().all()) {
        const message = decodeRow(row)
        if (message && isCurrent(message)) return message
      }
      return undefined
    },
    getCurrentCompaction() {
      const rows = db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
        .orderBy(desc(SessionMessageTable.id))
        .all()
      for (const row of rows) {
        const message = decodeRow(row)
        if (message?.type === "compaction") return message
      }
      return undefined
    },
    getCurrentShell(callID) {
      const rows = db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "shell")))
        .orderBy(desc(SessionMessageTable.id))
        .all()
      for (const row of rows) {
        const message = decodeRow(row)
        if (message?.type === "shell" && message.callID === callID) return message
      }
      return undefined
    },
    updateAssistant(assistant) {
      updateRow(assistant)
    },
    updateCompaction(compaction) {
      updateRow(compaction)
    },
    updateShell(shell) {
      updateRow(shell)
    },
    appendMessage(message) {
      const { id, type, ...data } = message
      db.insert(SessionMessageTable)
        .values([
          {
            id,
            session_id: sessionID,
            type,
            time_created: DateTime.toEpochMillis(message.time.created),
            data: encodeMessageData(data),
          },
        ])
        .run()
    },
    finish() {},
  }
}

function update(db: Database.TxOrDb, event: SessionEvent.Event) {
  SessionMessageUpdater.update(sqlite(db, event.data.sessionID), event)
}

/**
 * Registers one projector that funnels the event into SessionMessageUpdater.
 * The `type` argument is the updater's event discriminator; each call site
 * pairs it with `def`, so the correlated-union cast below is safe by
 * construction. Events that also touch SessionTable register explicitly.
 */
function projectNext<Def extends SyncEvent.Definition>(def: Def, type: SessionEvent.Event["type"]) {
  return SyncEvent.project(def, (db, data, event) => {
    update(db, { id: SessionMessage.ID.make(event.id), type, data } as SessionEvent.Event)
  })
}

const noProjector = (def: SyncEvent.Definition) => SyncEvent.project(def, () => {})

export default [
  SyncEvent.project(SessionEvent.AgentSwitched.Sync, (db, data, event) => {
    db.update(SessionTable)
      .set({ agent: data.agent, time_updated: DateTime.toEpochMillis(data.timestamp) })
      .where(eq(SessionTable.id, data.sessionID))
      .run()
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.agent.switched", data })
  }),
  SyncEvent.project(SessionEvent.ModelSwitched.Sync, (db, data, event) => {
    db.update(SessionTable)
      .set({ model: data.model, time_updated: DateTime.toEpochMillis(data.timestamp) })
      .where(eq(SessionTable.id, data.sessionID))
      .run()
    update(db, { id: SessionMessage.ID.make(event.id), type: "session.next.model.switched", data })
  }),
  projectNext(SessionEvent.Prompted.Sync, "session.next.prompted"),
  projectNext(SessionEvent.Synthetic.Sync, "session.next.synthetic"),
  projectNext(SessionEvent.Shell.Started.Sync, "session.next.shell.started"),
  projectNext(SessionEvent.Shell.Ended.Sync, "session.next.shell.ended"),
  projectNext(SessionEvent.Step.Started.Sync, "session.next.step.started"),
  projectNext(SessionEvent.Step.Ended.Sync, "session.next.step.ended"),
  projectNext(SessionEvent.Step.Failed.Sync, "session.next.step.failed"),
  projectNext(SessionEvent.Text.Started.Sync, "session.next.text.started"),
  projectNext(SessionEvent.Text.Ended.Sync, "session.next.text.ended"),
  projectNext(SessionEvent.Tool.Input.Started.Sync, "session.next.tool.input.started"),
  projectNext(SessionEvent.Tool.Input.Ended.Sync, "session.next.tool.input.ended"),
  projectNext(SessionEvent.Tool.Called.Sync, "session.next.tool.called"),
  projectNext(SessionEvent.Tool.Success.Sync, "session.next.tool.success"),
  projectNext(SessionEvent.Tool.Failed.Sync, "session.next.tool.failed"),
  projectNext(SessionEvent.Reasoning.Started.Sync, "session.next.reasoning.started"),
  projectNext(SessionEvent.Reasoning.Ended.Sync, "session.next.reasoning.ended"),
  projectNext(SessionEvent.Retried.Sync, "session.next.retried"),
  projectNext(SessionEvent.Compaction.Started.Sync, "session.next.compaction.started"),
  projectNext(SessionEvent.Compaction.Ended.Sync, "session.next.compaction.ended"),

  // Delta events are too granular to project; clients accumulate them from the
  // event stream. Lifecycle events are already persisted by their source
  // services (SessionTable, todo/diff storage, permission state). The
  // registrations still let SyncEvent.run publish the event instead of
  // throwing "Projector not found".
  noProjector(SessionEvent.Text.Delta.Sync),
  noProjector(SessionEvent.Tool.Input.Delta.Sync),
  noProjector(SessionEvent.Tool.Progress.Sync),
  noProjector(SessionEvent.Reasoning.Delta.Sync),
  noProjector(SessionEvent.Compaction.Delta.Sync),
  noProjector(SessionEvent.Updated.Sync),
  noProjector(SessionEvent.Deleted.Sync),
  noProjector(SessionEvent.StatusUpdated.Sync),
  noProjector(SessionEvent.TodoUpdated.Sync),
  noProjector(SessionEvent.DiffUpdated.Sync),
  noProjector(SessionEvent.Permission.Asked.Sync),
  noProjector(SessionEvent.Permission.Replied.Sync),
]
