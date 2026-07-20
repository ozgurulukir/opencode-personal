import { describe, expect, test } from "bun:test"
import {
  createSessionData,
  reduceSessionData,
  bootstrapSessionData,
  flushInterrupted,
  pickBlockerView,
  blockerStatus,
  formatError,
} from "../../../../src/cli/cmd/run/session-data"
import type { Event, Part, PermissionRequest, QuestionRequest, ToolPart } from "@opencode-ai/sdk/v2"

const SESSION_ID = "ses_test"

function msgEvent(overrides: Record<string, unknown> = {}): Event & { type: "message.updated" } {
  return {
    id: "evt_1",
    type: "message.updated",
    properties: {
      sessionID: SESSION_ID,
      info: {
        id: "msg_1",
        role: "assistant",
        modelID: "claude-3-5-sonnet",
        providerID: "anthropic",
        tokens: { input: 10, output: 20 },
        cost: 0.0015,
        ...(overrides.info as Record<string, unknown> ?? {}),
      },
      ...overrides,
    },
  } as any
}

function deltaEvent(overrides: Record<string, unknown> = {}): Event & { type: "message.part.delta" } {
  return {
    id: "evt_2",
    type: "message.part.delta",
    properties: {
      sessionID: SESSION_ID,
      messageID: "msg_1",
      partID: "part_1",
      field: "text",
      delta: "Hello world",
      ...overrides,
    },
  } as any
}

function partUpdatedEvent(part: Partial<Part> = {}, overrides: Record<string, unknown> = {}): Event & { type: "message.part.updated" } {
  return {
    id: "evt_3",
    type: "message.part.updated",
    properties: {
      sessionID: SESSION_ID,
      time: 1000,
      part: {
        id: "part_1",
        sessionID: SESSION_ID,
        messageID: "msg_1",
        type: "text",
        text: "Hello world",
        ...part,
      },
      ...overrides,
    },
  } as any
}

function toolPartUpdatedEvent(
  toolPart: Partial<ToolPart> = {},
  overrides: Record<string, unknown> = {},
): Event & { type: "message.part.updated" } {
  return {
    id: "evt_4",
    type: "message.part.updated",
    properties: {
      sessionID: SESSION_ID,
      time: 1000,
      part: {
        id: "tool_1",
        sessionID: SESSION_ID,
        messageID: "msg_1",
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: { status: "running", input: { command: "ls" }, time: { start: 100 } },
        ...toolPart,
      },
      ...overrides,
    },
  } as any
}

function permissionAskedEvent(overrides: Record<string, unknown> = {}): Event & { type: "permission.asked" } {
  return {
    id: "evt_5",
    type: "permission.asked",
    properties: {
      id: "perm_1",
      sessionID: SESSION_ID,
      permission: "write",
      patterns: ["**/*.ts"],
      metadata: {},
      always: [],
      ...overrides,
    },
  } as any
}

function permissionRepliedEvent(overrides: Record<string, unknown> = {}): Event & { type: "permission.replied" } {
  return {
    id: "evt_6",
    type: "permission.replied",
    properties: {
      sessionID: SESSION_ID,
      requestID: "perm_1",
      reply: "once",
      ...overrides,
    },
  } as any
}

function questionAskedEvent(overrides: Record<string, unknown> = {}): Event & { type: "question.asked" } {
  return {
    id: "evt_7",
    type: "question.asked",
    properties: {
      id: "q_1",
      sessionID: SESSION_ID,
      questions: [{ header: "Confirm", question: "Proceed?", options: [{ label: "Yes", description: "Do it" }] }],
      ...overrides,
    },
  } as any
}

function questionRepliedEvent(overrides: Record<string, unknown> = {}): Event & { type: "question.replied" } {
  return {
    id: "evt_8",
    type: "question.replied",
    properties: {
      sessionID: SESSION_ID,
      requestID: "q_1",
      answers: [["Yes"]],
      ...overrides,
    },
  } as any
}

function questionRejectedEvent(overrides: Record<string, unknown> = {}): Event & { type: "question.rejected" } {
  return {
    id: "evt_9",
    type: "question.rejected",
    properties: {
      sessionID: SESSION_ID,
      requestID: "q_1",
      ...overrides,
    },
  } as any
}

function sessionErrorEvent(overrides: Record<string, unknown> = {}): Event & { type: "session.error" } {
  return {
    id: "evt_10",
    type: "session.error",
    properties: {
      sessionID: SESSION_ID,
      error: { name: "APIError", message: "Rate limit exceeded" },
      ...overrides,
    },
  } as any
}

function makeInput(data = createSessionData(), event: Event, overrides: Record<string, unknown> = {}) {
  return {
    data,
    event,
    sessionID: SESSION_ID,
    thinking: false,
    limits: {},
    ...overrides,
  }
}

// ─── createSessionData ───────────────────────────────────────────────────────

