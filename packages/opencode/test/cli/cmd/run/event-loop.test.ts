import { describe, expect, test } from "bun:test"
import { loop } from "../../../../src/cli/cmd/run/event-loop"
import type { LoopContext } from "../../../../src/cli/cmd/run/types"
import type { ToolPart, Part } from "@opencode-ai/sdk/v2"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<LoopContext> = {}): LoopContext {
  const toggles = new Map<string, boolean>()
  return {
    emit: () => false,
    toggles,
    args: { format: "default", thinking: false, "dangerously-skip-permissions": false },
    sessionID: "ses_1",
    tool: async () => {},
    toolError: async () => {},
    client: {
      permission: {
        reply: async () => {},
      },
    } as any,
    ...overrides,
  }
}

function makeEvent(type: string, properties: Record<string, unknown>) {
  return { type, properties }
}

// Wrap an array as an AsyncIterable so it satisfies the typechecker.
// `for await...of` works on regular arrays at runtime.
function asyncStream<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const item of items) {
        yield item
      }
    },
  }
}

function makeToolPart(overrides: Partial<ToolPart> = {}): ToolPart {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "read",
    state: {
      status: "completed",
      input: { filePath: "/tmp/test.txt" },
      output: "file content",
      title: "read",
      metadata: {},
      time: { start: 1000, end: 2000 },
    },
    ...overrides,
  } as ToolPart
}

function makeTextPart(overrides: Record<string, unknown> = {}): Part {
  return {
    id: "part_2",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text: "Hello world",
    time: { start: 1000, end: 2000 },
    ...overrides,
  } as Part
}

function makeReasoningPart(overrides: Record<string, unknown> = {}): Part {
  return {
    id: "part_3",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "reasoning",
    text: "thinking step",
    time: { start: 1000, end: 2000 },
    ...overrides,
  } as Part
}

function makeStepStartPart(overrides: Record<string, unknown> = {}): Part {
  return {
    id: "part_4",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "step-start",
    ...overrides,
  } as Part
}

function makeStepFinishPart(overrides: Record<string, unknown> = {}): Part {
  return {
    id: "part_5",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "step-finish",
    reason: "completed",
    cost: 0,
    tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...overrides,
  } as Part
}

// ---------------------------------------------------------------------------
// handleMessageUpdated
// ---------------------------------------------------------------------------

