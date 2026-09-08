import { describe, expect, test } from "bun:test"
import type { Message, Part, PermissionRequest, Project, QuestionRequest, Session, SnapshotFileDiff, Todo } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import { applyDirectoryEvent, applyGlobalEvent, cleanupDroppedSessionCaches } from "./event-reducer"

const rootSession = (input: { id: string; parentID?: string; archived?: number }) =>
  ({
    id: input.id,
    parentID: input.parentID,
    time: {
      created: 1,
      updated: 1,
      archived: input.archived,
    },
  }) as Session

const userMessage = (id: string, sessionID: string) =>
  ({
    id,
    sessionID,
    role: "user",
    time: { created: 1 },
    agent: "assistant",
    model: { providerID: "openai", modelID: "gpt" },
  }) as Message

const textPart = (id: string, sessionID: string, messageID: string) =>
  ({
    id,
    sessionID,
    messageID,
    type: "text",
    text: id,
  }) as Part

const permissionRequest = (id: string, sessionID: string, title = id) =>
  ({
    id,
    sessionID,
    permission: title,
    patterns: ["*"],
    metadata: {},
    always: [],
  }) as PermissionRequest

const questionRequest = (id: string, sessionID: string, title = id) =>
  ({
    id,
    sessionID,
    questions: [
      {
        question: title,
        header: title,
        options: [{ label: title, description: title }],
      },
    ],
  }) as QuestionRequest

const baseState = (input: Partial<State> = {}) =>
  ({
    status: "complete",
    agent: [],
    command: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider: {} as State["provider"],
    config: {} as State["config"],
    path: { directory: "/tmp" } as State["path"],
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp: {},
    lsp: [],
    vcs: undefined,
    limit: 10,
    message: {},
    part: {},
    ...input,
  }) as State

const promptedEvent = (id: string, sessionID: string, text: string) => ({
  id,
  type: "session.next.prompted",
  properties: {
    sessionID,
    timestamp: 1,
    prompt: { text },
    agent: "assistant",
    model: { id: "gpt", providerID: "openai" },
  },
})

describe("applyGlobalEvent", () => {
  test("upserts project.updated in sorted position", () => {
    const project = [{ id: "a" }, { id: "c" }] as Project[]
    let refreshCount = 0
    applyGlobalEvent({
      event: { type: "project.updated", properties: { id: "b" } },
      project,
      refresh: () => {
        refreshCount += 1
      },
      setGlobalProject(next) {
        if (typeof next === "function") next(project)
      },
    })

    expect(project.map((x) => x.id)).toEqual(["a", "b", "c"])
    expect(refreshCount).toBe(0)
  })

  test("handles global.disposed by triggering refresh", () => {
    let refreshCount = 0
    applyGlobalEvent({
      event: { type: "global.disposed" },
      project: [],
      refresh: () => {
        refreshCount += 1
      },
      setGlobalProject() {},
    })

    expect(refreshCount).toBe(1)
  })

  test("handles server.connected by triggering refresh", () => {
    let refreshCount = 0
    applyGlobalEvent({
      event: { type: "server.connected" },
      project: [],
      refresh: () => {
        refreshCount += 1
      },
      setGlobalProject() {},
    })

    expect(refreshCount).toBe(1)
  })

  test("upserts existing project on project.updated", () => {
    const project = [{ id: "a", name: "old" }] as Project[]
    const setCalls: unknown[] = []
    applyGlobalEvent({
      event: { type: "project.updated", properties: { id: "a", name: "new" } },
      project,
      refresh() {},
      setGlobalProject(next) {
        setCalls.push(typeof next === "function" ? next(project) : next)
      },
    })

    expect(project[0].name).toBe("new")
    expect(setCalls).toHaveLength(1)
  })

  test("inserts missing project on project.updated", () => {
    const project = [{ id: "a" }] as Project[]
    const setCalls: unknown[] = []
    applyGlobalEvent({
      event: { type: "project.updated", properties: { id: "b" } },
      project,
      refresh() {},
      setGlobalProject(next) {
        setCalls.push(typeof next === "function" ? next(project) : next)
      },
    })

    expect(project.map((x) => x.id)).toEqual(["a", "b"])
    expect(setCalls).toHaveLength(1)
  })
})

