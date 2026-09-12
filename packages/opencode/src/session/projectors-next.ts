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

const decodeMessage = (data: unknown) =>
  Schema.decodeUnknownSync(SessionMessage.Message)(SessionMessage.normalizeForDecode(data))
type SessionMessageData = NonNullable<(typeof SessionMessageTable.$inferInsert)["data"]>

function encodeMessageData(value: unknown): SessionMessageData {
  return SyncEvent.encodeDateTimes(value) as SessionMessageData
}

function sqlite(db: Database.TxOrDb, sessionID: SessionID): SessionMessageUpdater.Adapter<void> {
  return {
    getCurrentAssistant() {
      return db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "assistant")))
        .orderBy(desc(SessionMessageTable.id))
        .all()
        .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
        .find((message): message is SessionMessage.Assistant => message.type === "assistant" && !message.time.completed)
    },
    getCurrentCompaction() {
      return db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "compaction")))
        .orderBy(desc(SessionMessageTable.id))
        .all()
        .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
        .find((message): message is SessionMessage.Compaction => message.type === "compaction")
    },
    getCurrentShell(callID) {
      return db
        .select()
        .from(SessionMessageTable)
        .where(and(eq(SessionMessageTable.session_id, sessionID), eq(SessionMessageTable.type, "shell")))
        .orderBy(desc(SessionMessageTable.id))
        .all()
        .map((row) => decodeMessage({ ...row.data, id: row.id, type: row.type }))
        .find((message): message is SessionMessage.Shell => message.type === "shell" && message.callID === callID)
    },
    updateAssistant(assistant) {
      const { id, type, ...data } = assistant
      db.update(SessionMessageTable)
        .set({ data: encodeMessageData(data) })
        .where(
          and(
            eq(SessionMessageTable.id, id),
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, type),
          ),
        )
        .run()
    },
    updateCompaction(compaction) {
      const { id, type, ...data } = compaction
      db.update(SessionMessageTable)
        .set({ data: encodeMessageData(data) })
        .where(
          and(
            eq(SessionMessageTable.id, id),
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, type),
          ),
        )
        .run()
    },
    updateShell(shell) {
      const { id, type, ...data } = shell
      db.update(SessionMessageTable)
        .set({ data: encodeMessageData(data) })
        .where(
          and(
            eq(SessionMessageTable.id, id),
            eq(SessionMessageTable.session_id, sessionID),
            eq(SessionMessageTable.type, type),
          ),
        )
        .run()
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
