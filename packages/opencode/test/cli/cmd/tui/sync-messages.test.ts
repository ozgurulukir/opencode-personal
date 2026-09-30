import { describe, expect, it } from "bun:test"
import type { SessionMessage } from "@opencode-ai/sdk/v2"
import { reduceMessageEvent, type MessageSyncEvent } from "@/cli/cmd/tui/context/sync-messages.shared"
import { dropRevertedRange } from "@/cli/cmd/tui/routes/session/revert-boundary.shared"

/**
 * Characterization tests for the TUI message-state reducer, extracted verbatim
 * from the former inline switch in context/sync.tsx. The guards (out-of-order
 * / duplicate events) are the behavior most at risk during any future
 * unification with the server updater, so they are locked explicitly.
 */

const ev = (id: string, type: string, properties: Record<string, unknown>) =>
  ({ id, type, properties }) as unknown as MessageSyncEvent

const toolPart = (messages: SessionMessage[], callID: string) => {
  const assistant = messages.find((m) => m.type === "assistant")
  if (assistant?.type !== "assistant") throw new Error("expected assistant")
  const tool = assistant.content.findLast((c) => c.type === "tool" && c.id === callID)
  if (tool?.type !== "tool") throw new Error("expected tool part")
  return tool
}

const now = 1726100000000

