import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"

function makeAgent(items: any[]) {
  const sdk = {
    v2: {
      session: {
        list: async () => ({ data: { items } }),
      },
    },
  }
  return new ACP.Agent({} as AgentSideConnection, {
    sdk,
    defaultModel: { providerID: "opencode", modelID: "m" },
  } as any)
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
})
