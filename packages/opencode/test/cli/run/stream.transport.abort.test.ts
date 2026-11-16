import { describe, expect, test } from "bun:test"
import { createSessionTransport } from "@/cli/cmd/run/stream.transport"
import type { FooterApi, StreamCommit } from "@/cli/cmd/run/types"
import type { GlobalEvent, OpencodeClient } from "@opencode-ai/sdk/v2"

function mockFooter(): { api: FooterApi; commits: StreamCommit[] } {
  const commits: StreamCommit[] = []
  let closed = false
  const api: FooterApi = {
    get isClosed() {
      return closed
    },
    onPrompt: () => () => {},
    onClose: () => () => {},
    event: () => {},
    append: (c) => {
      commits.push(c)
    },
    idle: () => Promise.resolve(),
    close: () => {
      closed = true
    },
    destroy: () => {
      closed = true
    },
  }
  return { api, commits }
}

function mockSdk(options?: {
  onPrompt?: (opt?: { signal?: AbortSignal }) => void
  status?: () => Record<string, unknown>
}) {
  const stream = (async function* (): AsyncGenerator<GlobalEvent> {})()
  const promptAsync = async (_args: unknown, opt?: { signal?: AbortSignal }) => {
    options?.onPrompt?.(opt)
    return { data: undefined }
  }
  return {
    v2: {
      session: {
        messages: async () => ({ data: { items: [] } }),
        children: async () => ({ data: [] }),
        promptAsync,
      },
    },
    permission: {
      list: async () => ({ data: [] }),
    },
    question: {
      list: async () => ({ data: [] }),
    },
    global: {
      event: async () => ({ stream }),
    },
    session: {
      status: async () => ({ data: options?.status ? options.status() : {} }),
      promptAsync,
    },
  } as unknown as OpencodeClient
}

function trackSignal(ctrl: AbortController) {
  let added = 0
  let removed = 0
  const origAdd = ctrl.signal.addEventListener.bind(ctrl.signal)
  const origRemove = ctrl.signal.removeEventListener.bind(ctrl.signal)

  ctrl.signal.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    opts?: boolean | AddEventListenerOptions,
  ) => {
    if (type === "abort") added++
    return origAdd(type, listener, opts)
  }) as typeof ctrl.signal.addEventListener

  ctrl.signal.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject,
    opts?: boolean | EventListenerOptions,
  ) => {
    if (type === "abort") removed++
    return origRemove(type, listener, opts)
  }) as typeof ctrl.signal.removeEventListener

  return {
    get added() {
      return added
    },
    get removed() {
      return removed
    },
    get active() {
      return added - removed
    },
  }
}

describe("stream transport abort-listener lifecycle characterization", () => {
  test("registers and removes abort listener on input.signal across transport lifecycle", async () => {
    const parentCtrl = new AbortController()
    const tracker = trackSignal(parentCtrl)
    const footer = mockFooter()

    const transport = await createSessionTransport({
      sdk: mockSdk(),
      sessionID: "session-test",
      signal: parentCtrl.signal,
      thinking: true,
      limits: () => ({}),
      footer: footer.api,
    })

    // Listener should be registered on input.signal
    expect(tracker.added).toBeGreaterThan(0)
    expect(tracker.active).toBe(1)

    // Close transport
    await transport.close()

    // Listener should be cleaned up on close
    expect(tracker.active).toBe(0)
  })

  test("removes turn abort listeners on normal turn completion", async () => {
    const footer = mockFooter()
    const turnCtrl = new AbortController()
    const tracker = trackSignal(turnCtrl)

    const transport = await createSessionTransport({
      sdk: mockSdk(),
      sessionID: "session-test",
      thinking: true,
      limits: () => ({}),
      footer: footer.api,
    })

    try {
      const turnTask = transport.runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "test prompt", parts: [] },
        files: [],
        includeFiles: false,
        signal: turnCtrl.signal,
      })

      // Turn registers abort listener
      expect(tracker.added).toBeGreaterThan(0)

      // Prompt completed, close transport to complete turn
      await transport.close()
      await turnTask

      // All abort listeners on turnCtrl should be removed
      expect(tracker.active).toBe(0)
    } finally {
      await transport.close()
    }
  })

  test("cleans up listeners when signal fires mid-stream", async () => {
    const footer = mockFooter()
    const turnCtrl = new AbortController()
    const tracker = trackSignal(turnCtrl)

    let promptSignal: AbortSignal | undefined
    const transport = await createSessionTransport({
      sdk: mockSdk({
        onPrompt: (opt) => {
          promptSignal = opt?.signal
        },
      }),
      sessionID: "session-test",
      thinking: true,
      limits: () => ({}),
      footer: footer.api,
    })

    try {
      const turnTask = transport.runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "midstream abort", parts: [] },
        files: [],
        includeFiles: false,
        signal: turnCtrl.signal,
      })

      expect(tracker.active).toBeGreaterThan(0)

      // Fire abort mid-stream
      turnCtrl.abort()
      await turnTask

      // Signal propagated to promptAsync
      expect(promptSignal?.aborted).toBe(true)

      // Listeners removed after abort
      expect(tracker.active).toBe(0)
    } finally {
      await transport.close()
    }
  })

  test("handles pre-aborted signal gracefully without lingering listeners", async () => {
    const footer = mockFooter()
    const preAborted = new AbortController()
    preAborted.abort()
    const tracker = trackSignal(preAborted)

    const transport = await createSessionTransport({
      sdk: mockSdk(),
      sessionID: "session-test",
      thinking: true,
      limits: () => ({}),
      footer: footer.api,
    })

    try {
      await transport.runPromptTurn({
        agent: undefined,
        model: undefined,
        variant: undefined,
        prompt: { text: "already aborted", parts: [] },
        files: [],
        includeFiles: false,
        signal: preAborted.signal,
      })

      expect(tracker.active).toBe(0)
    } finally {
      await transport.close()
    }
  })

  test("cleans up all abort listeners when transport is closed mid-turn", async () => {
    const footer = mockFooter()
    const parentCtrl = new AbortController()
    const turnCtrl = new AbortController()
    const parentTracker = trackSignal(parentCtrl)
    const turnTracker = trackSignal(turnCtrl)

    const transport = await createSessionTransport({
      sdk: mockSdk(),
      sessionID: "session-test",
      signal: parentCtrl.signal,
      thinking: true,
      limits: () => ({}),
      footer: footer.api,
    })

    const turnTask = transport.runPromptTurn({
      agent: undefined,
      model: undefined,
      variant: undefined,
      prompt: { text: "turn to close", parts: [] },
      files: [],
      includeFiles: false,
      signal: turnCtrl.signal,
    })

    expect(parentTracker.active).toBe(1)
    expect(turnTracker.active).toBe(1)

    // Close transport while turn is active
    await transport.close()
    await turnTask

    expect(parentTracker.active).toBe(0)
    expect(turnTracker.active).toBe(0)
  })
})