describe("reduceMessageEvent", () => {
  it("accumulates a full turn in newest-first order", () => {
    const messages: SessionMessage[] = []
    const feed = [
      ev("evt_1", "session.next.prompted", {
        sessionID: "ses_1",
        timestamp: now,
        prompt: { text: "hello", files: [], agents: [] },
        agent: "build",
        model: { id: "m", providerID: "p", variant: "default" },
      }),
      ev("evt_2", "session.next.step.started", {
        sessionID: "ses_1",
        timestamp: now + 1,
        agent: "build",
        model: { id: "m", providerID: "p", variant: "default" },
      }),
      ev("evt_3", "session.next.text.started", { sessionID: "ses_1", timestamp: now + 2 }),
      ev("evt_4", "session.next.text.delta", { sessionID: "ses_1", timestamp: now + 3, delta: "he" }),
      ev("evt_5", "session.next.text.delta", { sessionID: "ses_1", timestamp: now + 4, delta: "llo" }),
      ev("evt_6", "session.next.text.ended", { sessionID: "ses_1", timestamp: now + 5, text: "hello world" }),
      ev("evt_7", "session.next.step.ended", {
        sessionID: "ses_1",
        timestamp: now + 6,
        finish: "stop",
        cost: 0.5,
        tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    ]
    for (const event of feed) reduceMessageEvent(messages, event)

    // newest-first: assistant was unshifted after the user message
    expect(messages.map((m) => m.type)).toEqual(["assistant", "user"])
    const assistant = messages[0]
    if (assistant.type !== "assistant") throw new Error("expected assistant")
    expect(assistant.time.completed).toBe(now + 6)
    expect(assistant.finish).toBe("stop")
    expect(assistant.cost).toBe(0.5)
    expect(assistant.content).toEqual([{ type: "text", text: "hello world" }])
    const user = messages[1]
    if (user.type !== "user") throw new Error("expected user")
    expect(user.text).toBe("hello")
    expect(user.time.created).toBe(now)
  })

  it("falls back to Date.now() for unrecognized timestamp shapes (pinned legacy behavior)", () => {
    const messages: SessionMessage[] = []
    const before = Date.now()
    reduceMessageEvent(
      messages,
      ev("evt_1", "session.next.prompted", {
        sessionID: "ses_1",
        timestamp: { weird: true },
        prompt: { text: "x", files: [], agents: [] },
        agent: "build",
        model: { id: "m", providerID: "p", variant: "default" },
      }),
    )
    const user = messages[0]
    if (user.type !== "user") throw new Error("expected user")
    expect(user.time.created).toBeGreaterThanOrEqual(before)
  })

  it("coerces ISO string timestamps from legacy event replays", () => {
    const messages: SessionMessage[] = []
    reduceMessageEvent(
      messages,
      ev("evt_1", "session.next.prompted", {
        sessionID: "ses_1",
        timestamp: "2026-09-12T00:00:00.000Z",
        prompt: { text: "x", files: [], agents: [] },
        agent: "build",
        model: { id: "m", providerID: "p", variant: "default" },
      }),
    )
    const user = messages[0]
    if (user.type !== "user") throw new Error("expected user")
    expect(user.time.created).toBe(Date.parse("2026-09-12T00:00:00.000Z"))
  })

  it("step.started closes the current assistant before opening the next", () => {
    const messages: SessionMessage[] = []
    reduceMessageEvent(messages, ev("evt_1", "session.next.step.started", {
      sessionID: "ses_1",
      timestamp: now,
      agent: "build",
      model: { id: "m", providerID: "p", variant: "default" },
    }))
    reduceMessageEvent(messages, ev("evt_2", "session.next.step.started", {
      sessionID: "ses_1",
      timestamp: now + 10,
      agent: "build",
      model: { id: "m", providerID: "p", variant: "default" },
    }))
    expect(messages).toHaveLength(2)
    expect(messages[1].type).toBe("assistant")
    const closed = messages[1]
    if (closed.type !== "assistant") throw new Error("expected assistant")
    expect(closed.time.completed).toBe(now + 10)
    const open = messages[0]
    if (open.type !== "assistant") throw new Error("expected assistant")
    expect(open.time.completed).toBeUndefined()
  })

  it("tool lifecycle: pending input accumulation, running transition, success", () => {
    const messages: SessionMessage[] = []
    reduceMessageEvent(messages, ev("evt_1", "session.next.step.started", {
      sessionID: "ses_1",
      timestamp: now,
      agent: "build",
      model: { id: "m", providerID: "p", variant: "default" },
    }))
    reduceMessageEvent(messages, ev("evt_2", "session.next.tool.input.started", {
      sessionID: "ses_1",
      timestamp: now + 1,
      callID: "call_1",
      name: "bash",
    }))
    reduceMessageEvent(messages, ev("evt_3", "session.next.tool.input.delta", {
      sessionID: "ses_1",
      timestamp: now + 2,
      callID: "call_1",
      delta: '{"cmd',
    }))
    reduceMessageEvent(messages, ev("evt_4", "session.next.tool.called", {
      sessionID: "ses_1",
      timestamp: now + 3,
      callID: "call_1",
      input: { command: "ls" },
      provider: "test",
    }))
    reduceMessageEvent(messages, ev("evt_5", "session.next.tool.progress", {
      sessionID: "ses_1",
      timestamp: now + 4,
      callID: "call_1",
      structured: { step: 1 },
      content: [{ type: "text", text: "partial" }],
    }))
    reduceMessageEvent(messages, ev("evt_6", "session.next.tool.success", {
      sessionID: "ses_1",
      timestamp: now + 5,
      callID: "call_1",
      structured: { exit: 0 },
      content: [{ type: "text", text: "done" }],
      provider: "test",
    }))

    const assistant = messages[0]
    if (assistant.type !== "assistant") throw new Error("expected assistant")
    const tool = assistant.content.findLast((c) => c.type === "tool")
    if (tool?.type !== "tool" || tool.state.status !== "completed") throw new Error("expected completed state")
    expect(tool.state.input).toStrictEqual({ command: "ls" })
    expect(tool.state.structured).toStrictEqual({ exit: 0 })
    expect(tool.time.ran).toBe(now + 3)
    expect(tool.time.completed).toBe(now + 5)
  })

  it("tool.failed preserves accumulated input, structured, and content", () => {
    const messages: SessionMessage[] = []
    reduceMessageEvent(messages, ev("evt_1", "session.next.step.started", {
      sessionID: "ses_1",
      timestamp: now,
      agent: "build",
      model: { id: "m", providerID: "p", variant: "default" },
    }))
    reduceMessageEvent(messages, ev("evt_2", "session.next.tool.input.started", {
      sessionID: "ses_1",
      timestamp: now + 1,
      callID: "call_1",
      name: "bash",
    }))
    reduceMessageEvent(messages, ev("evt_3", "session.next.tool.called", {
      sessionID: "ses_1",
      timestamp: now + 2,
      callID: "call_1",
      input: { command: "boom" },
      provider: "test",
    }))
    reduceMessageEvent(messages, ev("evt_4", "session.next.tool.progress", {
      sessionID: "ses_1",
      timestamp: now + 3,
      callID: "call_1",
      structured: { n: 1 },
      content: [{ type: "text", text: "half" }],
    }))
    reduceMessageEvent(messages, ev("evt_5", "session.next.tool.failed", {
      sessionID: "ses_1",
      timestamp: now + 4,
      callID: "call_1",
      error: { type: "unknown", message: "exploded" },
      provider: "test",
    }))

    const assistant = messages[0]
    if (assistant.type !== "assistant") throw new Error("expected assistant")
    const tool = assistant.content.findLast((c) => c.type === "tool")
    if (tool?.type !== "tool" || tool.state.status !== "error") throw new Error("expected error state")
    expect(tool.state.error).toEqual({ type: "unknown", message: "exploded" })
    expect(tool.state.input).toStrictEqual({ command: "boom" })
    expect(tool.state.structured).toStrictEqual({ n: 1 })
    expect(tool.state.content).toEqual([{ type: "text", text: "half" }])
  })

  it("keeps task metadata when progress arrives before tool.called", () => {
    const messages: SessionMessage[] = []
    reduceMessageEvent(messages, ev("evt_1", "session.next.step.started", {
      sessionID: "ses_1",
      timestamp: now,
      agent: "build",
      model: { id: "m", providerID: "p", variant: "default" },
    }))
    reduceMessageEvent(messages, ev("evt_2", "session.next.tool.input.started", {
      sessionID: "ses_1",
      timestamp: now + 1,
      callID: "call_task",
      name: "task",
    }))
    reduceMessageEvent(messages, ev("evt_3", "session.next.tool.progress", {
      sessionID: "ses_1",
      timestamp: now + 2,
      callID: "call_task",
      structured: { sessionId: "ses_child" },
      content: [],
    }))
    reduceMessageEvent(messages, ev("evt_4", "session.next.tool.called", {
      sessionID: "ses_1",
      timestamp: now + 3,
      callID: "call_task",
      input: { description: "inspect" },
      provider: "test",
    }))

    const tool = toolPart(messages, "call_task")
    if (tool.state.status !== "running") throw new Error("expected running state")
    expect(tool.state.input).toStrictEqual({ description: "inspect" })
    expect(tool.state.structured).toStrictEqual({ sessionId: "ses_child" })
  })

  it("guards: out-of-order and duplicate events are no-ops", () => {
    const messages: SessionMessage[] = []

    // no active assistant: everything is ignored
    reduceMessageEvent(messages, ev("evt_1", "session.next.text.delta", {
      sessionID: "ses_1",
      timestamp: now,
      delta: "orphan",
    }))
    reduceMessageEvent(messages, ev("evt_2", "session.next.tool.input.started", {
      sessionID: "ses_1",
      timestamp: now,
      callID: "call_1",
      name: "bash",
    }))
    reduceMessageEvent(messages, ev("evt_3", "session.next.step.ended", {
      sessionID: "ses_1",
      timestamp: now,
      finish: "stop",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }))
    expect(messages).toEqual([])

    // build one live assistant + pending tool
    reduceMessageEvent(messages, ev("evt_4", "session.next.step.started", {
      sessionID: "ses_1",
      timestamp: now + 1,
      agent: "build",
      model: { id: "m", providerID: "p", variant: "default" },
    }))
    reduceMessageEvent(messages, ev("evt_5", "session.next.tool.input.started", {
      sessionID: "ses_1",
      timestamp: now + 2,
      callID: "call_1",
      name: "bash",
    }))

    // input.delta after called (running) must not append to the input string
    reduceMessageEvent(messages, ev("evt_6", "session.next.tool.called", {
      sessionID: "ses_1",
      timestamp: now + 3,
      callID: "call_1",
      input: { command: "ls" },
      provider: "test",
    }))
    reduceMessageEvent(messages, ev("evt_7", "session.next.tool.input.delta", {
      sessionID: "ses_1",
      timestamp: now + 4,
      callID: "call_1",
      delta: "late",
    }))
    const running = toolPart(messages, "call_1")
    if (running.state.status !== "running") throw new Error("expected running state")
    expect(running.state.input).toStrictEqual({ command: "ls" })

    // progress/success after completion (no longer running) must not overwrite
    reduceMessageEvent(messages, ev("evt_8", "session.next.tool.success", {
      sessionID: "ses_1",
      timestamp: now + 5,
      callID: "call_1",
      structured: { exit: 0 },
      content: [],
      provider: "test",
    }))
    reduceMessageEvent(messages, ev("evt_9", "session.next.tool.progress", {
      sessionID: "ses_1",
      timestamp: now + 6,
      callID: "call_1",
      structured: { late: true },
      content: [],
    }))
    const completed = toolPart(messages, "call_1")
    if (completed.state.status !== "completed") throw new Error("expected completed state")
    expect(completed.state.structured).toStrictEqual({ exit: 0 })

    // shell.ended for an unknown callID is a no-op
    reduceMessageEvent(messages, ev("evt_10", "session.next.shell.ended", {
      sessionID: "ses_1",
      timestamp: now + 7,
      callID: "nope",
      output: "x",
    }))
    expect(messages.filter((m) => m.type === "shell")).toEqual([])
  })

  it("accumulates compaction summary and finalizes on ended", () => {
    const messages: SessionMessage[] = []
    reduceMessageEvent(messages, ev("evt_1", "session.next.compaction.started", {
      sessionID: "ses_1",
      timestamp: now,
      reason: "overflow",
    }))
    reduceMessageEvent(messages, ev("evt_2", "session.next.compaction.delta", {
      sessionID: "ses_1",
      timestamp: now + 1,
      text: "par",
    }))
    reduceMessageEvent(messages, ev("evt_3", "session.next.compaction.delta", {
      sessionID: "ses_1",
      timestamp: now + 2,
      text: "tial",
    }))
    reduceMessageEvent(messages, ev("evt_4", "session.next.compaction.ended", {
      sessionID: "ses_1",
      timestamp: now + 3,
      text: "full summary",
      include: "msg_123",
    }))
    expect(messages).toHaveLength(1)
    const compaction = messages[0]
    if (compaction.type !== "compaction") throw new Error("expected compaction")
    expect(compaction.summary).toBe("full summary")
    expect(compaction.include).toBe("msg_123")
  })

  it("routes reasoning by reasoningID and finalizes text on ended", () => {
    const messages: SessionMessage[] = []
    reduceMessageEvent(messages, ev("evt_1", "session.next.step.started", {
      sessionID: "ses_1",
      timestamp: now,
      agent: "build",
      model: { id: "m", providerID: "p", variant: "default" },
    }))
    reduceMessageEvent(messages, ev("evt_2", "session.next.reasoning.started", {
      sessionID: "ses_1",
      timestamp: now + 1,
      reasoningID: "r1",
    }))
    reduceMessageEvent(messages, ev("evt_3", "session.next.reasoning.delta", {
      sessionID: "ses_1",
      timestamp: now + 2,
      reasoningID: "r1",
      delta: "thin",
    }))
    reduceMessageEvent(messages, ev("evt_4", "session.next.reasoning.ended", {
      sessionID: "ses_1",
      timestamp: now + 3,
      reasoningID: "r1",
      text: "thinking",
    }))
    const assistant = messages[0]
    if (assistant.type !== "assistant") throw new Error("expected assistant")
    expect(assistant.content).toEqual([{ type: "reasoning", id: "r1", text: "thinking" }])
  })

  it("shell records accumulate output by callID", () => {
    const messages: SessionMessage[] = []
    reduceMessageEvent(messages, ev("evt_1", "session.next.shell.started", {
      sessionID: "ses_1",
      timestamp: now,
      callID: "call_1",
      command: "ls",
    }))
    reduceMessageEvent(messages, ev("evt_2", "session.next.shell.ended", {
      sessionID: "ses_1",
      timestamp: now + 1,
      callID: "call_1",
      output: "files",
    }))
    expect(messages).toHaveLength(1)
    const shell = messages[0]
    if (shell.type !== "shell") throw new Error("expected shell")
    expect(shell.output).toBe("files")
    expect(shell.time.completed).toBe(now + 1)
  })

  // Server-side revert cleanup deletes rows (V1 `msg_*` ids) before clearing
  // the marker, but the live store never consumes `message.removed` — its
  // `evt_*` rows can't match. The reducer must ignore removals and rely on
  // sync.tsx's boundary drop at revert-clear, so stale rows survive intact
  // here and the later `session.next.prompted` (newest unshift) plus the
  // store drop produce exactly one replacement.
  it("ignores message.removed and keeps stale rows for the revert-clear drop", () => {
    const messages: SessionMessage[] = []
    const prompted = (id: string, text: string, offset: number) =>
      ev(id, "session.next.prompted", {
        sessionID: "ses_1",
        timestamp: now + offset,
        prompt: { text, files: [], agents: [] },
        agent: "build",
        model: { id: "m", providerID: "p", variant: "default" },
      })
    reduceMessageEvent(messages, prompted("evt_1", "first", 0))
    reduceMessageEvent(messages, ev("evt_2", "session.next.step.started", {
      sessionID: "ses_1",
      timestamp: now + 1,
      agent: "build",
      model: { id: "m", providerID: "p", variant: "default" },
    }))
    reduceMessageEvent(messages, prompted("evt_3", "second", 2))
    reduceMessageEvent(messages, ev("evt_4", "session.next.step.started", {
      sessionID: "ses_1",
      timestamp: now + 3,
      agent: "build",
      model: { id: "m", providerID: "p", variant: "default" },
    }))
    // undo targets evt_3; cleanup emits canonical removals the store can't match
    reduceMessageEvent(messages, ev("evt_x", "message.removed", { sessionID: "ses_1", messageID: "msg_srv" }) as never)
    reduceMessageEvent(
      messages,
      ev("evt_y", "message.part.removed", {
        sessionID: "ses_1",
        messageID: "msg_srv",
        partID: "prt_srv",
      }) as never,
    )
    expect(messages.map((m) => m.id)).toEqual(["evt_4", "evt_3", "evt_2", "evt_1"])

    // sync.tsx drops id >= "evt_3" at revert-clear; replacement prompts after
    const dropped = dropRevertedRange(messages, "evt_3")
    expect(dropped.map((m) => m.id)).toEqual(["evt_2", "evt_1"])
    reduceMessageEvent(dropped, prompted("evt_5", "second edited", 4))
    const users = dropped.filter((m) => m.type === "user")
    expect(users.map((m) => m.id)).toEqual(["evt_5", "evt_1"])
    if (users[0]?.type !== "user") throw new Error("expected user")
    expect(users[0].text).toBe("second edited")
  })
})