describe("applyDirectoryEvent", () => {
  test("inserts root sessions in sorted order and updates sessionTotal", () => {
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "b" })],
        sessionTotal: 1,
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: rootSession({ id: "a" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["a", "b"])
    expect(store.sessionTotal).toBe(2)

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: rootSession({ id: "c", parentID: "a" }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.sessionTotal).toBe(2)
  })

  test("cleans session caches when archived", () => {
    const message = userMessage("msg_1", "ses_1")
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_1" }), rootSession({ id: "ses_2" })],
        sessionTotal: 2,
        message: { ses_1: [message] },
        part: { [message.id]: [textPart("prt_1", "ses_1", message.id)] },
        session_diff: { ses_1: [] },
        todo: { ses_1: [] },
        permission: { ses_1: [] },
        question: { ses_1: [] },
        session_status: { ses_1: { type: "busy" } },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.next.updated", properties: { info: rootSession({ id: "ses_1", archived: 10 }) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session.map((x) => x.id)).toEqual(["ses_2"])
    expect(store.sessionTotal).toBe(1)
    expect(store.message.ses_1).toBeUndefined()
    expect(store.part[message.id]).toBeUndefined()
    expect(store.session_diff.ses_1).toBeUndefined()
    expect(store.todo.ses_1).toBeUndefined()
    expect(store.permission.ses_1).toBeUndefined()
    expect(store.question.ses_1).toBeUndefined()
    expect(store.session_status.ses_1).toBeUndefined()
  })

  test("cleans session caches when deleted and decrements only root totals", () => {
    const cases = [
      { info: rootSession({ id: "ses_1" }), expectedTotal: 1 },
      { info: rootSession({ id: "ses_2", parentID: "ses_1" }), expectedTotal: 2 },
    ]

    for (const item of cases) {
      const message = userMessage("msg_1", item.info.id)
      const [store, setStore] = createStore(
        baseState({
          session: [
            rootSession({ id: "ses_1" }),
            rootSession({ id: "ses_2", parentID: "ses_1" }),
            rootSession({ id: "ses_3" }),
          ],
          sessionTotal: 2,
          message: { [item.info.id]: [message] },
          part: { [message.id]: [textPart("prt_1", item.info.id, message.id)] },
          session_diff: { [item.info.id]: [] },
          todo: { [item.info.id]: [] },
          permission: { [item.info.id]: [] },
          question: { [item.info.id]: [] },
          session_status: { [item.info.id]: { type: "busy" } },
        }),
      )

      applyDirectoryEvent({
        event: { type: "session.next.deleted", properties: { info: item.info } },
        store,
        setStore,
        push() {},
        directory: "/tmp",
        loadLsp() {},
      })

      expect(store.session.find((x) => x.id === item.info.id)).toBeUndefined()
      expect(store.sessionTotal).toBe(item.expectedTotal)
      expect(store.message[item.info.id]).toBeUndefined()
      expect(store.part[message.id]).toBeUndefined()
      expect(store.session_diff[item.info.id]).toBeUndefined()
      expect(store.todo[item.info.id]).toBeUndefined()
      expect(store.permission[item.info.id]).toBeUndefined()
      expect(store.question[item.info.id]).toBeUndefined()
      expect(store.session_status[item.info.id]).toBeUndefined()
    }
  })

  test("cleans caches for trimmed sessions on session.created", () => {
    const dropped = rootSession({ id: "ses_b" })
    const kept = rootSession({ id: "ses_a" })
    const message = userMessage("msg_1", dropped.id)
    const todos: string[] = []
    const [store, setStore] = createStore(
      baseState({
        limit: 1,
        session: [dropped],
        message: { [dropped.id]: [message] },
        part: { [message.id]: [textPart("prt_1", dropped.id, message.id)] },
        session_diff: { [dropped.id]: [] },
        todo: { [dropped.id]: [] },
        permission: { [dropped.id]: [] },
        question: { [dropped.id]: [] },
        session_status: { [dropped.id]: { type: "busy" } },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: kept } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      setSessionTodo(sessionID, value) {
        if (value !== undefined) return
        todos.push(sessionID)
      },
    })

    expect(store.session.map((x) => x.id)).toEqual([kept.id])
    expect(store.message[dropped.id]).toBeUndefined()
    expect(store.part[message.id]).toBeUndefined()
    expect(store.session_diff[dropped.id]).toBeUndefined()
    expect(store.todo[dropped.id]).toBeUndefined()
    expect(store.permission[dropped.id]).toBeUndefined()
    expect(store.question[dropped.id]).toBeUndefined()
    expect(store.session_status[dropped.id]).toBeUndefined()
    expect(todos).toEqual([dropped.id])
  })

  test("cleanupDroppedSessionCaches clears part-only orphan state", () => {
    const [store, setStore] = createStore(
      baseState({
        session: [rootSession({ id: "ses_keep" })],
        part: { msg_1: [textPart("prt_1", "ses_drop", "msg_1")] },
      }),
    )

    cleanupDroppedSessionCaches(store, setStore, store.session)

    expect(store.part.msg_1).toBeUndefined()
  })

  test("prompted inserts user message with text and file parts and resolves optimistic entries", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(baseState())
    const resolved: string[] = []

    applyDirectoryEvent({
      event: promptedEvent("evt_2", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      resolveOptimistic(sessionID_, text) {
        resolved.push(`${sessionID_}:${text}`)
      },
    })

    expect(store.message[sessionID]?.map((x) => x.id)).toEqual(["evt_2"])
    expect(resolved).toEqual([`${sessionID}:hello`])
    const parts = store.part["evt_2"] ?? []
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ type: "text", text: "hello" })

    // Re-delivering the same event id upserts instead of duplicating.
    applyDirectoryEvent({
      event: promptedEvent("evt_2", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.message[sessionID]?.map((x) => x.id)).toEqual(["evt_2"])
  })

  test("prompted inserts in sorted position between existing messages", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(
      baseState({
        message: { [sessionID]: [userMessage("evt_1", sessionID), userMessage("evt_3", sessionID)] },
      }),
    )

    applyDirectoryEvent({
      event: promptedEvent("evt_2", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.message[sessionID]?.map((x) => x.id)).toEqual(["evt_1", "evt_2", "evt_3"])
  })

  test("synthetic comment notes attach to the latest user message and others are skipped", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: promptedEvent("evt_1", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: {
        id: "evt_2",
        type: "session.next.synthetic",
        properties: {
          sessionID,
          timestamp: 2,
          text: "The user made the following comment regarding line 3 of src/a.ts: fix this",
        },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { id: "evt_3", type: "session.next.synthetic", properties: { sessionID, timestamp: 3, text: "subagent result" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.message[sessionID]).toHaveLength(1)
    const parts = store.part["evt_1"] ?? []
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ type: "text", text: "hello" })
    expect(parts[1]).toMatchObject({ type: "text", synthetic: true })
  })

  test("shell events build the user wrapper, assistant and bash tool lifecycle", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: promptedEvent("evt_1", sessionID, "run it"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: {
        id: "evt_2",
        type: "session.next.shell.started",
        properties: { sessionID, timestamp: 2, callID: "call_9", command: "ls" },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.message[sessionID]?.map((x) => x.id)).toEqual(["evt_1", "evt_2", "evt_2:assistant"])
    expect(store.part["evt_2"]?.[0]).toMatchObject({ type: "text", text: "The following tool was executed by the user", synthetic: true })
    const tool = store.part["evt_2:assistant"]?.[0]
    expect(tool).toMatchObject({
      type: "tool",
      tool: "bash",
      callID: "call_9",
      state: { status: "running", input: { command: "ls" } },
    })

    applyDirectoryEvent({
      event: {
        id: "evt_3",
        type: "session.next.shell.ended",
        properties: { sessionID, timestamp: 3, callID: "call_9", output: "out" },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    const completed = store.part["evt_2:assistant"]?.[0]
    expect(completed).toMatchObject({
      state: { status: "completed", output: "out", metadata: { output: "out", description: "" } },
    })
    const assistant = store.message[sessionID]?.find((x) => x.id === "evt_2:assistant")
    expect(assistant?.role === "assistant" && assistant.time.completed).toBe(3)
  })

  test("step events drive the assistant lifecycle", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: promptedEvent("evt_1", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: {
        id: "evt_2",
        type: "session.next.step.started",
        properties: { sessionID, timestamp: 2, agent: "assistant", model: { id: "gpt", providerID: "openai" } },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    const assistant = store.message[sessionID]?.find((x) => x.id === "evt_2")
    expect(assistant).toMatchObject({ role: "assistant", parentID: "evt_1", agent: "assistant", mode: "assistant" })

    applyDirectoryEvent({
      event: {
        id: "evt_3",
        type: "session.next.step.ended",
        properties: {
          sessionID,
          timestamp: 3,
          finish: "stop",
          cost: 0.5,
          tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    const ended = store.message[sessionID]?.find((x) => x.id === "evt_2")
    expect(ended).toMatchObject({
      time: { created: 2, completed: 3 },
      finish: "stop",
      cost: 0.5,
      tokens: { input: 1, output: 2 },
    })
  })

  test("step failed records the error on the active assistant", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: promptedEvent("evt_1", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: {
        id: "evt_2",
        type: "session.next.step.started",
        properties: { sessionID, timestamp: 2, agent: "assistant", model: { id: "gpt", providerID: "openai" } },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: {
        id: "evt_3",
        type: "session.next.step.failed",
        properties: { sessionID, timestamp: 3, error: { type: "unknown", message: "boom" } },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    const failed = store.message[sessionID]?.find((x) => x.id === "evt_2")
    expect(failed).toMatchObject({
      time: { completed: 3 },
      finish: "error",
      error: { name: "UnknownError", data: { message: "boom" } },
    })
  })

  test("text events stream into the active assistant's text part", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: promptedEvent("evt_1", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { id: "evt_2", type: "session.next.step.started", properties: { sessionID, timestamp: 2, agent: "assistant", model: { id: "gpt", providerID: "openai" } } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.text.started", properties: { sessionID, timestamp: 2 } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.text.delta", properties: { sessionID, delta: "hi" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.text.delta", properties: { sessionID, delta: " there" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.text.ended", properties: { sessionID, text: "hi there" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    const parts = store.part["evt_2"] ?? []
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ type: "text", text: "hi there" })
  })

  test("tool events drive the tool part state machine", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: promptedEvent("evt_1", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { id: "evt_2", type: "session.next.step.started", properties: { sessionID, timestamp: 2, agent: "assistant", model: { id: "gpt", providerID: "openai" } } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.tool.input.started", properties: { sessionID, timestamp: 2, callID: "call_1", name: "bash" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.tool.input.delta", properties: { sessionID, callID: "call_1", delta: '{"command"' } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    let tool = store.part["evt_2"]?.[0]
    expect(tool).toMatchObject({ type: "tool", tool: "bash", callID: "call_1", state: { status: "pending", raw: '{"command"' } })

    applyDirectoryEvent({
      event: { type: "session.next.tool.called", properties: { sessionID, timestamp: 3, callID: "call_1", input: { command: "ls" } } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.tool.progress", properties: { sessionID, callID: "call_1", structured: { partial: true }, content: [] } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    tool = store.part["evt_2"]?.[0]
    expect(tool).toMatchObject({
      state: { status: "running", input: { command: "ls" }, metadata: { partial: true } },
    })

    applyDirectoryEvent({
      event: {
        type: "session.next.tool.success",
        properties: { sessionID, timestamp: 4, callID: "call_1", structured: { done: true }, content: [{ type: "text", text: "out" }] },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    tool = store.part["evt_2"]?.[0]
    expect(tool).toMatchObject({
      state: { status: "completed", output: "out", metadata: { done: true }, time: { start: 3, end: 4 } },
    })
  })

  test("tool failure records the error state", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: promptedEvent("evt_1", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { id: "evt_2", type: "session.next.step.started", properties: { sessionID, timestamp: 2, agent: "assistant", model: { id: "gpt", providerID: "openai" } } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.tool.input.started", properties: { sessionID, timestamp: 2, callID: "call_1", name: "bash" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.tool.called", properties: { sessionID, timestamp: 3, callID: "call_1", input: { command: "ls" } } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: {
        type: "session.next.tool.failed",
        properties: { sessionID, timestamp: 4, callID: "call_1", error: { type: "unknown", message: "nope" } },
      },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.part["evt_2"]?.[0]).toMatchObject({
      state: { status: "error", error: "nope", time: { start: 3, end: 4 } },
    })
  })

  test("reasoning events stream into the active assistant's reasoning part", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: promptedEvent("evt_1", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { id: "evt_2", type: "session.next.step.started", properties: { sessionID, timestamp: 2, agent: "assistant", model: { id: "gpt", providerID: "openai" } } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.reasoning.started", properties: { sessionID, reasoningID: "rsn_1" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.reasoning.delta", properties: { sessionID, reasoningID: "rsn_1", delta: "think" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { type: "session.next.reasoning.ended", properties: { sessionID, reasoningID: "rsn_1", text: "thinking" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.part["evt_2"]?.[0]).toMatchObject({ type: "reasoning", text: "thinking" })
  })

  test("compaction started builds a user wrapper with a compaction part", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: promptedEvent("evt_1", sessionID, "hello"),
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    applyDirectoryEvent({
      event: { id: "evt_2", type: "session.next.compaction.started", properties: { sessionID, timestamp: 2, reason: "auto" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.message[sessionID]?.map((x) => x.id)).toEqual(["evt_1", "evt_2"])
    expect(store.part["evt_2"]?.[0]).toMatchObject({ type: "compaction", auto: true })
  })

  test("tracks permission and question request lifecycles", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(
      baseState({
        permission: { [sessionID]: [permissionRequest("perm_1", sessionID), permissionRequest("perm_3", sessionID)] },
        question: { [sessionID]: [questionRequest("q_1", sessionID), questionRequest("q_3", sessionID)] },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.next.permission.asked", properties: { timestamp: 1, sessionID, request: permissionRequest("perm_2", sessionID) } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.permission[sessionID]?.map((x) => x.id)).toEqual(["perm_1", "perm_2", "perm_3"])

    applyDirectoryEvent({
      event: { type: "session.next.permission.asked", properties: { timestamp: 1, sessionID, request: permissionRequest("perm_2", sessionID, "updated") } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.permission[sessionID]?.find((x) => x.id === "perm_2")?.permission).toBe("updated")

    applyDirectoryEvent({
      event: { type: "session.next.permission.replied", properties: { timestamp: 1, sessionID, requestID: "perm_2", reply: "once" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.permission[sessionID]?.map((x) => x.id)).toEqual(["perm_1", "perm_3"])

    applyDirectoryEvent({
      event: { type: "question.asked", properties: questionRequest("q_2", sessionID) },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.question[sessionID]?.map((x) => x.id)).toEqual(["q_1", "q_2", "q_3"])

    applyDirectoryEvent({
      event: { type: "question.asked", properties: questionRequest("q_2", sessionID, "updated") },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.question[sessionID]?.find((x) => x.id === "q_2")?.questions[0]?.header).toBe("updated")

    applyDirectoryEvent({
      event: { type: "question.rejected", properties: { sessionID, requestID: "q_2" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })
    expect(store.question[sessionID]?.map((x) => x.id)).toEqual(["q_1", "q_3"])
  })

  test("updates vcs branch in store and cache", () => {
    const [store, setStore] = createStore(baseState({ vcs: { branch: "main", default_branch: "main" } }))
    const [cacheStore, setCacheStore] = createStore({
      value: { branch: "main", default_branch: "main" } as State["vcs"],
    })

    applyDirectoryEvent({
      event: { type: "vcs.branch.updated", properties: { branch: "feature/test" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      vcsCache: {
        store: cacheStore,
        setStore: setCacheStore,
        ready: () => true,
      },
    })

    expect(store.vcs).toEqual({ branch: "feature/test", default_branch: "main" })
    expect(cacheStore.value).toEqual({ branch: "feature/test", default_branch: "main" })
  })

  test("reconciles session.diff by file key", () => {
    const sessionID = "ses_1"
    const diffA = { file: "a.ts", status: "modified" as const, additions: 1, deletions: 0, patch: "p" } as SnapshotFileDiff
    const diffB = { file: "b.ts", status: "added" as const, additions: 0, deletions: 1, patch: "p" } as SnapshotFileDiff
    const [store, setStore] = createStore(
      baseState({
        session_diff: { [sessionID]: [diffA] },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.next.diff", properties: { sessionID, diff: [diffB] } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session_diff[sessionID]?.map((x) => x.file)).toEqual(["b.ts"])
  })

  test("replaces todo list and calls setSessionTodo on todo.updated", () => {
    const sessionID = "ses_1"
    const todos: (string | undefined)[] = []
    const [store, setStore] = createStore(
      baseState({
        todo: { [sessionID]: [{ content: "old", status: "pending", priority: "medium" } as Todo] },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.next.todo", properties: { sessionID, todos: [{ content: "new", status: "pending", priority: "medium" } as Todo] } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
      setSessionTodo(sessionID_, next) {
        todos.push(sessionID_)
        todos.push(next?.[0]?.content)
      },
    })

    expect(store.todo[sessionID]?.map((x) => x.content)).toEqual(["new"])
    expect(todos).toEqual([sessionID, "new"])
  })

  test("reconciles session.status", () => {
    const sessionID = "ses_1"
    const [store, setStore] = createStore(
      baseState({
        session_status: { [sessionID]: { type: "idle" } },
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.next.status", properties: { sessionID, status: { type: "busy" } } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session_status[sessionID]).toEqual({ type: "busy" })
  })

  test("ignores text deltas when no assistant is active", () => {
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: { type: "session.next.text.delta", properties: { sessionID: "ses_1", delta: "x" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.part).toEqual({})
  })

  test("reconciles existing session on session.created without incrementing total", () => {
    const existing = rootSession({ id: "ses_1" })
    const updated = { ...existing, time: { ...existing.time, updated: 2 } } as Session
    const [store, setStore] = createStore(
      baseState({
        session: [existing],
        sessionTotal: 1,
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.created", properties: { info: updated } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session).toHaveLength(1)
    expect(store.session[0].time.updated).toBe(2)
    expect(store.sessionTotal).toBe(1)
  })

  test("reconciles existing session on session.next.updated without archiving", () => {
    const existing = rootSession({ id: "ses_1" })
    const updated = { ...existing, time: { ...existing.time, updated: 2 } } as Session
    const [store, setStore] = createStore(
      baseState({
        session: [existing],
      }),
    )

    applyDirectoryEvent({
      event: { type: "session.next.updated", properties: { info: updated } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.session).toHaveLength(1)
    expect(store.session[0].time.updated).toBe(2)
  })

  test("skips permission.replied when permission list is missing", () => {
    const [store, setStore] = createStore(baseState())

    applyDirectoryEvent({
      event: { type: "session.next.permission.replied", properties: { timestamp: 1, sessionID: "ses_1", requestID: "perm_1", reply: "once" } },
      store,
      setStore,
      push() {},
      directory: "/tmp",
      loadLsp() {},
    })

    expect(store.permission).toEqual({})
  })

  test("routes disposal and lsp events to side-effect handlers", () => {
    const [store, setStore] = createStore(baseState())
    const pushes: string[] = []
    let lspLoads = 0

    applyDirectoryEvent({
      event: { type: "server.instance.disposed" },
      store,
      setStore,
      push(directory) {
        pushes.push(directory)
      },
      directory: "/tmp",
      loadLsp() {
        lspLoads += 1
      },
    })

    applyDirectoryEvent({
      event: { type: "lsp.updated" },
      store,
      setStore,
      push(directory) {
        pushes.push(directory)
      },
      directory: "/tmp",
      loadLsp() {
        lspLoads += 1
      },
    })

    expect(pushes).toEqual(["/tmp"])
    expect(lspLoads).toBe(1)
  })
})
