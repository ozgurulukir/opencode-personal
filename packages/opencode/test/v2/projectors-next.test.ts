import { afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import * as DateTime from "effect/DateTime"
import projectorsNext, { sqlite } from "@/session/projectors-next"
import { Session } from "@/session/session"
import { SyncEvent } from "@/sync"
import { SessionMessage } from "@/v2/session-message"
import { Modelv2 } from "@/v2/model"
import { SessionEvent } from "@/v2/session-event"
import { SessionMessageTable } from "@/session/session.sql"
import { EventSequenceTable } from "@/sync/event.sql"
import { EventID } from "@/sync/schema"
import { Database, eq } from "@/storage/db"
import { Flag } from "@opencode-ai/core/flag/flag"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { initProjectors } from "@/server/projectors"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as Log from "@opencode-ai/core/util/log"

/**
 * Characterization lock for the projector registry: every SessionEvent.* Sync
 * definition must keep a registration in projectors-next, otherwise
 * SyncEvent.run throws "Projector not found" when the event is published.
 */
const expectedTypes = [
  "session.next.agent.switched",
  "session.next.model.switched",
  "session.next.prompted",
  "session.next.synthetic",
  "session.next.shell.started",
  "session.next.shell.ended",
  "session.next.step.started",
  "session.next.step.ended",
  "session.next.step.failed",
  "session.next.text.started",
  "session.next.text.delta",
  "session.next.text.ended",
  "session.next.tool.input.started",
  "session.next.tool.input.delta",
  "session.next.tool.input.ended",
  "session.next.tool.progress",
  "session.next.tool.called",
  "session.next.tool.success",
  "session.next.tool.failed",
  "session.next.reasoning.started",
  "session.next.reasoning.delta",
  "session.next.reasoning.ended",
  "session.next.retried",
  "session.next.compaction.started",
  "session.next.compaction.delta",
  "session.next.compaction.ended",
  "session.next.deleted",
  "session.next.diff",
  "session.next.permission.asked",
  "session.next.permission.replied",
  "session.next.status",
  "session.next.todo",
  "session.next.updated",
]

describe("projectors-next registry", () => {
  it("registers exactly one projector per known SessionEvent Sync type", () => {
    const types = projectorsNext.map(([def]) => def.type).sort()
    expect(types).toEqual([...expectedTypes].sort())
    const unique = new Set(projectorsNext.map(([def]) => def.type))
    expect(unique.size).toBe(projectorsNext.length)
  })
})

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const env = Layer.mergeAll(Session.defaultLayer, SyncEvent.defaultLayer, CrossSpawnSpawner.defaultLayer)
const effectIt = testEffect(env)

// Importing the projectors module registers the real projector map, but do it
// again after every module has been evaluated so no V2 definition is missed by
// module-eval ordering.
beforeAll(() => {
  initProjectors()
})

afterEach(async () => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
})

describe("projectors-next datetime revival", () => {
  effectIt.live(
    "replayed ISO timestamps reach the projector as DateTime.Utc",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const sessions = yield* Session.Service
        const sync = yield* SyncEvent.Service
        const info = yield* sessions.create({ title: "projector" })

        const latest = Database.use((db) =>
          db
            .select({ seq: EventSequenceTable.seq })
            .from(EventSequenceTable)
            .where(eq(EventSequenceTable.aggregate_id, info.id))
            .get(),
        )
        const millis = Date.parse("2024-01-02T03:04:05.000Z")

        // Replay the legacy wire form (ISO string) with a fresh id and the next
        // seq so `process()` actually executes the projector.
        yield* sync.replay({
          id: EventID.ascending(),
          aggregateID: info.id,
          seq: (latest?.seq ?? -1) + 1,
          type: "session.next.synthetic.1",
          data: { sessionID: info.id, timestamp: "2024-01-02T03:04:05.000Z", text: "hello" },
        })

        const row = Database.use((db) =>
          db
            .select()
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.session_id, info.id))
            .all()
            .find((item) => item.type === "synthetic"),
        )
        expect(row).toBeDefined()
        if (!row) return

        const message = Schema.decodeUnknownSync(SessionMessage.Message)(
          SessionMessage.normalizeForDecode({ ...row.data, id: row.id, type: row.type }),
        )
        expect(message.type).toBe("synthetic")
        if (message.type !== "synthetic") return
        expect(DateTime.isUtc(message.time.created)).toBe(true)
        expect(DateTime.toEpochMillis(message.time.created)).toBe(millis)

        // The persisted row is now in the encoded (millis) form.
        const data = row.data as unknown as { time: { created: unknown } }
        expect(data.time.created).toBe(millis)
      }),
    ),
  )
})

