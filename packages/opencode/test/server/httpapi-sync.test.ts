import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Context, Effect, DateTime } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { WithInstance } from "../../src/project/with-instance"
import { Server } from "../../src/server/server"
import { SyncPaths } from "../../src/server/routes/instance/httpapi/groups/sync"
import { ExperimentalHttpApiServer } from "../../src/server/routes/instance/httpapi/server"
import { Session } from "@/session/session"
import { SyncEvent } from "@/sync"
import { EventID } from "@/sync/schema"
import { EventSequenceTable } from "@/sync/event.sql"
import { SessionEvent } from "@/v2/session-event"
import { Modelv2 } from "@/v2/model"
import { SessionMessageTable } from "@/session/session.sql"
import type { SessionID } from "@/session/schema"
import { Database, eq } from "@/storage/db"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

const originalWorkspaces = Flag.OPENCODE_EXPERIMENTAL_WORKSPACES
const context = Context.empty() as Context.Context<unknown>

function app() {
  return Server.Default().app
}

function runSession<A, E>(fx: Effect.Effect<A, E, Session.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
}

function runSync<A, E>(fx: Effect.Effect<A, E, SyncEvent.Service>) {
  return Effect.runPromise(fx.pipe(Effect.provide(SyncEvent.defaultLayer)))
}

/** Next seq for an aggregate, bypassing `EventTable`'s primary-key collision. */
function nextSeq(aggregateID: string) {
  const row = Database.use((db) =>
    db
      .select({ seq: EventSequenceTable.seq })
      .from(EventSequenceTable)
      .where(eq(EventSequenceTable.aggregate_id, aggregateID))
      .get(),
  )
  return (row?.seq ?? -1) + 1
}

function sessionMessages(sessionID: SessionID) {
  return Database.use((db) =>
    db.select().from(SessionMessageTable).where(eq(SessionMessageTable.session_id, sessionID)).all(),
  )
}

function replay(
  directory: string,
  headers: Record<string, string>,
  event: { id: string; aggregateID: string; seq: number; type: string; data: Record<string, unknown> },
) {
  return app().request(SyncPaths.replay, {
    method: "POST",
    headers,
    body: JSON.stringify({ directory, events: [event] }),
  })
}

const testModel = {
  id: Modelv2.ID.make("test-model"),
  providerID: Modelv2.ProviderID.make("test-provider"),
  variant: Modelv2.VariantID.make("default"),
}

afterEach(async () => {
  mock.restore()
  Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = originalWorkspaces
  await disposeAllInstances()
  await resetDatabase()
})

describe("sync HttpApi", () => {
  test("serves sync routes", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const info = spyOn(Log.create({ service: "server.sync" }), "info")

    const session = await WithInstance.provide({
      directory: tmp.path,
      fn: async () => runSession(Session.Service.use((svc) => svc.create({ title: "sync" }))),
    })

    const started = await app().request(SyncPaths.start, { method: "POST", headers })
    expect(started.status).toBe(200)
    expect(await started.json()).toBe(true)

    const history = await app().request(SyncPaths.history, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
    expect(history.status).toBe(200)
    const rows = (await history.json()) as Array<{
      id: string
      aggregate_id: string
      seq: number
      type: string
      data: Record<string, unknown>
    }>
    expect(rows.map((row) => row.aggregate_id)).toContain(session.id)

    const replayed = await app().request(SyncPaths.replay, {
      method: "POST",
      headers,
      body: JSON.stringify({
        directory: tmp.path,
        events: rows
          .filter((row) => row.aggregate_id === session.id)
          .map((row) => ({
            id: row.id,
            aggregateID: row.aggregate_id,
            seq: row.seq,
            type: row.type,
            data: row.data,
          })),
      }),
    })
    expect(replayed.status).toBe(200)
    expect(await replayed.json()).toEqual({ sessionID: session.id })
    expect(info.mock.calls.some(([message]) => message === "sync replay requested")).toBe(true)
    expect(info.mock.calls.some(([message]) => message === "sync replay complete")).toBe(true)
  })

  test("validates seq values", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const cases = [
      {
        path: SyncPaths.history,
        body: { aggregate: -1 },
      },
      {
        path: SyncPaths.history,
        body: { aggregate: 1.5 },
      },
      {
        path: SyncPaths.replay,
        body: {
          directory: tmp.path,
          events: [{ id: "event", aggregateID: "session", seq: -1, type: "session.created", data: {} }],
        },
      },
      {
        path: SyncPaths.replay,
        body: {
          directory: tmp.path,
          events: [{ id: "event", aggregateID: "session", seq: 1.5, type: "session.created", data: {} }],
        },
      },
    ]

    for (const item of cases) {
      const response = await app().request(item.path, {
        method: "POST",
        headers,
        body: JSON.stringify(item.body),
      })
      expect(response.status).toBe(400)
    }
  })

  test.todo("returns structured validation errors", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const response = await ExperimentalHttpApiServer.webHandler().handler(
      new Request(`http://localhost${SyncPaths.history}`, {
        method: "POST",
        headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
        body: JSON.stringify({ aggregate: -1 }),
      }),
      context,
    )

    expect(response.status).toBe(400)
    expect(response.headers.get("content-type") ?? "").toContain("application/json")
    const body = (await response.json()) as Record<string, unknown>
    expect(body.success).toBe(false)
    expect(Array.isArray(body.error) || Array.isArray(body.errors)).toBe(true)
  })
})

