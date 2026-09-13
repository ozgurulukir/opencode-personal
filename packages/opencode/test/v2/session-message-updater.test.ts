import { expect, test } from "bun:test"
import * as DateTime from "effect/DateTime"
import { SessionID } from "../../src/session/schema"
import { EventV2 } from "../../src/v2/event"
import { Modelv2 } from "../../src/v2/model"
import { SessionEvent } from "../../src/v2/session-event"
import { SessionMessageUpdater } from "../../src/v2/session-message-updater"
import { SessionMessage } from "../../src/v2/session-message"
import { SubtaskAttachment } from "../../src/v2/session-prompt"

test("normalizes JSON-encoded tool inputs for the V2 message contract", () => {
  expect(SessionMessage.normalizeToolInput(JSON.stringify({ content: "source" }))).toEqual({ content: "source" })
  expect(SessionMessage.normalizeToolInput(JSON.stringify(JSON.stringify({ content: "source" })))).toEqual({
    content: "source",
  })
  expect(SessionMessage.normalizeToolInput("not-json")).toEqual({})
})

test("step snapshots carry over to assistant messages", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
      model: {
        id: Modelv2.ID.make("model"),
        providerID: Modelv2.ProviderID.make("provider"),
        variant: Modelv2.VariantID.make("default"),
      },
      snapshot: "before",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.ended",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(2),
      finish: "stop",
      cost: 0,
      tokens: {
        input: 1,
        output: 2,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      },
      snapshot: "after",
    },
  } satisfies SessionEvent.Event)

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].snapshot).toEqual({ start: "before", end: "after" })
  expect(state.messages[0].finish).toBe("stop")
})

test("text ended populates assistant text content", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
      model: {
        id: Modelv2.ID.make("model"),
        providerID: Modelv2.ProviderID.make("provider"),
        variant: Modelv2.VariantID.make("default"),
      },
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.text.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(2),
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.text.ended",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(3),
      text: "hello assistant",
    },
  } satisfies SessionEvent.Event)

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].content).toEqual([{ type: "text", text: "hello assistant" }])
})

test("tool completion stores completed timestamp", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const callID = "call"

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
      model: {
        id: Modelv2.ID.make("model"),
        providerID: Modelv2.ProviderID.make("provider"),
        variant: Modelv2.VariantID.make("default"),
      },
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.tool.input.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(2),
      callID,
      name: "bash",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.tool.called",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(3),
      callID,
      tool: "bash",
      input: { command: "pwd" },
      provider: { executed: true, metadata: { source: "provider" } },
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.tool.success",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(4),
      callID,
      structured: {},
      content: [
        { type: "text", text: "/tmp" },
        { type: "file", uri: "file:///tmp/output.png", mime: "image/png", name: "output.png" },
      ],
      provider: { executed: true, metadata: { status: "done" } },
    },
  } satisfies SessionEvent.Event)

  expect(state.messages[0]?.type).toBe("assistant")
  if (state.messages[0]?.type !== "assistant") return
  expect(state.messages[0].content[0]?.type).toBe("tool")
  if (state.messages[0].content[0]?.type !== "tool") return
  expect(state.messages[0].content[0].time.completed).toEqual(DateTime.makeUnsafe(4))
  expect(state.messages[0].content[0].provider).toEqual({ executed: true, metadata: { status: "done" } })
  expect(state.messages[0].content[0].state).toMatchObject({
    attachments: [{ uri: "file:///tmp/output.png", mime: "image/png", name: "output.png" }],
  })
})

test("tool progress before called is retained for task navigation metadata", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const callID = "task-call"

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
      model: {
        id: Modelv2.ID.make("model"),
        providerID: Modelv2.ProviderID.make("provider"),
        variant: Modelv2.VariantID.make("default"),
      },
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.tool.input.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(2),
      callID,
      name: "task",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.tool.progress",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(3),
      callID,
      structured: { sessionId: "child" },
      content: [],
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.tool.called",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(4),
      callID,
      tool: "task",
      input: { description: "inspect" },
      provider: { executed: false },
    },
  } satisfies SessionEvent.Event)

  const assistant = state.messages[0]
  expect(assistant?.type).toBe("assistant")
  if (assistant?.type !== "assistant") return
  const tool = assistant.content[0]
  expect(tool?.type).toBe("tool")
  if (tool?.type !== "tool" || tool.state.status !== "running") return
  expect(tool.state.input).toEqual({ description: "inspect" })
  expect(tool.state.structured).toEqual({ sessionId: "child" })
})

test("step failure retains the explicit V2 abort error", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
      model: {
        id: Modelv2.ID.make("model"),
        providerID: Modelv2.ProviderID.make("provider"),
        variant: Modelv2.VariantID.make("default"),
      },
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.step.failed",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(2),
      error: { type: "aborted", message: "Aborted" },
    },
  } satisfies SessionEvent.Event)

  expect(state.messages[0]).toMatchObject({
    type: "assistant",
    finish: "error",
    error: { type: "aborted", message: "Aborted" },
  })
})

test("compaction events reduce to compaction message", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const id = EventV2.ID.create()

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id,
    type: "session.next.compaction.started",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      reason: "auto",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.compaction.delta",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(2),
      text: "hello ",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.compaction.delta",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(3),
      text: "summary",
    },
  } satisfies SessionEvent.Event)

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id: EventV2.ID.create(),
    type: "session.next.compaction.ended",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(4),
      text: "final summary",
      include: "recent context",
    },
  } satisfies SessionEvent.Event)

  expect(state.messages).toHaveLength(1)
  expect(state.messages[0]).toMatchObject({
    id,
    type: "compaction",
    reason: "auto",
    summary: "final summary",
    include: "recent context",
    time: { created: DateTime.makeUnsafe(1) },
  })
})

test("prompted event with subtask stores subtask on user message", () => {
  const state: SessionMessageUpdater.MemoryState = { messages: [] }
  const sessionID = SessionID.make("session")
  const id = EventV2.ID.create()

  SessionMessageUpdater.update(SessionMessageUpdater.memory(state), {
    id,
    type: "session.next.prompted",
    data: {
      sessionID,
      timestamp: DateTime.makeUnsafe(1),
      agent: "build",
      model: {
        id: Modelv2.ID.make("claude-sonnet-4"),
        providerID: Modelv2.ProviderID.make("anthropic"),
        variant: Modelv2.VariantID.make("default"),
      },
      prompt: {
        text: "explore the codebase",
        subtask: new SubtaskAttachment({
          agent: "explore",
          description: "find call sites",
          prompt: "explore the codebase",
          model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
          command: "/explore",
        }),
      },
    },
  } satisfies SessionEvent.Event)

  expect(state.messages).toHaveLength(1)
  expect(state.messages[0]).toMatchObject({
    id,
    type: "user",
    text: "explore the codebase",
    agent: "build",
    model: {
      id: "claude-sonnet-4",
      providerID: "anthropic",
      variant: "default",
    },
    subtask: {
      agent: "explore",
      description: "find call sites",
      prompt: "explore the codebase",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4" },
      command: "/explore",
    },
  })
})
