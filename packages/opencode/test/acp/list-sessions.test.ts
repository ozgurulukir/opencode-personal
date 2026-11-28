import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session/session"
import { WithInstance } from "../../src/project/with-instance"
import { tmpdir } from "../fixture/fixture"

function app() {
  return Server.Default().app
}

function makeAgent(items: any[]) {
  const sdk = {
    v2: {
      server: undefined,
      session: {
        list: async () => ({ data: { items } }),
      },
    },
  }
  return new ACP.Agent(
    {} as AgentSideConnection,
    {
      sdk,
      defaultModel: { providerID: "opencode", modelID: "m" },
    } as any,
  )
}

// An SDK-shaped client whose list call goes through the REAL V2 sessions
// handler (no stub): the adapter must consume the handler's actual opaque
// cursor format to page past the server's per-request cap.
function realHandlerSdk(directory: string) {
  const list = async (params: Record<string, unknown>) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value))
    }
    const response = await app().request(`/api/session?${query.toString()}`, {
      headers: { "x-opencode-directory": directory },
    })
    const body = await response.text()
    if (response.status !== 200) throw new Error(`session list failed (${response.status}): ${body}`)
    const parsed = JSON.parse(body)
    return { data: parsed }
  }
  return {
    v2: {
      session: { list },
    },
  }
}

function session(id: string, updated: number) {
  return { id, directory: "/tmp", title: id, time: { created: updated, updated } }
}

describe("acp.agent listSessions cursor", () => {
  test("rejects a non-numeric cursor with invalidParams", async () => {
    const agent = makeAgent([])
    await expect(agent.listSessions({ cwd: "/tmp", cursor: "garbage" } as any)).rejects.toThrow()
  })

  test("does not drop sessions sharing the same millisecond across pages", async () => {
    const t = Date.now()
    const ids = Array.from({ length: 101 }, (_, i) => `ses_${String(i).padStart(3, "0")}`)
    const agent = makeAgent(ids.map((id) => session(id, t)))

    const first = await agent.listSessions({ cwd: "/tmp" } as any)
    expect(first.sessions).toHaveLength(100)
    expect(first.nextCursor).toBeDefined()

    const second = await agent.listSessions({ cwd: "/tmp", cursor: first.nextCursor } as any)
    expect(second.sessions).toHaveLength(1)

    const all = [...first.sessions, ...second.sessions].map((s) => s.sessionId)
    expect(new Set(all).size).toBe(101)
  })

  test("paginates mixed-case ids without duplicating or dropping sessions", async () => {
    const t = Date.now()
    // "ses_a000" sorts after the Z ids under localeCompare but before them
    // under the JS `<` operator. The sort and the cursor filter must use the
    // same comparator or this last session is dropped at the page boundary.
    const ids = [...Array.from({ length: 100 }, (_, i) => `ses_Z${String(i).padStart(3, "0")}`), "ses_a000"]
    const agent = makeAgent(ids.map((id) => session(id, t)))

    const first = await agent.listSessions({ cwd: "/tmp" } as any)
    expect(first.sessions).toHaveLength(100)
    expect(first.nextCursor).toBeDefined()

    const second = await agent.listSessions({ cwd: "/tmp", cursor: first.nextCursor } as any)
    expect(second.sessions).toHaveLength(1)

    const all = [...first.sessions, ...second.sessions].map((s) => s.sessionId)
    expect(new Set(all).size).toBe(101)
    expect(all).toContain("ses_a000")
  })

  test("accepts a legacy bare numeric cursor without a tiebreaker", async () => {
    const t = Date.now()
    const agent = makeAgent([session("ses_newer", t + 10), session("ses_same", t), session("ses_older", t - 10)])

    // A persisted pre-tiebreaker cursor is just the timestamp. It must behave
    // like the old `updated < cursor` filter: strictly older sessions only.
    const result = await agent.listSessions({ cwd: "/tmp", cursor: String(t) } as any)
    expect(result.sessions.map((s) => s.sessionId)).toEqual(["ses_older"])
  })
})

describe("acp.agent listSessions against the real V2 handler", () => {
  test("reaches sessions beyond the first server page", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })

    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const runSession = <A, E>(fx: Effect.Effect<A, E, Session.Service>) =>
          Effect.runPromise(fx.pipe(Effect.provide(Session.defaultLayer)))
        for (let i = 0; i < 105; i++) {
          await runSession(Session.Service.use((svc) => svc.create({ title: `bulk ${i}` })))
        }
      },
    })

    const agent = new ACP.Agent({} as AgentSideConnection, {
      sdk: realHandlerSdk(tmp.path),
      defaultModel: { providerID: "opencode", modelID: "m" },
    } as any)

    // Page through until exhaustion; every created session must be reachable.
    const seen: string[] = []
    let cursor: string | undefined
    for (;;) {
      const page = await agent.listSessions({ cwd: tmp.path, cursor } as any)
      seen.push(...page.sessions.map((s) => s.sessionId))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toHaveLength(105)
    expect(new Set(seen).size).toBe(105)
  })
})