// V2 datetime round-trip: emitters pass `DateTime` instances, but `EventTable`
// stores the JSON form. Replay must feed projectors a rebuilt `DateTime.Utc`
// instead of the ISO string, or the projector constructor throws and the replay
// transaction rolls back (workspace-sync reconnect loop).
describe("sync HttpApi V2 datetime round-trip", () => {
  const ISO = "2024-01-02T03:04:05.000Z"
  const MILLIS = Date.parse(ISO)

  async function createSession(directory: string) {
    return WithInstance.provide({
      directory,
      fn: async () => runSession(Session.Service.use((svc) => svc.create({ title: "datetime" }))),
    })
  }

  async function emitStepStarted(directory: string, sessionID: SessionID, millis: number) {
    await WithInstance.provide({
      directory,
      fn: async () =>
        runSync(
          SyncEvent.Service.use((sync) =>
            sync.run(SessionEvent.Step.Started.Sync, {
              sessionID,
              timestamp: DateTime.makeUnsafe(millis),
              agent: "build",
              model: testModel,
            }),
          ),
        ),
    })
  }

  const stepEndedPayload = (sessionID: SessionID, timestamp: string) => ({
    sessionID,
    timestamp,
    finish: "stop",
    cost: 0.25,
    tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
  })

  function storedTime(row: { data: unknown }): Record<string, unknown> {
    return (row.data as unknown as { time?: Record<string, unknown> }).time ?? {}
  }

  test("stores V2 event timestamps in encoded form", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const session = await createSession(tmp.path)

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () =>
        runSync(
          SyncEvent.Service.use((sync) =>
            sync.run(SessionEvent.Synthetic.Sync, {
              sessionID: session.id,
              timestamp: DateTime.makeUnsafe(MILLIS),
              text: "encoded",
            }),
          ),
        ),
    })

    const history = await app().request(SyncPaths.history, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    })
    expect(history.status).toBe(200)
    const rows = (await history.json()) as Array<{
      aggregate_id: string
      type: string
      data: Record<string, unknown>
    }>
    const row = rows.find((item) => item.aggregate_id === session.id && item.type === "session.next.synthetic.1")
    expect(row).toBeDefined()
    expect(typeof row!.data.timestamp).toBe("number")
    expect(row!.data.timestamp).toBe(MILLIS)
  })

  test("replays a crafted ISO-timestamp V2 event", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const session = await createSession(tmp.path)

    const response = await replay(tmp.path, headers, {
      id: EventID.ascending(),
      aggregateID: session.id,
      seq: nextSeq(session.id),
      type: "session.next.synthetic.1",
      data: { sessionID: session.id, timestamp: ISO, text: "replayed" },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ sessionID: session.id })

    const row = sessionMessages(session.id).find((item) => item.type === "synthetic")
    expect(row).toBeDefined()
    if (!row) return
    expect(storedTime(row).created).toBe(MILLIS)
  })

  test("replayed update events persist millis (mixed live+replay)", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const session = await createSession(tmp.path)
    const started = MILLIS
    const ended = MILLIS + 1000

    await emitStepStarted(tmp.path, session.id, started)

    const response = await replay(tmp.path, headers, {
      id: EventID.ascending(),
      aggregateID: session.id,
      seq: nextSeq(session.id),
      type: "session.next.step.ended.1",
      data: stepEndedPayload(session.id, new Date(ended).toISOString()),
    })
    expect(response.status).toBe(200)

    const row = sessionMessages(session.id).find((item) => item.type === "assistant")
    expect(row).toBeDefined()
    if (!row) return
    const time = storedTime(row)
    expect(time.created).toBe(started)
    expect(time.completed).toBe(ended)
  })

  test("tolerates a poisoned read-model row", async () => {
    Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }
    const session = await createSession(tmp.path)
    const started = MILLIS
    const ended = MILLIS + 1000

    await emitStepStarted(tmp.path, session.id, started)

    // Simulate the mixed live+replay corruption: an ISO string persisted into
    // the read model's JSON column.
    const current = sessionMessages(session.id).find((item) => item.type === "assistant")
    expect(current).toBeDefined()
    if (!current) return
    Database.use((db) =>
      db
        .update(SessionMessageTable)
        .set({
          data: {
            ...(current.data as unknown as Record<string, unknown>),
            time: { ...storedTime(current), created: new Date(started).toISOString() },
          } as unknown as (typeof SessionMessageTable.$inferInsert)["data"],
        })
        .where(eq(SessionMessageTable.id, current.id))
        .run(),
    )
    const poisoned = sessionMessages(session.id).find((item) => item.type === "assistant")
    expect(storedTime(poisoned!).created).toBe(new Date(started).toISOString())

    const response = await replay(tmp.path, headers, {
      id: EventID.ascending(),
      aggregateID: session.id,
      seq: nextSeq(session.id),
      type: "session.next.step.ended.1",
      data: stepEndedPayload(session.id, new Date(ended).toISOString()),
    })
    expect(response.status).toBe(200)

    const healed = sessionMessages(session.id).find((item) => item.type === "assistant")
    expect(healed).toBeDefined()
    if (!healed) return
    const time = storedTime(healed)
    expect(time.created).toBe(started)
    expect(time.completed).toBe(ended)
  })
})
