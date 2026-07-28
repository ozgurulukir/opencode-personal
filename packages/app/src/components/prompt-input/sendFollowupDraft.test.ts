import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"

let sendFollowupDraftFn: typeof import("./sendFollowupDraft").sendFollowupDraft
let detectCommandFn: typeof import("./detectCommand").detectCommand

afterAll(() => mock.restore())
let optimisticAddFn: typeof import("./useOptimisticSend").optimisticAdd
let optimisticRemoveFn: typeof import("./useOptimisticSend").optimisticRemove

beforeAll(async () => {
  mock.module("./build-request-parts", () => ({
    buildRequestParts: () => ({
      requestParts: [],
      optimisticParts: [],
    }),
  }))

  const sendFollowupDraftMod = await import("./sendFollowupDraft")
  sendFollowupDraftFn = sendFollowupDraftMod.sendFollowupDraft

  const detectCommandMod = await import("./detectCommand")
  detectCommandFn = detectCommandMod.detectCommand

  const optimisticSendMod = await import("./useOptimisticSend")
  optimisticAddFn = optimisticSendMod.optimisticAdd
  optimisticRemoveFn = optimisticSendMod.optimisticRemove
})

describe("detectCommand", () => {
  const commands = [{ name: "test" }, { name: "hello" }]

  test("returns undefined for non-command text", () => {
    expect(detectCommandFn("hello world", commands)).toBeUndefined()
  })

  test("returns undefined for empty command name", () => {
    expect(detectCommandFn("/", commands)).toBeUndefined()
  })

  test("returns undefined for unknown command", () => {
    expect(detectCommandFn("/unknown", commands)).toBeUndefined()
  })

  test("returns command with empty arguments", () => {
    expect(detectCommandFn("/test", commands)).toEqual({ name: "test", arguments: "", raw: "/test" })
  })

  test("returns command with arguments", () => {
    expect(detectCommandFn("/test arg1 arg2", commands)).toEqual({
      name: "test",
      arguments: "arg1 arg2",
      raw: "/test arg1 arg2",
    })
  })
})

describe("useOptimisticSend", () => {
  test("optimisticAdd delegates to sync", () => {
    const add = mock(() => {})
    const sync = {
      session: {
        optimistic: { add },
      },
    } as any
    const message = { id: "m1" } as Message
    const parts = [] as Part[]
    optimisticAddFn(sync, "/dir", "session-1", message, parts)
    expect(add).toHaveBeenCalledWith({ directory: "/dir", sessionID: "session-1", message, parts })
  })

  test("optimisticRemove delegates to sync", () => {
    const remove = mock(() => {})
    const sync = {
      session: {
        optimistic: { remove },
      },
    } as any
    optimisticRemoveFn(sync, "/dir", "session-1", "m1")
    expect(remove).toHaveBeenCalledWith({ directory: "/dir", sessionID: "session-1", messageID: "m1" })
  })
})

describe("sendFollowupDraft", () => {
  const commands = [{ name: "test" }]

  const createClient = (overrides: { commandError?: Error; promptError?: Error } = {}) => ({
    session: {
      command: async () => {
        if (overrides.commandError) throw overrides.commandError
        return { data: undefined }
      },
      promptAsync: async () => {
        if (overrides.promptError) throw overrides.promptError
        return { data: undefined }
      },
    },
  })

  const createGlobalSync = () => {
    const setStoreCalls: unknown[][] = []
    const child = (_directory: string) => {
      const setStore = (...args: unknown[]) => setStoreCalls.push(args)
      return [{} as any, setStore]
    }
    return { child, setStoreCalls }
  }

  const createSync = () => ({
    data: { command: commands },
    session: {
      optimistic: {
        add: mock(() => {}),
        remove: mock(() => {}),
      },
    },
  })

  const createDraft = (text: string) => ({
    sessionID: "session-1",
    sessionDirectory: "/dir",
    prompt: [{ type: "text", content: text, start: 0, end: text.length }] as any,
    context: [] as any,
    agent: "agent",
    model: { providerID: "p", modelID: "m" },
  } as any)

  test("executes command when text starts with /", async () => {
    const client = createClient()
    const { child, setStoreCalls } = createGlobalSync()
    const sync = createSync()
    const draft = createDraft("/test args")

    const result = await sendFollowupDraftFn({
      client: client as any,
      globalSync: { child } as any,
      sync: sync as any,
      draft,
      messageID: "msg-1",
      optimisticBusy: true,
    })

    expect(result).toBe(true)
    expect(setStoreCalls).toEqual([["session_status", "session-1", { type: "busy" }]])
  })

  test("returns false when before hook rejects command", async () => {
    const client = createClient()
    const { child, setStoreCalls } = createGlobalSync()
    const sync = createSync()
    const draft = createDraft("/test args")

    const result = await sendFollowupDraftFn({
      client: client as any,
      globalSync: { child } as any,
      sync: sync as any,
      draft,
      messageID: "msg-1",
      optimisticBusy: true,
      before: () => false,
    })

    expect(result).toBe(false)
    expect(setStoreCalls).toEqual([
      ["session_status", "session-1", { type: "busy" }],
      ["session_status", "session-1", { type: "idle" }],
    ])
  })

  test("rethrows on command error", async () => {
    const client = createClient({ commandError: new Error("command failed") })
    const { child, setStoreCalls } = createGlobalSync()
    const sync = createSync()
    const draft = createDraft("/test args")

    await expect(
      sendFollowupDraftFn({
        client: client as any,
        globalSync: { child } as any,
        sync: sync as any,
        draft,
        messageID: "msg-1",
        optimisticBusy: true,
      }),
    ).rejects.toThrow("command failed")
    expect(setStoreCalls).toEqual([
      ["session_status", "session-1", { type: "busy" }],
      ["session_status", "session-1", { type: "idle" }],
    ])
  })

  test("sends normal prompt when no command", async () => {
    const client = createClient()
    const { child, setStoreCalls } = createGlobalSync()
    const sync = createSync()
    const draft = createDraft("hello")

    const result = await sendFollowupDraftFn({
      client: client as any,
      globalSync: { child } as any,
      sync: sync as any,
      draft,
      messageID: "msg-1",
      optimisticBusy: true,
    })

    expect(result).toBe(true)
    expect(setStoreCalls).toEqual([["session_status", "session-1", { type: "busy" }]])
  })

  test("returns false on wait abort for normal prompt", async () => {
    const client = createClient()
    const { child, setStoreCalls } = createGlobalSync()
    const sync = createSync()
    const draft = createDraft("hello")

    const result = await sendFollowupDraftFn({
      client: client as any,
      globalSync: { child } as any,
      sync: sync as any,
      draft,
      messageID: "msg-1",
      optimisticBusy: true,
      before: () => false,
    })

    expect(result).toBe(false)
    expect(setStoreCalls).toEqual([
      ["session_status", "session-1", { type: "busy" }],
      ["session_status", "session-1", { type: "idle" }],
    ])
  })

  test("rethrows on prompt error", async () => {
    const client = createClient({ promptError: new Error("prompt failed") })
    const { child, setStoreCalls } = createGlobalSync()
    const sync = createSync()
    const draft = createDraft("hello")

    await expect(
      sendFollowupDraftFn({
        client: client as any,
        globalSync: { child } as any,
        sync: sync as any,
        draft,
        messageID: "msg-1",
        optimisticBusy: true,
      }),
    ).rejects.toThrow("prompt failed")
    expect(setStoreCalls).toEqual([
      ["session_status", "session-1", { type: "busy" }],
      ["session_status", "session-1", { type: "idle" }],
    ])
  })
})