describe("projectors-next poisoned read-model resilience", () => {
  const testModel = {
    id: Modelv2.ID.make("test-model"),
    providerID: Modelv2.ProviderID.make("test-provider"),
    variant: Modelv2.VariantID.make("default"),
  }

  effectIt.live(
    "skips an undecodable assistant row instead of poisoning the session",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const sessions = yield* Session.Service
        const sync = yield* SyncEvent.Service
        const info = yield* sessions.create({ title: "poisoned" })

        yield* sync.run(SessionEvent.Step.Started.Sync, {
          sessionID: info.id,
          timestamp: DateTime.makeUnsafe(Date.now()),
          agent: "build",
          model: testModel,
        })

        // Corrupt the assistant row so every decode of it throws.
        const assistantRow = Database.use((db) =>
          db
            .select()
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.session_id, info.id))
            .all()
            .find((item) => item.type === "assistant"),
        )
        expect(assistantRow).toBeDefined()
        if (!assistantRow) return
        Database.use((db) =>
          db
            .update(SessionMessageTable)
            .set({ data: { broken: true } as unknown as (typeof SessionMessageTable.$inferInsert)["data"] })
            .where(eq(SessionMessageTable.id, assistantRow.id))
            .run(),
        )

        // Every projector event reads the current assistant; with the corrupt
        // row present this must still succeed (the row is skipped, not fatal).
        yield* sync.run(SessionEvent.Text.Started.Sync, {
          sessionID: info.id,
          timestamp: DateTime.makeUnsafe(Date.now()),
        })

        // A new assistant after the corrupt row must be found and projected.
        yield* sync.run(SessionEvent.Step.Started.Sync, {
          sessionID: info.id,
          timestamp: DateTime.makeUnsafe(Date.now()),
          agent: "build",
          model: testModel,
        })
        yield* sync.run(SessionEvent.Text.Started.Sync, {
          sessionID: info.id,
          timestamp: DateTime.makeUnsafe(Date.now()),
        })

        const rows = Database.use((db) =>
          db
            .select()
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.session_id, info.id))
            .all()
            .filter((item) => item.type === "assistant"),
        )
        expect(rows).toHaveLength(2)
        const healthy = rows[1]
        const decoded = Schema.decodeUnknownSync(SessionMessage.Message)(
          SessionMessage.normalizeForDecode({ ...healthy.data, id: healthy.id, type: healthy.type }),
        )
        expect(decoded.type).toBe("assistant")
        if (decoded.type !== "assistant") return
        expect(decoded.content.some((item) => item.type === "text")).toBe(true)
      }),
    ),
  )

  effectIt.live(
    "warns when a read-model update matches no rows",
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
        const sessions = yield* Session.Service
        const info = yield* sessions.create({ title: "no-row-update" })

        const warns = spyOn(Log.create({ service: "session.projectors" }), "warn")
        try {
          const adapter = Database.use((db) => sqlite(db, info.id))
          // An append event that never landed leaves no row; the update must
          // not silently vanish — it logs a zero-changes warning.
          adapter.updateAssistant({
            id: "msg_missing",
            type: "assistant",
            time: { created: DateTime.makeUnsafe(Date.now()) },
            content: [],
          } as unknown as Parameters<typeof adapter.updateAssistant>[0])

          expect(warns.mock.calls.some(([message]) => message === "session message update matched no rows")).toBe(true)
        } finally {
          warns.mockRestore()
        }
      }),
    ),
  )
})
