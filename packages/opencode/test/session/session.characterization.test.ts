import { describe, expect, test } from "bun:test"
import path from "path"
import { Session as SessionNs } from "@/session/session"
import { Bus } from "../../src/bus"
import { WithInstance } from "../../src/project/with-instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { AppRuntime } from "../../src/effect/app-runtime"

const projectRoot = path.join(__dirname, "../..")

function create(input?: SessionNs.CreateInput) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create(input)))
}

function list(input?: SessionNs.ListInput) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.list(input)))
}

describe("Session public API — characterization", () => {
  test("create returns Info with expected shape", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const info = await create({ title: "Characterization Test" })
        expect(info.id).toBeDefined()
        expect(info.projectID).toBeDefined()
        expect(info.directory).toBe(projectRoot)
        expect(info.title).toBe("Characterization Test")
        expect(info.time.created).toBeGreaterThan(0)
        expect(info.time.updated).toBeGreaterThan(0)

        const unsub = Bus.subscribe(SessionNs.Event.Created, () => {})
        await new Promise((resolve) => setTimeout(resolve, 100))
        unsub()
      },
    })
  })

  test("list returns created session", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const created = await create({ title: "List Test Session" })
        const sessions = await list({ directory: projectRoot })
        const found = sessions.find((s) => s.id === created.id)
        expect(found).toBeDefined()
        expect(found?.title).toBe("List Test Session")
      },
    })
  })

  test("fork creates child with incremented title", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const parent = await create({ title: "Fork Parent" })
        const child = await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.fork({ sessionID: parent.id })),
        )
        expect(child).toBeDefined()
        expect(child.id).toBeDefined()
        expect(child.id).not.toBe(parent.id)
        // Note: current implementation does NOT set parentID on forked sessions
        expect(child.parentID).toBeUndefined()
        expect(child.title).toBe("Fork Parent (fork #1)")
      },
    })
  })

  test("setTitle updates session", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const info = await create({ title: "Original Title" })
        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.setTitle({ sessionID: info.id, title: "New Title" })),
        )
        const updated = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.get(info.id)))
        expect(updated.title).toBe("New Title")
      },
    })
  })

  test("setArchived marks session archived", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const info = await create({ title: "Archive Me" })
        const now = Date.now()
        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.setArchived({ sessionID: info.id, time: now })),
        )
        const updated = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.get(info.id)))
        expect(updated.time.archived).toBe(now)
      },
    })
  })

  test("setPermission persists ruleset", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const info = await create({ title: "Perm Test" })
        const rules = [{ permission: "read", pattern: "**", action: "allow" as const }]
        await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.setPermission({ sessionID: info.id, permission: rules })),
        )
        const updated = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.get(info.id)))
        expect(updated.permission).toEqual(rules)
      },
    })
  })
})
