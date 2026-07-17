import { describe, expect, test, mock, afterAll } from "bun:test"
import { ACPSessionManager } from "../../src/acp/session"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"

function createMockSdk(sessionGetResult?: any, sessionGetError?: Error) {
  const sessionGet = mock(async () => {
    if (sessionGetError) throw sessionGetError
    return { data: sessionGetResult }
  })
  return {
    sdk: { session: { get: sessionGet } } as unknown as OpencodeClient,
    sessionGet,
  }
}

function fakeSessionData(id: string, directory: string) {
  return {
    id,
    directory,
    title: "test session",
    time: { created: Date.now(), updated: Date.now() },
  }
}

describe("ACPSessionManager", () => {
  afterAll(() => {
    mock.restore()
  })

  test("get returns session from cache", () => {
    const { sdk } = createMockSdk()
    const mgr = new ACPSessionManager(sdk)
    // Pre-populate via create
    const state = {
      id: "ses_1",
      cwd: "/tmp",
      mcpServers: [],
      createdAt: new Date(),
    }
    ;(mgr as any).sessions.set("ses_1", state)

    const result = mgr.get("ses_1")
    expect(result).toBe(state)
    expect(result.cwd).toBe("/tmp")
  })

  test("get throws for unknown session", () => {
    const { sdk } = createMockSdk()
    const mgr = new ACPSessionManager(sdk)

    expect(() => mgr.get("unknown")).toThrow("Invalid params")
  })

  test("getOrLoad returns cached session without SDK call", async () => {
    const { sdk, sessionGet } = createMockSdk()
    const mgr = new ACPSessionManager(sdk)
    const state = {
      id: "ses_1",
      cwd: "/tmp",
      mcpServers: [],
      createdAt: new Date(),
    }
    ;(mgr as any).sessions.set("ses_1", state)

    const result = await mgr.getOrLoad("ses_1")
    expect(result).toBe(state)
    expect(sessionGet).not.toHaveBeenCalled()
  })

  test("getOrLoad loads from server on cache miss", async () => {
    const sessionData = fakeSessionData("ses_1", "/tmp")
    const { sdk, sessionGet } = createMockSdk(sessionData)
    const mgr = new ACPSessionManager(sdk)

    const result = await mgr.getOrLoad("ses_1")
    expect(result.id).toBe("ses_1")
    expect(result.cwd).toBe("/tmp")
    expect(sessionGet).toHaveBeenCalledTimes(1)
    // Verify it was added to cache
    const cached = mgr.get("ses_1")
    expect(cached).toBe(result)
  })

  test("getOrLoad deduplicates concurrent calls", async () => {
    let resolveGet: (value: any) => void = () => {}
    const getPromise = new Promise<any>((resolve) => {
      resolveGet = resolve
    })
    const sessionGet = mock(async () => getPromise)
    const sdk = { session: { get: sessionGet } } as unknown as OpencodeClient
    const mgr = new ACPSessionManager(sdk)

    // Start two concurrent getOrLoad calls
    const result1Promise = mgr.getOrLoad("ses_1")
    const result2Promise = mgr.getOrLoad("ses_1")

    // Resolve the SDK call
    const sessionData = fakeSessionData("ses_1", "/tmp")
    resolveGet({ data: sessionData })

    const [result1, result2] = await Promise.all([result1Promise, result2Promise])
    expect(result1).toBe(result2)
    expect(sessionGet).toHaveBeenCalledTimes(1)
  })

  test("getOrLoad throws when session not on server", async () => {
    const serverError = new Error("Session not found on server")
    const { sdk } = createMockSdk(undefined, serverError)
    const mgr = new ACPSessionManager(sdk)

    await expect(mgr.getOrLoad("ses_1")).rejects.toThrow("Session not found on server")
  })

  test("tryGetOrLoad returns undefined on failure", async () => {
    const serverError = new Error("Session not found on server")
    const { sdk } = createMockSdk(undefined, serverError)
    const mgr = new ACPSessionManager(sdk)

    const result = await mgr.tryGetOrLoad("ses_1")
    expect(result).toBeUndefined()
  })

  test("tryGetOrLoad returns cached session", async () => {
    const { sdk, sessionGet } = createMockSdk()
    const mgr = new ACPSessionManager(sdk)
    const state = {
      id: "ses_1",
      cwd: "/tmp",
      mcpServers: [],
      createdAt: new Date(),
    }
    ;(mgr as any).sessions.set("ses_1", state)

    const result = await mgr.tryGetOrLoad("ses_1")
    expect(result).toBe(state)
    expect(sessionGet).not.toHaveBeenCalled()
  })

  test("tryGetOrLoad loads from server on miss", async () => {
    const sessionData = fakeSessionData("ses_1", "/tmp")
    const { sdk, sessionGet } = createMockSdk(sessionData)
    const mgr = new ACPSessionManager(sdk)

    const result = await mgr.tryGetOrLoad("ses_1")
    expect(result).toBeDefined()
    expect(result!.id).toBe("ses_1")
    expect(result!.cwd).toBe("/tmp")
    expect(sessionGet).toHaveBeenCalledTimes(1)
  })

  test("get and tryGet remain synchronous", () => {
    const { sdk } = createMockSdk()
    const mgr = new ACPSessionManager(sdk)
    const state = {
      id: "ses_1",
      cwd: "/tmp",
      mcpServers: [],
      createdAt: new Date(),
    }
    ;(mgr as any).sessions.set("ses_1", state)

    // These should be synchronous — no await needed
    const result = mgr.get("ses_1")
    expect(result).toBe(state)

    const tryResult = mgr.tryGet("ses_1")
    expect(tryResult).toBe(state)

    const tryMissing = mgr.tryGet("unknown")
    expect(tryMissing).toBeUndefined()
  })
})
