import { afterEach, beforeAll, describe, expect, it } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import * as DateTime from "effect/DateTime"
import projectorsNext from "@/session/projectors-next"
import { Session } from "@/session/session"
import { SyncEvent } from "@/sync"
import { SessionMessage } from "@/v2/session-message"
import { SessionMessageTable } from "@/session/session.sql"
import { EventSequenceTable } from "@/sync/event.sql"
import { EventID } from "@/sync/schema"
import { Database, eq } from "@/storage/db"
import { Flag } from "@opencode-ai/core/flag/flag"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { initProjectors } from "@/server/projectors"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

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
