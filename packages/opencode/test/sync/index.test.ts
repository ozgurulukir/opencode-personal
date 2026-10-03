import { describe, expect, beforeEach, afterEach, afterAll } from "bun:test"
import { provideTmpdirInstance } from "../fixture/fixture"
import { Effect, Layer, Schema } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Bus } from "../../src/bus"
import { GlobalBus } from "../../src/bus/global"
import { SyncEvent } from "../../src/sync"
import { Database } from "@/storage/db"
import { EventSequenceTable, EventTable } from "../../src/sync/event.sql"
import { MessageID } from "../../src/session/schema"
import { Flag } from "@opencode-ai/core/flag/flag"
import { initProjectors } from "../../src/server/projectors"
import { testEffect } from "../lib/effect"

const original = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const it = testEffect(Layer.mergeAll(SyncEvent.defaultLayer, CrossSpawnSpawner.defaultLayer))

beforeEach(() => {
  Database.close()

  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
})

afterEach(() => {
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = original
})

describe("SyncEvent", () => {
  function setup() {
    SyncEvent.reset()

    const Created = SyncEvent.define({
      type: "item.created",
      version: 1,
      aggregate: "id",
      schema: Schema.Struct({ id: Schema.String, name: Schema.String }),
    })
    const Sent = SyncEvent.define({
      type: "item.sent",
      version: 1,
      aggregate: "item_id",
      schema: Schema.Struct({ item_id: Schema.String, to: Schema.String }),
    })
    const Tick = SyncEvent.define({
      type: "item.tick",
      version: 1,
      aggregate: "item_id",
      persist: false,
      schema: Schema.Struct({ item_id: Schema.String }),
    })

    SyncEvent.init({
      projectors: [
        SyncEvent.project(Created, () => {}),
        SyncEvent.project(Sent, () => {}),
        SyncEvent.project(Tick, () => {}),
      ],
    })

    return { Created, Sent, Tick }
  }

  function expectDefect<A, E, R>(effect: Effect.Effect<A, E, R>, pattern: RegExp) {
    return Effect.gen(function* () {
      const exit = yield* Effect.exit(effect)
      if (exit._tag === "Success") throw new Error("Expected effect to fail")
      expect(String(exit.cause)).toMatch(pattern)
    })
  }

  afterAll(() => {
    SyncEvent.reset()
    initProjectors()
  })

  describe("run", () => {
    it.live(
      "inserts event row",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          yield* SyncEvent.use.run(Created, { id: "evt_1", name: "first" })
          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows).toHaveLength(1)
          expect(rows[0].type).toBe("item.created.1")
          expect(rows[0].aggregate_id).toBe("evt_1")
        }),
      ),
    )

    it.live(
      "increments seq per aggregate",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          yield* SyncEvent.use.run(Created, { id: "evt_1", name: "first" })
          yield* SyncEvent.use.run(Created, { id: "evt_1", name: "second" })
          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows).toHaveLength(2)
          expect(rows[1].seq).toBe(rows[0].seq + 1)
        }),
      ),
    )

    it.live(
      "uses custom aggregate field from agg()",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Sent } = setup()
          yield* SyncEvent.use.run(Sent, { item_id: "evt_1", to: "james" })
          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows).toHaveLength(1)
          expect(rows[0].aggregate_id).toBe("evt_1")
        }),
      ),
    )

    it.live(
      "emits events",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          const events: Array<{
            type: string
            properties: { id: string; name: string }
          }> = []
          let resolve = () => {}
          const received = new Promise<void>((done) => {
            resolve = done
          })
          const dispose = Bus.subscribeAll((event) => {
            events.push(event)
            resolve()
          })
          try {
            yield* SyncEvent.use.run(Created, { id: "evt_1", name: "test" })
            yield* Effect.promise(() => received)
            expect(events).toHaveLength(1)
            expect(events[0]).toMatchObject({
              type: "item.created",
              properties: {
                id: "evt_1",
                name: "test",
              },
            })
          } finally {
            dispose()
          }
        }),
      ),
    )

    it.live(
      "a throwing global-bus listener does not fail run",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          // GlobalBus is a plain EventEmitter: a listener throw propagates to
          // the emitter inside the post-commit publish effect. The event is
          // already committed at that point, so `run` must still succeed.
          const listener = () => {
            throw new Error("global bus boom")
          }
          GlobalBus.on("event", listener)
          try {
            yield* SyncEvent.use.run(Created, { id: "evt_1", name: "isolated" })
          } finally {
            GlobalBus.off("event", listener)
          }

          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows).toHaveLength(1)
          expect(rows[0].aggregate_id).toBe("evt_1")
        }),
      ),
    )

    it.live(
      "emits but does not persist ephemeral (persist: false) events",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created, Tick } = setup()

          const events: string[] = []
          let resolve = () => {}
          const received = new Promise<void>((done) => {
            resolve = done
          })
          const dispose = Bus.subscribeAll((event) => {
            events.push(event.type)
            if (events.length === 3) resolve()
          })
          try {
            yield* SyncEvent.use.run(Created, { id: "evt_1", name: "durable" })
            yield* SyncEvent.use.run(Tick, { item_id: "evt_1" })
            yield* SyncEvent.use.run(Tick, { item_id: "evt_1" })
            yield* Effect.promise(() => received)
          } finally {
            dispose()
          }

          // Ephemeral events reach subscribers but leave no trace in the log.
          expect(events).toEqual(["item.created", "item.tick", "item.tick"])
          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows.map((row) => row.type)).toEqual(["item.created.1"])
          const sequence = Database.use((db) => db.select().from(EventSequenceTable).all())
          expect(sequence).toHaveLength(1)
        }),
      ),
    )
  })

  describe("replay", () => {
    it.live(
      "inserts event from external payload",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const id = MessageID.ascending()
          yield* SyncEvent.use.replay({
            id: "evt_1",
            type: "item.created.1",
            seq: 0,
            aggregateID: id,
            data: { id, name: "replayed" },
          })
          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows).toHaveLength(1)
          expect(rows[0].aggregate_id).toBe(id)
        }),
      ),
    )

    it.live(
      "throws on sequence mismatch",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const id = MessageID.ascending()
          yield* SyncEvent.use.replay({
            id: "evt_1",
            type: "item.created.1",
            seq: 0,
            aggregateID: id,
            data: { id, name: "first" },
          })
          yield* expectDefect(
            SyncEvent.use.replay({
              id: "evt_1",
              type: "item.created.1",
              seq: 5,
              aggregateID: id,
              data: { id, name: "bad" },
            }),
            /Sequence mismatch/,
          )
        }),
      ),
    )

    it.live(
      "throws on unknown event type",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          yield* expectDefect(
            SyncEvent.use.replay({
              id: "evt_1",
              type: "unknown.event.1",
              seq: 0,
              aggregateID: "x",
              data: {},
            }),
            /Unknown event type/,
          )
        }),
      ),
    )

    it.live(
      "replayAll accepts later chunks after the first batch",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          const id = MessageID.ascending()

          const one = yield* SyncEvent.use.replayAll([
            {
              id: "evt_1",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 0,
              aggregateID: id,
              data: { id, name: "first" },
            },
            {
              id: "evt_2",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 1,
              aggregateID: id,
              data: { id, name: "second" },
            },
          ])

          const two = yield* SyncEvent.use.replayAll([
            {
              id: "evt_3",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 2,
              aggregateID: id,
              data: { id, name: "third" },
            },
            {
              id: "evt_4",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 3,
              aggregateID: id,
              data: { id, name: "fourth" },
            },
          ])

          expect(one).toBe(id)
          expect(two).toBe(id)

          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows.map((row) => row.seq)).toEqual([0, 1, 2, 3])
        }),
      ),
    )

    it.live(
      "applies concurrent duplicate replays exactly once",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          const id = MessageID.ascending()
          const event = (seq: number) => ({
            id: `evt_${seq}`,
            type: SyncEvent.versionedType(Created.type, Created.version),
            seq,
            aggregateID: id,
            data: { id, name: "duplicated" },
          })

          // Two concurrent sources replaying the same event (e.g. SSE
          // redelivery racing a reconnect history fetch). The seq check and
          // apply are atomic, so the loser sees the event as already applied
          // and skips it instead of double-applying.
          yield* Effect.all([SyncEvent.use.replay(event(0)), SyncEvent.use.replay(event(0))], {
            discard: true,
          })

          const rows = Database.use((db) => db.select().from(EventTable).all())
          expect(rows.map((row) => row.seq)).toEqual([0])
        }),
      ),
    )

    it.live(
      "claims unowned event sequence on replay with ownerID",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          const id = MessageID.ascending()

          yield* SyncEvent.use.replay(
            {
              id: "evt_1",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 0,
              aggregateID: id,
              data: { id, name: "owned" },
            },
            { publish: false, ownerID: "owner-1" },
          )

          const row = Database.use((db) =>
            db
              .select({ seq: EventSequenceTable.seq, ownerID: EventSequenceTable.owner_id })
              .from(EventSequenceTable)
              .get(),
          )
          expect(row).toEqual({ seq: 0, ownerID: "owner-1" })
        }),
      ),
    )

    it.live(
      "ignores replay from a different owner after sequence is claimed",
      provideTmpdirInstance(() =>
        Effect.gen(function* () {
          const { Created } = setup()
          const id = MessageID.ascending()

          yield* SyncEvent.use.replay(
            {
              id: "evt_1",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 0,
              aggregateID: id,
              data: { id, name: "first" },
            },
            { publish: false, ownerID: "owner-1" },
          )
          yield* SyncEvent.use.replay(
            {
              id: "evt_2",
              type: SyncEvent.versionedType(Created.type, Created.version),
              seq: 1,
              aggregateID: id,
              data: { id, name: "ignored" },
            },
            { publish: false, ownerID: "owner-2" },
          )

          const events = Database.use((db) => db.select().from(EventTable).all())
          const sequence = Database.use((db) =>
            db
              .select({ seq: EventSequenceTable.seq, ownerID: EventSequenceTable.owner_id })
              .from(EventSequenceTable)
              .get(),
          )
          expect(events).toHaveLength(1)
          expect(events[0].id).toBe("evt_1")
          expect(sequence).toEqual({ seq: 0, ownerID: "owner-1" })
        }),
      ),
    )
  })
})