describe("createSessionData", () => {
  test("creates empty session data with defaults", () => {
    const data = createSessionData()
    expect(data.includeUserText).toBe(false)
    expect(data.announced).toBe(false)
    expect(data.ids.size).toBe(0)
    expect(data.tools.size).toBe(0)
    expect(data.call.size).toBe(0)
    expect(data.permissions).toEqual([])
    expect(data.questions).toEqual([])
    expect(data.role.size).toBe(0)
    expect(data.msg.size).toBe(0)
    expect(data.part.size).toBe(0)
    expect(data.text.size).toBe(0)
    expect(data.sent.size).toBe(0)
    expect(data.end.size).toBe(0)
    expect(data.echo.size).toBe(0)
  })

  test("creates session data with includeUserText", () => {
    const data = createSessionData({ includeUserText: true })
    expect(data.includeUserText).toBe(true)
  })
})

// ─── formatError ──────────────────────────────────────────────────────────────

describe("formatError", () => {
  test("returns data.message when available", () => {
    expect(formatError({ data: { message: "inner msg" }, message: "outer msg" })).toBe("inner msg")
  })

  test("returns message when no data.message", () => {
    expect(formatError({ message: "something broke" })).toBe("something broke")
  })

  test("returns name when no message", () => {
    expect(formatError({ name: "SomeError" })).toBe("SomeError")
  })

  test("returns fallback for empty error", () => {
    expect(formatError({})).toBe("unknown error")
  })
})

// ─── pickBlockerView / blockerStatus ─────────────────────────────────────────

describe("pickBlockerView", () => {
  test("returns prompt view when no blockers", () => {
    expect(pickBlockerView({})).toEqual({ type: "prompt" })
  })

  test("returns permission view when permission exists", () => {
    const perm: PermissionRequest = { id: "p1", sessionID: SESSION_ID, permission: "write", patterns: [], metadata: {}, always: [] }
    const result = pickBlockerView({ permission: perm })
    expect(result.type).toBe("permission")
    expect((result as any).request).toBe(perm)
  })

  test("returns question view when question exists", () => {
    const q: QuestionRequest = { id: "q1", sessionID: SESSION_ID, questions: [] }
    const result = pickBlockerView({ question: q })
    expect(result.type).toBe("question")
    expect((result as any).request).toBe(q)
  })

  test("permission takes priority over question", () => {
    const perm: PermissionRequest = { id: "p1", sessionID: SESSION_ID, permission: "write", patterns: [], metadata: {}, always: [] }
    const q: QuestionRequest = { id: "q1", sessionID: SESSION_ID, questions: [] }
    const result = pickBlockerView({ permission: perm, question: q })
    expect(result.type).toBe("permission")
  })
})

describe("blockerStatus", () => {
  test("returns empty for prompt view", () => {
    expect(blockerStatus({ type: "prompt" })).toBe("")
  })

  test("returns awaiting permission for permission view", () => {
    expect(blockerStatus({ type: "permission", request: {} as any })).toBe("awaiting permission")
  })

  test("returns awaiting answer for question view", () => {
    expect(blockerStatus({ type: "question", request: {} as any })).toBe("awaiting answer")
  })
})

// ─── message.updated ──────────────────────────────────────────────────────────

