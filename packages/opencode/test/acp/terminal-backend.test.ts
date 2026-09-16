import { afterEach, describe, expect, test } from "bun:test"
import type { AgentSideConnection, TerminalHandle } from "@agentclientprotocol/sdk"
import {
  createClientTerminal,
  registerConnection,
  terminateClientTerminal,
  unregisterConnection,
} from "@/acp/terminal-backend"

const originalMode = process.env.OPENCODE_ACP_TERMINAL_BACKEND

afterEach(async () => {
  if (originalMode === undefined) delete process.env.OPENCODE_ACP_TERMINAL_BACKEND
  else process.env.OPENCODE_ACP_TERMINAL_BACKEND = originalMode
  await unregisterConnection("terminal-test")
})

function fakeTerminal(calls: string[]) {
  return {
    id: "term-1",
    kill: async () => void calls.push("kill"),
    release: async () => void calls.push("release"),
    waitForExit: async () => ({ exitCode: 0 }),
    currentOutput: async () => ({ output: "ok", truncated: false }),
  } as unknown as TerminalHandle
}

function fakeConnection(terminal: TerminalHandle) {
  return {
    createTerminal: async () => terminal,
  } as unknown as AgentSideConnection
}

describe("ACP terminal backend", () => {
  test("uses local execution when capability is missing in auto mode", async () => {
    delete process.env.OPENCODE_ACP_TERMINAL_BACKEND
    const create = async () => {
      throw new Error("must not be called")
    }
    registerConnection("terminal-test", { createTerminal: create } as unknown as AgentSideConnection, false)
    expect(await createClientTerminal({ sessionID: "terminal-test", callID: "call", command: "echo", args: [], cwd: ".", env: {} })).toBeUndefined()
  })

  test("fails explicitly in client mode when capability is missing", async () => {
    process.env.OPENCODE_ACP_TERMINAL_BACKEND = "client"
    registerConnection("terminal-test", fakeConnection(fakeTerminal([])), false)
    expect(createClientTerminal({ sessionID: "terminal-test", callID: "call", command: "echo", args: [], cwd: ".", env: {} })).rejects.toThrow(
      "ACP client terminal capability is unavailable",
    )
  })

  test("kills and releases an active terminal exactly once", async () => {
    const calls: string[] = []
    registerConnection("terminal-test", fakeConnection(fakeTerminal(calls)), true)
    const execution = await createClientTerminal({ sessionID: "terminal-test", callID: "call", command: "echo", args: [], cwd: ".", env: {} })
    if (!execution) throw new Error("expected terminal execution")
    await terminateClientTerminal(execution)
    await terminateClientTerminal(execution)
    expect(calls).toEqual(["kill", "release"])
  })

  test("cleans active terminals when a session is unregistered", async () => {
    const calls: string[] = []
    registerConnection("terminal-test", fakeConnection(fakeTerminal(calls)), true)
    await createClientTerminal({ sessionID: "terminal-test", callID: "call", command: "echo", args: [], cwd: ".", env: {} })
    await unregisterConnection("terminal-test")
    expect(calls).toEqual(["kill", "release"])
  })
})