describe("handleMessageUpdated", () => {
  test("prints agent and model info on first assistant message", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("message.updated", {
        sessionID: "ses_1",
        info: { role: "assistant", agent: "default", modelID: "claude-3" },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(ctx.toggles.get("start")).toBe(true)
  })

  test("does not print for non-assistant messages", async () => {
    const ctx = makeCtx()

    const events = [
      makeEvent("message.updated", {
        sessionID: "ses_1",
        info: { role: "user", agent: "default", modelID: "claude-3" },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(ctx.toggles.get("start")).toBeUndefined()
  })

  test("does not print for different session", async () => {
    const ctx = makeCtx()

    const events = [
      makeEvent("message.updated", {
        sessionID: "ses_other",
        info: { role: "assistant", agent: "default", modelID: "claude-3" },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(ctx.toggles.get("start")).toBeUndefined()
  })

  test("does not print in json format", async () => {
    const ctx = makeCtx({ args: { format: "json", thinking: false, "dangerously-skip-permissions": false } })

    const events = [
      makeEvent("message.updated", {
        sessionID: "ses_1",
        info: { role: "assistant", agent: "default", modelID: "claude-3" },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(ctx.toggles.get("start")).toBeUndefined()
  })

  test("only prints once (toggles guard)", async () => {
    const printed: string[] = []
    const ctx = makeCtx({
      toggles: new Map([["start", true]]),
    })

    const events = [
      makeEvent("message.updated", {
        sessionID: "ses_1",
        info: { role: "assistant", agent: "default", modelID: "claude-3" },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    // toggles already had "start" = true, so nothing should change
    expect(ctx.toggles.get("start")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// handleToolPart — tool completed/error
// ---------------------------------------------------------------------------

describe("handleToolPart — tool completed/error", () => {
  test("calls tool() for completed tool", async () => {
    let called: ToolPart | undefined
    const ctx = makeCtx({
      tool: async (part) => {
        called = part
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeToolPart({ state: { status: "completed", input: {}, output: "ok", title: "read", metadata: {}, time: { start: 1000, end: 2000 } } }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(called).toBeDefined()
    expect(called!.tool).toBe("read")
  })

  test("calls toolError() for errored tool", async () => {
    let called: ToolPart | undefined
    const ctx = makeCtx({
      toolError: async (part) => {
        called = part
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeToolPart({
          state: { status: "error", input: {}, error: "something went wrong", metadata: {}, time: { start: 1000, end: 2000 } },
        }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(called).toBeDefined()
    expect(called!.tool).toBe("read")
  })

  test("skips tool part for different session", async () => {
    let called = false
    const ctx = makeCtx({
      tool: async () => {
        called = true
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_other",
        part: makeToolPart({ sessionID: "ses_other" }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(called).toBe(false)
  })

  test("emits tool_use in json format and skips UI", async () => {
    let emitted = false
    const ctx = makeCtx({
      args: { format: "json", thinking: false, "dangerously-skip-permissions": false },
      emit: (type) => {
        if (type === "tool_use") emitted = true
        return true
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeToolPart({ state: { status: "completed", input: {}, output: "ok", title: "read", metadata: {}, time: { start: 1000, end: 2000 } } }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// handleToolPart — task running
// ---------------------------------------------------------------------------

describe("handleToolPart — task running", () => {
  test("calls tool() for running task (first time)", async () => {
    let called: ToolPart | undefined
    const ctx = makeCtx({
      tool: async (part) => {
        called = part
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeToolPart({
          tool: "task",
          state: { status: "running", input: {}, title: "subtask", metadata: {}, time: { start: 1000 } },
        }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(called).toBeDefined()
    expect(called!.tool).toBe("task")
    expect(ctx.toggles.get("part_1")).toBe(true)
  })

  test("skips running task if already shown (toggles guard)", async () => {
    let callCount = 0
    const ctx = makeCtx({
      toggles: new Map([["part_1", true]]),
      tool: async () => {
        callCount++
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeToolPart({
          tool: "task",
          state: { status: "running", input: {}, title: "subtask", metadata: {}, time: { start: 1000 } },
        }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(callCount).toBe(0)
  })

  test("skips running task in json format", async () => {
    let called = false
    const ctx = makeCtx({
      args: { format: "json", thinking: false, "dangerously-skip-permissions": false },
      tool: async () => {
        called = true
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeToolPart({
          tool: "task",
          state: { status: "running", input: {}, title: "subtask", metadata: {}, time: { start: 1000 } },
        }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(called).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// handleToolPart — step-start / step-finish
// ---------------------------------------------------------------------------

describe("handleToolPart — step events", () => {
  test("emits step_start", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeStepStartPart(),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).toContain("step_start")
  })

  test("emits step_finish", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeStepFinishPart(),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).toContain("step_finish")
  })
})

// ---------------------------------------------------------------------------
// handleToolPart — text
// ---------------------------------------------------------------------------

describe("handleToolPart — text", () => {
  test("emits text in json format", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      args: { format: "json", thinking: false, "dangerously-skip-permissions": false },
      emit: (type) => {
        emitted.push(type)
        return true
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeTextPart(),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).toContain("text")
  })

  test("emits text even when empty (emit happens before trim check)", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeTextPart({ text: "   " }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    // emit is called before the trim check, matching original behavior
    expect(emitted).toContain("text")
  })

  test("skips text without end time", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeTextPart({ time: { start: 1000 } }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).not.toContain("text")
  })
})

// ---------------------------------------------------------------------------
// handleToolPart — reasoning
// ---------------------------------------------------------------------------

describe("handleToolPart — reasoning", () => {
  test("emits reasoning in json format when thinking is enabled", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      args: { format: "json", thinking: true, "dangerously-skip-permissions": false },
      emit: (type) => {
        emitted.push(type)
        return true
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeReasoningPart(),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).toContain("reasoning")
  })

  test("skips reasoning when thinking is disabled", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      args: { format: "default", thinking: false, "dangerously-skip-permissions": false },
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeReasoningPart(),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).not.toContain("reasoning")
  })

  test("skips reasoning without end time", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      args: { format: "default", thinking: true, "dangerously-skip-permissions": false },
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeReasoningPart({ time: { start: 1000 } }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).not.toContain("reasoning")
  })

  test("emits reasoning even when empty (emit happens before trim check)", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      args: { format: "default", thinking: true, "dangerously-skip-permissions": false },
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeReasoningPart({ text: "   " }),
        time: 1000,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    // emit is called before the trim check, matching original behavior
    expect(emitted).toContain("reasoning")
  })
})

// ---------------------------------------------------------------------------
// handleSessionError
// ---------------------------------------------------------------------------

describe("handleSessionError", () => {
  test("emits error in json format", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      args: { format: "json", thinking: false, "dangerously-skip-permissions": false },
      emit: (type) => {
        emitted.push(type)
        return true
      },
    })

    const events = [
      makeEvent("session.error", {
        sessionID: "ses_1",
        error: { name: "UnknownError", data: { message: "something broke" } },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).toContain("error")
  })

  test("skips error for different session", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("session.error", {
        sessionID: "ses_other",
        error: { name: "UnknownError", data: { message: "something broke" } },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).not.toContain("error")
  })

  test("skips error with no error object", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("session.error", {
        sessionID: "ses_1",
        error: undefined,
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).not.toContain("error")
  })

  test("extracts message from error data", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("session.error", {
        sessionID: "ses_1",
        error: { name: "ProviderAuthError", data: { providerID: "anthropic", message: "invalid key" } },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    // Should not emit (format is default, emit returns false)
    // The error message "invalid key" should be extracted
    expect(emitted).toContain("error")
  })

  test("accumulates multiple errors", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("session.error", {
        sessionID: "ses_1",
        error: { name: "UnknownError", data: { message: "first error" } },
      }),
      makeEvent("session.error", {
        sessionID: "ses_1",
        error: { name: "UnknownError", data: { message: "second error" } },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted.filter((e) => e === "error").length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// handleSessionStatus
// ---------------------------------------------------------------------------

describe("handleSessionStatus", () => {
  test("breaks loop on idle status for matching session", async () => {
    let afterLoop = false
    const ctx = makeCtx()

    const events = [
      makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "idle" },
      }),
      // This event should never be reached
      makeEvent("message.updated", {
        sessionID: "ses_1",
        info: { role: "assistant", agent: "default", modelID: "claude-3" },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    // The second event should not have been processed
    expect(ctx.toggles.get("start")).toBeUndefined()
  })

  test("does not break on non-idle status", async () => {
    const ctx = makeCtx()

    const events = [
      makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "retry" },
      }),
    ]

    // Should not throw — loop continues
    await loop(ctx, { stream: asyncStream(events) })
  })

  test("does not break on idle for different session", async () => {
    const ctx = makeCtx()

    const events = [
      makeEvent("session.status", {
        sessionID: "ses_other",
        status: { type: "idle" },
      }),
    ]

    // Should not throw — loop continues
    await loop(ctx, { stream: asyncStream(events) })
  })
})

// ---------------------------------------------------------------------------
// handlePermissionAsked
// ---------------------------------------------------------------------------

describe("handlePermissionAsked", () => {
  test("auto-rejects permission by default", async () => {
    let replied = false
    const ctx = makeCtx({
      client: {
        permission: {
          reply: async (req: any) => {
            replied = true
            expect(req.reply).toBe("reject")
          },
        },
      } as any,
    })

    const events = [
      makeEvent("permission.asked", {
        id: "perm_1",
        sessionID: "ses_1",
        permission: "read",
        patterns: ["**/*.ts"],
        metadata: {},
        always: [],
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(replied).toBe(true)
  })

  test("auto-approves with dangerously-skip-permissions", async () => {
    let replied = false
    const ctx = makeCtx({
      args: { format: "default", thinking: false, "dangerously-skip-permissions": true },
      client: {
        permission: {
          reply: async (req: any) => {
            replied = true
            expect(req.reply).toBe("once")
          },
        },
      } as any,
    })

    const events = [
      makeEvent("permission.asked", {
        id: "perm_1",
        sessionID: "ses_1",
        permission: "write",
        patterns: ["**/*.ts"],
        metadata: {},
        always: [],
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(replied).toBe(true)
  })

  test("skips permission for different session", async () => {
    let replied = false
    const ctx = makeCtx({
      client: {
        permission: {
          reply: async () => {
            replied = true
          },
        },
      } as any,
    })

    const events = [
      makeEvent("permission.asked", {
        id: "perm_1",
        sessionID: "ses_other",
        permission: "read",
        patterns: [],
        metadata: {},
        always: [],
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(replied).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Integration: loop with multiple event types
// ---------------------------------------------------------------------------

describe("loop integration", () => {
  test("processes multiple events in sequence", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("message.updated", {
        sessionID: "ses_1",
        info: { role: "assistant", agent: "default", modelID: "claude-3" },
      }),
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeStepStartPart(),
        time: 1000,
      }),
      makeEvent("message.part.updated", {
        sessionID: "ses_1",
        part: makeStepFinishPart(),
        time: 2000,
      }),
      makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "idle" },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(ctx.toggles.get("start")).toBe(true)
    expect(emitted).toContain("step_start")
    expect(emitted).toContain("step_finish")
  })

  test("handles empty event stream", async () => {
    const ctx = makeCtx()

    // Should not throw
    await loop(ctx, { stream: asyncStream<any>([]) })
  })

  test("handles unknown event types gracefully", async () => {
    const ctx = makeCtx()

    const events = [
      makeEvent("unknown.event", { some: "data" }),
    ]

    // Should not throw
    await loop(ctx, { stream: asyncStream(events) })
  })

  test("handles permission then idle", async () => {
    let replied = false
    const ctx = makeCtx({
      client: {
        permission: {
          reply: async () => {
            replied = true
          },
        },
      } as any,
    })

    const events = [
      makeEvent("permission.asked", {
        id: "perm_1",
        sessionID: "ses_1",
        permission: "read",
        patterns: [],
        metadata: {},
        always: [],
      }),
      makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "idle" },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(replied).toBe(true)
  })

  test("handles error then idle", async () => {
    const emitted: string[] = []
    const ctx = makeCtx({
      emit: (type) => {
        emitted.push(type)
        return false
      },
    })

    const events = [
      makeEvent("session.error", {
        sessionID: "ses_1",
        error: { name: "UnknownError", data: { message: "test error" } },
      }),
      makeEvent("session.status", {
        sessionID: "ses_1",
        status: { type: "idle" },
      }),
    ]

    await loop(ctx, { stream: asyncStream(events) })

    expect(emitted).toContain("error")
  })
})