describe("reduceSessionData: message.updated", () => {
  test("ignores event for different sessionID", () => {
    const data = createSessionData()
    const event = msgEvent({ sessionID: "other_ses" })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
    expect(out.footer).toBeUndefined()
  })

  test("sets role and replays buffered parts for assistant message", () => {
    const data = createSessionData()
    // First send a part.updated to buffer a text part
    const partEvt = partUpdatedEvent({ id: "part_1", messageID: "msg_1", type: "text", text: "Hello" })
    reduceSessionData(makeInput(data, partEvt))
    expect(data.role.get("msg_1")).toBeUndefined()
    expect(data.text.get("part_1")).toBe("Hello")

    // Now send message.updated to learn the role
    const msgEvt = msgEvent({ info: { id: "msg_1", role: "assistant" } })
    const out = reduceSessionData(makeInput(data, msgEvt))
    expect(data.role.get("msg_1")).toBe("assistant")
    expect(out.commits.length).toBeGreaterThan(0)
    expect(out.commits[0].kind).toBe("assistant")
    expect(out.commits[0].text).toContain("Hello")
  })

  test("sets announced flag on first assistant message", () => {
    const data = createSessionData()
    const event = msgEvent({ info: { id: "msg_1", role: "assistant" } })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.announced).toBe(true)
    expect(out.footer?.patch?.status).toBe("assistant responding")
  })

  test("does not set announced on non-assistant message", () => {
    const data = createSessionData()
    const event = msgEvent({ info: { id: "msg_1", role: "user" } })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.announced).toBe(false)
    expect(out.footer?.patch?.status).toBeUndefined()
  })

  test("includes usage info in footer patch when tokens present", () => {
    const data = createSessionData()
    const event = msgEvent({ info: { id: "msg_1", role: "assistant", tokens: { input: 10, output: 20 }, cost: 0.0015 } })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.footer?.patch?.usage).toBeTruthy()
    expect(out.footer?.patch?.usage).toContain("30")
  })

  test("emits error commit when message has error", () => {
    const data = createSessionData()
    const event = msgEvent({ info: { id: "msg_1", role: "assistant", error: { name: "APIError", message: "Server error" } } })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits.length).toBeGreaterThan(0)
    expect(out.commits.some((c) => c.kind === "error")).toBe(true)
    expect(out.commits.find((c) => c.kind === "error")?.text).toBe("Server error")
  })

  test("does not emit error for MessageAbortedError", () => {
    const data = createSessionData()
    const event = msgEvent({ info: { id: "msg_1", role: "assistant", error: { name: "MessageAbortedError", message: "Aborted" } } })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits.some((c) => c.kind === "error")).toBe(false)
  })

  test("does not emit duplicate error for same message", () => {
    const data = createSessionData()
    const event1 = msgEvent({ info: { id: "msg_1", role: "assistant", error: { name: "APIError", message: "Server error" } } })
    reduceSessionData(makeInput(data, event1))
    const event2 = msgEvent({ info: { id: "msg_1", role: "assistant", error: { name: "APIError", message: "Server error" } } })
    const out = reduceSessionData(makeInput(data, event2))
    expect(out.commits.filter((c) => c.kind === "error").length).toBe(0)
  })

  test("drops user-role text parts when includeUserText is false", () => {
    const data = createSessionData()
    const partEvt = partUpdatedEvent({ id: "part_1", messageID: "msg_1", type: "text", text: "user input" })
    reduceSessionData(makeInput(data, partEvt))
    const msgEvt = msgEvent({ info: { id: "msg_1", role: "user" } })
    const out = reduceSessionData(makeInput(data, msgEvt))
    expect(data.ids.has("part_1")).toBe(true)
    expect(data.text.has("part_1")).toBe(false)
  })

  test("keeps user-role text parts when includeUserText is true", () => {
    const data = createSessionData({ includeUserText: true })
    const partEvt = partUpdatedEvent({ id: "part_1", messageID: "msg_1", type: "text", text: "user input" })
    reduceSessionData(makeInput(data, partEvt))
    const msgEvt = msgEvent({ info: { id: "msg_1", role: "user" } })
    const out = reduceSessionData(makeInput(data, msgEvt))
    expect(out.commits.some((c) => c.kind === "user")).toBe(true)
  })

  test("drops reasoning parts when thinking is disabled", () => {
    const data = createSessionData()
    const partEvt = partUpdatedEvent({ id: "part_1", messageID: "msg_1", type: "reasoning", text: "thinking..." })
    reduceSessionData(makeInput(data, partEvt))
    const msgEvt = msgEvent({ info: { id: "msg_1", role: "assistant" } })
    const out = reduceSessionData(makeInput(data, msgEvt, { thinking: false }))
    expect(data.ids.has("part_1")).toBe(false)
    expect(data.text.has("part_1")).toBe(false)
  })

  test("keeps reasoning parts when thinking is enabled", () => {
    const data = createSessionData()
    // reasoning part with time.end, sent with thinking=true so it's buffered
    const partEvt = partUpdatedEvent({ id: "part_1", messageID: "msg_1", type: "reasoning", text: "thinking...", time: { start: 100, end: 200 } })
    reduceSessionData(makeInput(data, partEvt, { thinking: true }))
    const msgEvt = msgEvent({ info: { id: "msg_1", role: "assistant" } })
    const out = reduceSessionData(makeInput(data, msgEvt, { thinking: true }))
    expect(out.commits.some((c) => c.kind === "reasoning")).toBe(true)
  })
})

// ─── message.part.delta ──────────────────────────────────────────────────────

describe("reduceSessionData: message.part.delta", () => {
  test("ignores event for different sessionID", () => {
    const data = createSessionData()
    const event = deltaEvent({ sessionID: "other_ses" })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
  })

  test("ignores event with missing partID", () => {
    const data = createSessionData()
    const event = deltaEvent({ partID: undefined })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
  })

  test("ignores non-text field deltas", () => {
    const data = createSessionData()
    const event = deltaEvent({ field: "metadata" })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
  })

  test("accumulates text for known part kind", () => {
    const data = createSessionData()
    // First register the part kind via part.updated
    const partEvt = partUpdatedEvent({ id: "part_1", messageID: "msg_1", type: "text", text: "" })
    reduceSessionData(makeInput(data, partEvt))
    // Set role so text is ready
    const msgEvt = msgEvent({ info: { id: "msg_1", role: "assistant" } })
    reduceSessionData(makeInput(data, msgEvt))

    // Now send deltas
    const d1 = deltaEvent({ partID: "part_1", delta: "Hello " })
    const out1 = reduceSessionData(makeInput(data, d1))
    expect(out1.commits.length).toBeGreaterThan(0)
    expect(out1.commits[0].text).toContain("Hello")

    const d2 = deltaEvent({ partID: "part_1", delta: "world" })
    const out2 = reduceSessionData(makeInput(data, d2))
    expect(out2.commits.length).toBeGreaterThan(0)
    expect(out2.commits[0].text).toContain("world")
  })

  test("buffers text when part kind is unknown", () => {
    const data = createSessionData()
    const event = deltaEvent({ partID: "part_1", delta: "buffered text" })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
    expect(data.text.get("part_1")).toBe("buffered text")
  })

  test("ignores delta for already-committed part", () => {
    const data = createSessionData()
    data.ids.add("part_1")
    const event = deltaEvent({ partID: "part_1", delta: "ignored" })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
  })

  test("stores messageID mapping", () => {
    const data = createSessionData()
    const event = deltaEvent({ partID: "part_1", messageID: "msg_1", delta: "text" })
    reduceSessionData(makeInput(data, event))
    expect(data.msg.get("part_1")).toBe("msg_1")
  })
})

// ─── message.part.updated: text parts ────────────────────────────────────────

describe("reduceSessionData: message.part.updated (text)", () => {
  test("ignores event for different sessionID", () => {
    const data = createSessionData()
    const event = partUpdatedEvent({ sessionID: "other_ses" } as any)
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
  })

  test("ignores already-committed part", () => {
    const data = createSessionData()
    data.ids.add("part_1")
    const event = partUpdatedEvent({ id: "part_1" })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
  })

  test("drops user text part when includeUserText is false and role is known", () => {
    const data = createSessionData()
    data.role.set("msg_1", "user")
    const event = partUpdatedEvent({ id: "part_1", messageID: "msg_1", type: "text", text: "user input" })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.ids.has("part_1")).toBe(true)
    expect(out.commits).toEqual([])
  })

  test("drops reasoning part when thinking is disabled and part has ended", () => {
    const data = createSessionData()
    const event = partUpdatedEvent({
      id: "part_1",
      messageID: "msg_1",
      type: "reasoning",
      text: "thinking...",
      time: { start: 100, end: 200 },
    })
    const out = reduceSessionData(makeInput(data, event, { thinking: false }))
    expect(data.ids.has("part_1")).toBe(true)
    expect(data.text.has("part_1")).toBe(false)
  })

  test("drops reasoning part when thinking is disabled and part has not ended", () => {
    const data = createSessionData()
    const event = partUpdatedEvent({
      id: "part_1",
      messageID: "msg_1",
      type: "reasoning",
      text: "thinking...",
      time: { start: 100 },
    })
    const out = reduceSessionData(makeInput(data, event, { thinking: false }))
    expect(data.ids.has("part_1")).toBe(false)
    expect(data.text.has("part_1")).toBe(false)
  })

  test("registers part kind and syncs text", () => {
    const data = createSessionData()
    data.role.set("msg_1", "assistant")
    const event = partUpdatedEvent({ id: "part_1", messageID: "msg_1", type: "text", text: "Hello" })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.part.get("part_1")).toBe("assistant")
    expect(data.text.get("part_1")).toBe("Hello")
    expect(out.commits.length).toBeGreaterThan(0)
  })

  test("flushes part and marks as done when time.end is present", () => {
    const data = createSessionData()
    data.role.set("msg_1", "assistant")
    const event = partUpdatedEvent({
      id: "part_1",
      messageID: "msg_1",
      type: "text",
      text: "Done",
      time: { start: 100, end: 200 },
    })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.ids.has("part_1")).toBe(true)
    expect(data.text.has("part_1")).toBe(false)
  })

  test("buffers part when message role is not yet known", () => {
    const data = createSessionData()
    const event = partUpdatedEvent({ id: "part_1", messageID: "msg_1", type: "text", text: "buffered" })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
    expect(data.text.get("part_1")).toBe("buffered")
  })

  test("converts assistant kind to user when role is user", () => {
    const data = createSessionData({ includeUserText: true })
    data.role.set("msg_1", "user")
    const event = partUpdatedEvent({ id: "part_1", messageID: "msg_1", type: "text", text: "user text" })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.part.get("part_1")).toBe("user")
  })
})

// ─── message.part.updated: tool parts ────────────────────────────────────────

describe("reduceSessionData: message.part.updated (tool)", () => {
  test("emits start commit for running tool", () => {
    const data = createSessionData()
    const event = toolPartUpdatedEvent({ id: "tool_1", state: { status: "running", input: { command: "ls" }, time: { start: 100 } } })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits.length).toBeGreaterThan(0)
    expect(out.commits[0].phase).toBe("start")
    expect(out.commits[0].toolState).toBe("running")
    expect(data.tools.has("tool_1")).toBe(true)
  })

  test("does not emit duplicate start for already-seen tool", () => {
    const data = createSessionData()
    data.tools.add("tool_1")
    const event = toolPartUpdatedEvent({ id: "tool_1", state: { status: "running", input: { command: "ls" }, time: { start: 100 } } })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits.filter((c) => c.phase === "start").length).toBe(0)
  })

  test("emits completed tool with output commit (bash: output=true, final=false)", () => {
    const data = createSessionData()
    const event = toolPartUpdatedEvent({
      id: "tool_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "file1\nfile2",
        title: "bash",
        metadata: {},
        time: { start: 100, end: 200 },
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits.length).toBeGreaterThan(0)
    const progress = out.commits.find((c) => c.phase === "progress")
    expect(progress).toBeDefined()
    expect(progress!.text).toBe("file1\nfile2")
    // bash has final:false, so no final commit
    const final = out.commits.find((c) => c.phase === "final")
    expect(final).toBeUndefined()
  })

  test("emits start + final for completed tool not previously seen (edit: final=true)", () => {
    const data = createSessionData()
    const event = toolPartUpdatedEvent({
      id: "tool_1",
      tool: "edit",
      state: {
        status: "completed",
        input: { filePath: "/tmp/test.txt", oldString: "old", newString: "new" },
        output: "edited",
        title: "edit",
        metadata: { diff: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new" },
        time: { start: 100, end: 200 },
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    const start = out.commits.find((c) => c.phase === "start")
    expect(start).toBeDefined()
    const final = out.commits.find((c) => c.phase === "final")
    expect(final).toBeDefined()
  })

  test("emits error tool commit with error text", () => {
    const data = createSessionData()
    const event = toolPartUpdatedEvent({
      id: "tool_1",
      tool: "bash",
      state: {
        status: "error",
        input: { command: "ls" },
        error: "command not found",
        time: { start: 100, end: 200 },
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    const error = out.commits.find((c) => c.toolState === "error")
    expect(error).toBeDefined()
    expect(error!.toolError).toBe("command not found")
  })

  test("uses fallback error text when error is empty", () => {
    const data = createSessionData()
    const event = toolPartUpdatedEvent({
      id: "tool_1",
      tool: "bash",
      state: {
        status: "error",
        input: { command: "ls" },
        error: "",
        time: { start: 100, end: 200 },
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    const error = out.commits.find((c) => c.toolState === "error")
    expect(error!.toolError).toBe("unknown error")
  })

  test("ignores already-committed tool part", () => {
    const data = createSessionData()
    data.ids.add("tool_1")
    const event = toolPartUpdatedEvent({ id: "tool_1", state: { status: "completed", input: {}, output: "", title: "", metadata: {}, time: { start: 100, end: 200 } } })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
  })

  test("stashes echo output for bash tool", () => {
    const data = createSessionData()
    const event = toolPartUpdatedEvent({
      id: "tool_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "echo hi" },
        output: "hi",
        title: "bash",
        metadata: {},
        time: { start: 100, end: 200 },
      },
    })
    reduceSessionData(makeInput(data, event))
    expect(data.echo.size).toBe(1)
    const set = data.echo.get("msg_1")
    expect(set).toBeDefined()
    expect(set!.has("hi")).toBe(true)
  })

  test("does not stash echo for non-bash tool", () => {
    const data = createSessionData()
    const event = toolPartUpdatedEvent({
      id: "tool_1",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "/tmp/test.txt" },
        output: "content",
        title: "read",
        metadata: {},
        time: { start: 100, end: 200 },
      },
    })
    reduceSessionData(makeInput(data, event))
    expect(data.echo.size).toBe(0)
  })

  test("updates status patch for running tool", () => {
    const data = createSessionData()
    const event = toolPartUpdatedEvent({ id: "tool_1", tool: "bash", state: { status: "running", input: { command: "ls" }, time: { start: 100 } } })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.footer?.patch?.status).toContain("running bash")
  })

  test("shows description for task tool", () => {
    const data = createSessionData()
    const event = toolPartUpdatedEvent({
      id: "tool_1",
      tool: "task",
      state: {
        status: "running",
        input: { description: "Fix the bug", subagent_type: "coder" },
        time: { start: 100 },
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.footer?.patch?.status).toContain("running Fix the bug")
  })

  test("falls back to subagent_type for task tool", () => {
    const data = createSessionData()
    const event = toolPartUpdatedEvent({
      id: "tool_1",
      tool: "task",
      state: {
        status: "running",
        input: { subagent_type: "explore" },
        time: { start: 100 },
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.footer?.patch?.status).toContain("running explore")
  })
})

// ─── permission events ───────────────────────────────────────────────────────

describe("reduceSessionData: permission events", () => {
  test("adds permission to queue on permission.asked", () => {
    const data = createSessionData()
    const event = permissionAskedEvent()
    const out = reduceSessionData(makeInput(data, event))
    expect(data.permissions.length).toBe(1)
    expect(data.permissions[0].id).toBe("perm_1")
    expect(out.footer?.view?.type).toBe("permission")
  })

  test("ignores permission.asked for different sessionID", () => {
    const data = createSessionData()
    const event = permissionAskedEvent({ sessionID: "other_ses" })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.permissions.length).toBe(0)
    expect(out.footer).toBeUndefined()
  })

  test("removes permission on permission.replied", () => {
    const data = createSessionData()
    data.permissions.push({ id: "perm_1", sessionID: SESSION_ID, permission: "write", patterns: [], metadata: {}, always: [] })
    const event = permissionRepliedEvent()
    const out = reduceSessionData(makeInput(data, event))
    expect(data.permissions.length).toBe(0)
    expect(out.footer?.view?.type).toBe("prompt")
  })

  test("ignores permission.replied for unknown requestID", () => {
    const data = createSessionData()
    const event = permissionRepliedEvent({ requestID: "unknown" })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.footer).toBeUndefined()
  })

  test("upserts permission (replaces existing with same id)", () => {
    const data = createSessionData()
    const event1 = permissionAskedEvent({ id: "perm_1" })
    reduceSessionData(makeInput(data, event1))
    const event2 = permissionAskedEvent({ id: "perm_1", permission: "read" })
    const out = reduceSessionData(makeInput(data, event2))
    expect(data.permissions.length).toBe(1)
    expect(data.permissions[0].permission).toBe("read")
  })

  test("queues multiple permissions and shows first", () => {
    const data = createSessionData()
    reduceSessionData(makeInput(data, permissionAskedEvent({ id: "perm_1" })))
    const out = reduceSessionData(makeInput(data, permissionAskedEvent({ id: "perm_2" })))
    expect(data.permissions.length).toBe(2)
    expect(out.footer?.view?.type).toBe("permission")
  })

  test("falls back to next permission when first is removed", () => {
    const data = createSessionData()
    reduceSessionData(makeInput(data, permissionAskedEvent({ id: "perm_1" })))
    reduceSessionData(makeInput(data, permissionAskedEvent({ id: "perm_2" })))
    const out = reduceSessionData(makeInput(data, permissionRepliedEvent({ requestID: "perm_1" })))
    expect(data.permissions.length).toBe(1)
    expect(data.permissions[0].id).toBe("perm_2")
    expect(out.footer?.view?.type).toBe("permission")
  })
})

// ─── question events ─────────────────────────────────────────────────────────

describe("reduceSessionData: question events", () => {
  test("adds question to queue on question.asked", () => {
    const data = createSessionData()
    const event = questionAskedEvent()
    const out = reduceSessionData(makeInput(data, event))
    expect(data.questions.length).toBe(1)
    expect(out.footer?.view?.type).toBe("question")
  })

  test("removes question on question.replied", () => {
    const data = createSessionData()
    data.questions.push({ id: "q_1", sessionID: SESSION_ID, questions: [] })
    const event = questionRepliedEvent()
    const out = reduceSessionData(makeInput(data, event))
    expect(data.questions.length).toBe(0)
    expect(out.footer?.view?.type).toBe("prompt")
  })

  test("removes question on question.rejected", () => {
    const data = createSessionData()
    data.questions.push({ id: "q_1", sessionID: SESSION_ID, questions: [] })
    const event = questionRejectedEvent()
    const out = reduceSessionData(makeInput(data, event))
    expect(data.questions.length).toBe(0)
    expect(out.footer?.view?.type).toBe("prompt")
  })

  test("ignores question.replied for unknown requestID", () => {
    const data = createSessionData()
    const event = questionRepliedEvent({ requestID: "unknown" })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.footer).toBeUndefined()
  })

  test("upserts question (replaces existing with same id)", () => {
    const data = createSessionData()
    reduceSessionData(makeInput(data, questionAskedEvent({ id: "q_1" })))
    const event2 = questionAskedEvent({ id: "q_1", questions: [{ header: "Updated", question: "Really?", options: [{ label: "No", description: "Nope" }] }] })
    const out = reduceSessionData(makeInput(data, event2))
    expect(data.questions.length).toBe(1)
    expect(data.questions[0].questions[0].header).toBe("Updated")
  })
})

// ─── session.error ──────────────────────────────────────────────────────────

describe("reduceSessionData: session.error", () => {
  test("emits error commit", () => {
    const data = createSessionData()
    const event = sessionErrorEvent()
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits.length).toBe(1)
    expect(out.commits[0].kind).toBe("error")
    expect(out.commits[0].text).toBe("Rate limit exceeded")
  })

  test("ignores error for different sessionID", () => {
    const data = createSessionData()
    const event = sessionErrorEvent({ sessionID: "other_ses" })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
  })

  test("ignores error with no error object", () => {
    const data = createSessionData()
    const event = sessionErrorEvent({ error: undefined })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
  })
})

// ─── unknown events ──────────────────────────────────────────────────────────

describe("reduceSessionData: unknown events", () => {
  test("returns empty output for unhandled event type", () => {
    const data = createSessionData()
    const event = { id: "evt_x", type: "unknown.event", properties: {} } as any
    const out = reduceSessionData(makeInput(data, event))
    expect(out.commits).toEqual([])
    expect(out.footer).toBeUndefined()
  })
})

// ─── flushInterrupted ────────────────────────────────────────────────────────

describe("flushInterrupted", () => {
  test("flushes all in-flight parts as interrupted", () => {
    const data = createSessionData()
    data.part.set("part_1", "assistant")
    data.text.set("part_1", "partial text")
    data.msg.set("part_1", "msg_1")
    data.role.set("msg_1", "assistant")

    const commits: any[] = []
    flushInterrupted(data, commits)
    expect(commits.length).toBeGreaterThan(0)
    // The progress commit carries the text, the final commit has empty text with interrupted flag
    const progress = commits.find((c) => c.phase === "progress")
    expect(progress).toBeDefined()
    expect(progress!.text).toBe("partial text")
    const interrupted = commits.find((c) => c.interrupted === true)
    expect(interrupted).toBeDefined()
    expect(interrupted!.phase).toBe("final")
  })

  test("skips already-committed parts", () => {
    const data = createSessionData()
    data.ids.add("part_1")
    data.part.set("part_1", "assistant")
    data.text.set("part_1", "text")

    const commits: any[] = []
    flushInterrupted(data, commits)
    expect(commits.length).toBe(0)
  })

  test("drops user-role parts when includeUserText is false", () => {
    const data = createSessionData()
    data.part.set("part_1", "assistant")
    data.text.set("part_1", "user text")
    data.msg.set("part_1", "msg_1")
    data.role.set("msg_1", "user")

    const commits: any[] = []
    flushInterrupted(data, commits)
    expect(data.ids.has("part_1")).toBe(true)
    expect(commits.length).toBe(0)
  })

  test("flushes user-role parts when includeUserText is true", () => {
    const data = createSessionData({ includeUserText: true })
    data.part.set("part_1", "user")
    data.text.set("part_1", "user text")
    data.msg.set("part_1", "msg_1")
    data.role.set("msg_1", "user")

    const commits: any[] = []
    flushInterrupted(data, commits)
    expect(commits.length).toBeGreaterThan(0)
  })
})

// ─── bootstrapSessionData ────────────────────────────────────────────────────

describe("bootstrapSessionData", () => {
  test("loads tool call inputs from messages", () => {
    const data = createSessionData()
    bootstrapSessionData({
      data,
      messages: [
        {
          parts: [
            {
              type: "tool",
              id: "tool_1",
              sessionID: SESSION_ID,
              messageID: "msg_1",
              callID: "call_1",
              tool: "bash",
              state: { input: { command: "ls" } },
            } as unknown as Part,
          ],
        },
      ],
      permissions: [],
      questions: [],
    })
    expect(data.call.get("msg_1:call_1")).toEqual({ command: "ls" })
  })

  test("loads permissions sorted by id", () => {
    const data = createSessionData()
    bootstrapSessionData({
      data,
      messages: [],
      permissions: [
        { id: "perm_b", sessionID: SESSION_ID, permission: "write", patterns: [], metadata: {}, always: [] },
        { id: "perm_a", sessionID: SESSION_ID, permission: "read", patterns: [], metadata: {}, always: [] },
      ],
      questions: [],
    })
    expect(data.permissions.length).toBe(2)
    expect(data.permissions[0].id).toBe("perm_a")
    expect(data.permissions[1].id).toBe("perm_b")
  })

  test("loads questions sorted by id", () => {
    const data = createSessionData()
    bootstrapSessionData({
      data,
      messages: [],
      permissions: [],
      questions: [
        { id: "q_b", sessionID: SESSION_ID, questions: [] },
        { id: "q_a", sessionID: SESSION_ID, questions: [] },
      ],
    })
    expect(data.questions.length).toBe(2)
    expect(data.questions[0].id).toBe("q_a")
    expect(data.questions[1].id).toBe("q_b")
  })

  test("skips non-tool parts in messages", () => {
    const data = createSessionData()
    bootstrapSessionData({
      data,
      messages: [
        {
          parts: [
            { type: "text", id: "text_1", messageID: "msg_1", text: "hello" } as Part,
          ],
        },
      ],
      permissions: [],
      questions: [],
    })
    expect(data.call.size).toBe(0)
  })
})

// ─── echo stripping (integration) ────────────────────────────────────────────

describe("echo stripping", () => {
  test("strips bash output from next assistant text part", () => {
    const data = createSessionData()
    data.role.set("msg_1", "assistant")

    // Complete a bash tool
    const toolEvent = toolPartUpdatedEvent({
      id: "tool_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "echo hi" },
        output: "hi",
        title: "bash",
        metadata: {},
        time: { start: 100, end: 200 },
      },
    })
    reduceSessionData(makeInput(data, toolEvent))

    // Next assistant text part should have echo stripped
    const partEvent = partUpdatedEvent({
      id: "part_2",
      messageID: "msg_1",
      type: "text",
      text: "hi\nHere is the result",
    })
    const out = reduceSessionData(makeInput(data, partEvent))
    const textCommit = out.commits.find((c) => c.kind === "assistant")
    expect(textCommit).toBeDefined()
    expect(textCommit!.text).not.toContain("hi\n")
    expect(textCommit!.text).toContain("Here is the result")
  })

  test("does not strip when no echo data exists", () => {
    const data = createSessionData()
    data.role.set("msg_1", "assistant")

    const partEvent = partUpdatedEvent({
      id: "part_1",
      messageID: "msg_1",
      type: "text",
      text: "Some text without echo",
    })
    const out = reduceSessionData(makeInput(data, partEvent))
    const textCommit = out.commits.find((c) => c.kind === "assistant")
    expect(textCommit!.text).toContain("Some text without echo")
  })
})

// ─── thinking mode ───────────────────────────────────────────────────────────

describe("thinking mode", () => {
  test("prefixes reasoning text with 'Thinking:' when thinking is enabled", () => {
    const data = createSessionData()
    data.role.set("msg_1", "assistant")
    const event = partUpdatedEvent({
      id: "part_1",
      messageID: "msg_1",
      type: "reasoning",
      text: "step by step reasoning",
      time: { start: 100, end: 200 },
    })
    const out = reduceSessionData(makeInput(data, event, { thinking: true }))
    const reasoning = out.commits.find((c) => c.kind === "reasoning")
    expect(reasoning).toBeDefined()
    expect(reasoning!.text).toContain("Thinking:")
    expect(reasoning!.text).toContain("step by step reasoning")
  })

  test("strips [REDACTED] from reasoning text", () => {
    const data = createSessionData()
    data.role.set("msg_1", "assistant")
    const event = partUpdatedEvent({
      id: "part_1",
      messageID: "msg_1",
      type: "reasoning",
      text: "thinking [REDACTED] more",
      time: { start: 100, end: 200 },
    })
    const out = reduceSessionData(makeInput(data, event, { thinking: true }))
    const reasoning = out.commits.find((c) => c.kind === "reasoning")
    expect(reasoning!.text).not.toContain("[REDACTED]")
  })
})

// ─── limits ──────────────────────────────────────────────────────────────────

describe("limits in usage", () => {
  test("shows percentage when limit is set", () => {
    const data = createSessionData()
    const event = msgEvent({
      info: {
        id: "msg_1",
        role: "assistant",
        modelID: "claude-3-5-sonnet",
        providerID: "anthropic",
        tokens: { input: 10, output: 20 },
      },
    })
    const out = reduceSessionData(makeInput(data, event, { limits: { "anthropic/claude-3-5-sonnet": 100 } }))
    expect(out.footer?.patch?.usage).toContain("%")
  })

  test("shows only cost when tokens are zero", () => {
    const data = createSessionData()
    const event = msgEvent({
      info: {
        id: "msg_1",
        role: "assistant",
        modelID: "claude-3-5-sonnet",
        providerID: "anthropic",
        tokens: { input: 0, output: 0 },
        cost: 0.005,
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.footer?.patch?.usage).toContain("$")
  })

  test("shows nothing when tokens are zero and no cost", () => {
    const data = createSessionData()
    const event = msgEvent({
      info: {
        id: "msg_1",
        role: "assistant",
        modelID: "claude-3-5-sonnet",
        providerID: "anthropic",
        tokens: { input: 0, output: 0 },
        cost: 0,
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    expect(out.footer?.patch?.usage).toBeUndefined()
  })
})

// ─── syncPermission (via tool part updated) ──────────────────────────────────

describe("syncPermission via tool part.updated", () => {
  test("updates permission input when tool part has new input", () => {
    const data = createSessionData()
    data.permissions.push({
      id: "perm_1",
      sessionID: SESSION_ID,
      permission: "write",
      patterns: [],
      metadata: {},
      always: [],
      tool: { messageID: "msg_1", callID: "call_1" },
    })
    data.call.set("msg_1:call_1", { filePath: "/old/path" })

    const event = toolPartUpdatedEvent({
      id: "tool_1",
      callID: "call_1",
      tool: "edit",
      state: {
        status: "running",
        input: { filePath: "/new/path" },
        time: { start: 100 },
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.call.get("msg_1:call_1")).toEqual({ filePath: "/new/path" })
  })
})

// ─── syncQuestion (via tool part updated) ────────────────────────────────────

describe("syncQuestion via tool part.updated", () => {
  test("removes question when question tool completes", () => {
    const data = createSessionData()
    data.questions.push({
      id: "q_1",
      sessionID: SESSION_ID,
      questions: [],
      tool: { messageID: "msg_1", callID: "call_1" },
    })

    const event = toolPartUpdatedEvent({
      id: "tool_1",
      callID: "call_1",
      tool: "question",
      state: {
        status: "completed",
        input: {},
        output: "yes",
        title: "question",
        metadata: {},
        time: { start: 100, end: 200 },
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.questions.length).toBe(0)
    expect(out.footer?.view?.type).toBe("prompt")
  })

  test("removes question when question tool errors", () => {
    const data = createSessionData()
    data.questions.push({
      id: "q_1",
      sessionID: SESSION_ID,
      questions: [],
      tool: { messageID: "msg_1", callID: "call_1" },
    })

    const event = toolPartUpdatedEvent({
      id: "tool_1",
      callID: "call_1",
      tool: "question",
      state: {
        status: "error",
        input: {},
        error: "failed",
        time: { start: 100, end: 200 },
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.questions.length).toBe(0)
  })

  test("does not remove question for non-question tool", () => {
    const data = createSessionData()
    data.questions.push({
      id: "q_1",
      sessionID: SESSION_ID,
      questions: [],
      tool: { messageID: "msg_1", callID: "call_1" },
    })

    const event = toolPartUpdatedEvent({
      id: "tool_1",
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "",
        title: "bash",
        metadata: {},
        time: { start: 100, end: 200 },
      },
    })
    const out = reduceSessionData(makeInput(data, event))
    expect(data.questions.length).toBe(1)
  })
})
