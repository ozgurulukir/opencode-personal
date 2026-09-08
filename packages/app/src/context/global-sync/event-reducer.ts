import { Binary } from "@opencode-ai/core/util/binary"
import { produce, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type {
  AssistantMessage,
  Message,
  Part,
  PermissionRequest,
  Project,
  PromptAgentAttachment,
  PromptFileAttachment,
  PromptSubtaskAttachment,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
  UserMessage,
} from "@opencode-ai/sdk/v2/client"
import type { State, VcsCache } from "./types"
import { legacyFilePart, toLegacyError } from "@opencode-ai/sdk/v2/legacy"
import { trimSessions } from "./session-trim"
import { dropSessionCaches } from "./session-cache"
import { diffs as list } from "@/utils/diffs"
import { decodeFilePath, stripFileProtocol, stripQueryAndHash } from "@/context/file/path"
import {
  SHELL_SYNTHETIC_TEXT,
  agentPart,
  assistantMessage,
  commentPart,
  compactionPart,
  filePart,
  reasoningPart,
  subtaskPart,
  textPart,
  toolPart,
  userMessage,
} from "./v2-adapter"

type MessageEvent = { id?: string; type: string; properties?: unknown }

// V2 event timestamps are declared as epoch millis on the wire and
// SyncEvent.process encodes DateTime instances to millis at publish.
// Kept as a cheap normalizer because legacy EventTable rows (experimental
// workspace replay) still carry ISO strings from before that fix.
function eventTime(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Date.parse(value)
  if (value && typeof value === "object" && "epochMilliseconds" in value)
    return (value as { epochMilliseconds: number }).epochMilliseconds
  return Date.now()
}

export function applyGlobalEvent(input: {
  event: { type: string; properties?: unknown }
  project: Project[]
  setGlobalProject: (next: Project[] | ((draft: Project[]) => Project[])) => void
  refresh: () => void
}) {
  if (input.event.type === "global.disposed" || input.event.type === "server.connected") {
    input.refresh()
    return
  }

  if (input.event.type !== "project.updated") return
  const properties = input.event.properties as Project
  const result = Binary.search(input.project, properties.id, (s) => s.id)
  if (result.found) {
    input.setGlobalProject(
      produce((draft) => {
        draft[result.index] = { ...draft[result.index], ...properties }
      }),
    )
    return
  }
  input.setGlobalProject(
    produce((draft) => {
      draft.splice(result.index, 0, properties)
    }),
  )
}

function cleanupSessionCaches(
  setStore: SetStoreFunction<State>,
  sessionID: string,
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void,
) {
  if (!sessionID) return
  setSessionTodo?.(sessionID, undefined)
  setStore(
    produce((draft) => {
      dropSessionCaches(draft, [sessionID])
    }),
  )
}

export function cleanupDroppedSessionCaches(
  store: Store<State>,
  setStore: SetStoreFunction<State>,
  next: Session[],
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void,
) {
  const keep = new Set(next.map((item) => item.id))
  const stale = [
    ...Object.keys(store.message),
    ...Object.keys(store.session_diff),
    ...Object.keys(store.todo),
    ...Object.keys(store.permission),
    ...Object.keys(store.question),
    ...Object.keys(store.session_status),
    ...Object.values(store.part)
      .map((parts) => parts?.find((part) => !!part?.sessionID)?.sessionID)
      .filter((sessionID): sessionID is string => !!sessionID),
  ].filter((sessionID, index, list) => !keep.has(sessionID) && list.indexOf(sessionID) === index)
  if (stale.length === 0) return
  for (const sessionID of stale) {
    setSessionTodo?.(sessionID, undefined)
  }
  setStore(
    produce((draft) => {
      dropSessionCaches(draft, stale)
    }),
  )
}

function handleSessionCreated(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  info: Session
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  const result = Binary.search(input.store.session, input.info.id, (s) => s.id)
  if (result.found) {
    input.setStore("session", result.index, reconcile(input.info))
    return
  }
  const next = input.store.session.slice()
  next.splice(result.index, 0, input.info)
  const trimmed = trimSessions(next, { limit: input.store.limit, permission: input.store.permission })
  input.setStore("session", reconcile(trimmed, { key: "id" }))
  cleanupDroppedSessionCaches(input.store, input.setStore, trimmed, input.setSessionTodo)
  if (!input.info.parentID) input.setStore("sessionTotal", (value) => value + 1)
}

function handleSessionUpdated(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  info: Session
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  const result = Binary.search(input.store.session, input.info.id, (s) => s.id)
  if (input.info.time.archived) {
    if (result.found) {
      input.setStore(
        "session",
        produce((draft) => {
          draft.splice(result.index, 1)
        }),
      )
    }
    cleanupSessionCaches(input.setStore, input.info.id, input.setSessionTodo)
    if (input.info.parentID) return
    input.setStore("sessionTotal", (value) => Math.max(0, value - 1))
    return
  }
  if (result.found) {
    input.setStore("session", result.index, reconcile(input.info))
    return
  }
  const next = input.store.session.slice()
  next.splice(result.index, 0, input.info)
  const trimmed = trimSessions(next, { limit: input.store.limit, permission: input.store.permission })
  input.setStore("session", reconcile(trimmed, { key: "id" }))
  cleanupDroppedSessionCaches(input.store, input.setStore, trimmed, input.setSessionTodo)
}

function handleSessionDeleted(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  info: Session
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  const result = Binary.search(input.store.session, input.info.id, (s) => s.id)
  if (result.found) {
    input.setStore(
      "session",
      produce((draft) => {
        draft.splice(result.index, 1)
      }),
    )
  }
  cleanupSessionCaches(input.setStore, input.info.id, input.setSessionTodo)
  if (input.info.parentID) return
  input.setStore("sessionTotal", (value) => Math.max(0, value - 1))
}

function handleSessionDiff(input: {
  setStore: SetStoreFunction<State>
  sessionID: string
  diff: SnapshotFileDiff[]
}) {
  input.setStore("session_diff", input.sessionID, reconcile(list(input.diff), { key: "file" }))
}

function handleTodoUpdated(input: {
  setStore: SetStoreFunction<State>
  sessionID: string
  todos: Todo[]
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
}) {
  input.setStore("todo", input.sessionID, reconcile(input.todos, { key: "id" }))
  input.setSessionTodo?.(input.sessionID, input.todos)
}

function handleSessionStatus(input: {
  setStore: SetStoreFunction<State>
  sessionID: string
  status: SessionStatus
}) {
  input.setStore("session_status", input.sessionID, reconcile(input.status))
}

// ── V2 message events → V1 message/part slices ──
// The session.next.* events carry the V2 projection; these handlers rebuild
// the V1-shaped slices the rendering chain consumes. Shapes are produced by
// v2-adapter.ts so the event path and the load path stay identical.

type MessageHandlerInput = {
  store: Store<State>
  setStore: SetStoreFunction<State>
  resolveOptimistic?: (sessionID: string, text: string) => void
}

function insertMessage(input: MessageHandlerInput, message: Message) {
  const messages = input.store.message[message.sessionID]
  if (!messages) {
    input.setStore("message", message.sessionID, [message])
    return
  }
  const result = Binary.search(messages, message.id, (m) => m.id)
  if (result.found) {
    input.setStore("message", message.sessionID, result.index, reconcile(message))
    return
  }
  input.setStore(
    "message",
    message.sessionID,
    produce((draft) => {
      draft.splice(result.index, 0, message)
    }),
  )
}

function insertParts(input: MessageHandlerInput, messageID: string, parts: Part[]) {
  const existing = input.store.part[messageID]
  if (!existing) {
    input.setStore("part", messageID, parts)
    return
  }
  for (const part of parts) insertPart(input, part)
}

function insertPart(input: MessageHandlerInput, part: Part) {
  const parts = input.store.part[part.messageID]
  if (!parts) {
    input.setStore("part", part.messageID, [part])
    return
  }
  const result = Binary.search(parts, part.id, (p) => p.id)
  if (result.found) {
    input.setStore("part", part.messageID, result.index, reconcile(part))
    return
  }
  input.setStore(
    "part",
    part.messageID,
    produce((draft) => {
      draft.splice(result.index, 0, part)
    }),
  )
}

function latestUser(messages: Message[] | undefined): UserMessage | undefined {
  return messages?.findLast((message): message is UserMessage => message.role === "user")
}

// V1 user messages store the model as {providerID, modelID}; the adapter's
// factories take the V2 shape {id, providerID}.
function toV2Model(model: UserMessage["model"] | undefined) {
  if (!model) return { id: "", providerID: "" }
  return { id: model.modelID, providerID: model.providerID, variant: model.variant }
}

function activeAssistant(messages: Message[] | undefined): AssistantMessage | undefined {
  return messages?.findLast(
    (message): message is AssistantMessage => message.role === "assistant" && message.time.completed === undefined,
  )
}

function activeAssistantParts(input: MessageHandlerInput, sessionID: string) {
  const assistant = activeAssistant(input.store.message[sessionID])
  if (!assistant) return
  return { assistant, parts: input.store.part[assistant.id] }
}

function updateAssistant(
  input: MessageHandlerInput,
  sessionID: string,
  messageID: string,
  fn: (assistant: AssistantMessage) => void,
) {
  input.setStore(
    "message",
    sessionID,
    produce((draft) => {
      const match = draft.find((message) => message.id === messageID)
      if (match?.role !== "assistant") return
      fn(match)
    }),
  )
}

function handlePrompted(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as {
    sessionID: string
    timestamp: number
    prompt: {
      text: string
      files?: PromptFileAttachment[]
      agents?: PromptAgentAttachment[]
      subtask?: PromptSubtaskAttachment
    }
    agent: string
    model: { id: string; providerID: string; variant?: string }
  }
  const id = event.id ?? ""
  const created = eventTime(props.timestamp)
  const message = userMessage({
    id,
    sessionID: props.sessionID,
    agent: props.agent,
    model: props.model,
    created,
  })
  const parts: Part[] = [textPart({ messageID: id, sessionID: props.sessionID, index: 0, text: props.prompt.text })]
  let index = parts.length
  for (const file of props.prompt.files ?? [])
    parts.push(filePart({ messageID: id, sessionID: props.sessionID, index: index++, file }))
  for (const agent of props.prompt.agents ?? [])
    parts.push(agentPart({ messageID: id, sessionID: props.sessionID, index: index++, agent }))
  if (props.prompt.subtask) parts.push(subtaskPart({ messageID: id, sessionID: props.sessionID, index: index++, subtask: props.prompt.subtask }))

  // Evict the optimistic entry matching this text before inserting, so the
  // timeline never shows both. V2 message ids are event ids, not the client's
  // messageID, so confirmation is text-based.
  input.resolveOptimistic?.(props.sessionID, props.prompt.text)
  insertMessage(input, message)
  insertParts(input, id, parts)
}

function handleSynthetic(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; timestamp: number; text: string }
  const user = latestUser(input.store.message[props.sessionID])
  if (!user) return
  const index = input.store.part[user.id]?.length ?? 0
  const part = commentPart({ messageID: user.id, sessionID: props.sessionID, index, text: props.text })
  if (part) insertPart(input, part)
}

function handleShellStarted(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; timestamp: number; callID: string; command: string }
  const created = eventTime(props.timestamp)
  const user = latestUser(input.store.message[props.sessionID])
  const agent = user?.agent ?? "build"
  const model = toV2Model(user?.model)

  // V1 shell flow: user message with a synthetic wrapper text part, then an
  // assistant carrying the bash tool part.
  const wrapperID = event.id ?? ""
  insertMessage(
    input,
    userMessage({ id: wrapperID, sessionID: props.sessionID, agent, model, created }),
  )
  insertParts(input, wrapperID, [
    textPart({
      messageID: wrapperID,
      sessionID: props.sessionID,
      index: 0,
      text: SHELL_SYNTHETIC_TEXT,
      synthetic: true,
    }),
  ])

  const assistantID = `${wrapperID}:assistant`
  insertMessage(
    input,
    assistantMessage({ id: assistantID, sessionID: props.sessionID, parentID: wrapperID, agent, model, created }),
  )
  insertPart(
    input,
    toolPart({
      messageID: assistantID,
      sessionID: props.sessionID,
      index: 0,
      callID: props.callID,
      tool: "bash",
      state: { status: "running", input: { command: props.command }, time: { start: created } },
    }),
  )
}

function handleShellEnded(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; timestamp: number; callID: string; output: string }
  const completed = eventTime(props.timestamp)
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  input.setStore("part", active.assistant.id, produce((draft) => {
    const match = findToolPart(draft, props.callID)
    if (match?.state.status !== "running") return
    match.state = {
      status: "completed",
      input: match.state.input,
      output: props.output,
      title: "",
      metadata: { output: props.output, description: "" },
      time: { ...match.state.time, end: completed },
    }
  }))
  updateAssistant(input, props.sessionID, active.assistant.id, (assistant) => {
    if (assistant.time.completed === undefined) assistant.time.completed = completed
  })
}

function handleStepStarted(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as {
    sessionID: string
    timestamp: number
    agent: string
    model: { id: string; providerID: string; variant?: string }
  }
  const messages = input.store.message[props.sessionID]
  const current = activeAssistant(messages)
  if (current) {
    const completed = eventTime(props.timestamp)
    updateAssistant(input, props.sessionID, current.id, (assistant) => {
      if (assistant.time.completed === undefined) assistant.time.completed = completed
    })
  }
  const user = latestUser(messages)
  insertMessage(
    input,
    assistantMessage({
      id: event.id ?? "",
      sessionID: props.sessionID,
      parentID: user?.id ?? "",
      agent: props.agent,
      model: props.model,
      created: eventTime(props.timestamp),
    }),
  )
}

function handleStepEnded(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as {
    sessionID: string
    timestamp: number
    finish?: string
    cost?: number
    tokens?: AssistantMessage["tokens"]
  }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  const completed = eventTime(props.timestamp)
  updateAssistant(input, props.sessionID, active.assistant.id, (assistant) => {
    assistant.time.completed = completed
    if (props.finish !== undefined) assistant.finish = props.finish
    if (props.cost !== undefined) assistant.cost = props.cost
    if (props.tokens) assistant.tokens = props.tokens
  })
}

function handleStepFailed(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as {
    sessionID: string
    timestamp: number
    error: { type: string; message: string }
  }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  const completed = eventTime(props.timestamp)
  updateAssistant(input, props.sessionID, active.assistant.id, (assistant) => {
    assistant.time.completed = completed
    assistant.finish = "error"
    assistant.error = toLegacyError(props.error)
  })
}

function handleTextStarted(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  insertPart(
    input,
    textPart({
      messageID: active.assistant.id,
      sessionID: props.sessionID,
      index: active.parts?.length ?? 0,
      text: "",
    }),
  )
}

function handleTextDelta(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; delta: string }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  input.setStore("part", active.assistant.id, produce((draft) => {
    const target = draft.findLast((part) => part.type === "text")
    if (target?.type !== "text") return
    target.text += props.delta
  }))
}

function handleTextEnded(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; text: string }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  input.setStore("part", active.assistant.id, produce((draft) => {
    const target = draft.findLast((part) => part.type === "text")
    if (target?.type !== "text") return
    target.text = props.text
  }))
}

function findToolPart(parts: Part[] | undefined, callID: string) {
  return parts?.find((part): part is Extract<Part, { type: "tool" }> => part.type === "tool" && part.callID === callID)
}

function handleToolInputStarted(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; timestamp: number; callID: string; name: string }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  insertPart(
    input,
    toolPart({
      messageID: active.assistant.id,
      sessionID: props.sessionID,
      index: active.parts?.length ?? 0,
      callID: props.callID,
      tool: props.name,
      state: { status: "pending", input: {}, raw: "" },
    }),
  )
}

function handleToolInputDelta(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; callID: string; delta: string }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active || findToolPart(active.parts, props.callID)?.state.status !== "pending") return
  input.setStore("part", active.assistant.id, produce((draft) => {
    const match = findToolPart(draft, props.callID)
    if (match?.state.status !== "pending") return
    match.state.raw += props.delta
  }))
}

function handleToolCalled(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as {
    sessionID: string
    timestamp: number
    callID: string
    input: Record<string, unknown>
  }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  input.setStore("part", active.assistant.id, produce((draft) => {
    const match = findToolPart(draft, props.callID)
    if (!match) return
    match.state = {
      status: "running",
      input: props.input,
      time: { start: eventTime(props.timestamp) },
    }
  }))
}

function handleToolProgress(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as {
    sessionID: string
    callID: string
    structured: Record<string, unknown>
  }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active || findToolPart(active.parts, props.callID)?.state.status !== "running") return
  input.setStore("part", active.assistant.id, produce((draft) => {
    const match = findToolPart(draft, props.callID)
    if (match?.state.status !== "running") return
    match.state.metadata = props.structured
  }))
}

function handleToolSuccess(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as {
    sessionID: string
    timestamp: number
    callID: string
    structured: Record<string, unknown>
    content: Array<{ type: "text"; text: string } | { type: "file"; uri: string; mime: string; name?: string }>
  }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active || findToolPart(active.parts, props.callID)?.state.status !== "running") return
  const output = props.content
    .filter((item): item is Extract<(typeof props.content)[number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n")
  input.setStore("part", active.assistant.id, produce((draft) => {
    const match = findToolPart(draft, props.callID)
    if (match?.state.status !== "running") return
    const attachments = props.content
      .filter((item): item is Extract<(typeof props.content)[number], { type: "file" }> => item.type === "file")
      .map((file, index) =>
        legacyFilePart({
          id: `${match.id}:attachment:${index}`,
          sessionID: props.sessionID,
          messageID: active.assistant.id,
          file,
          resolveFilePath: (uri) => decodeFilePath(stripQueryAndHash(stripFileProtocol(uri))),
        }),
      )
    match.state = {
      status: "completed",
      input: match.state.input,
      output,
      title: "",
      metadata: props.structured,
      time: { ...match.state.time, end: eventTime(props.timestamp) },
      ...(attachments.length ? { attachments } : {}),
    }
  }))
}

function handleToolFailed(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as {
    sessionID: string
    timestamp: number
    callID: string
    error: { type: string; message: string }
  }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active || findToolPart(active.parts, props.callID)?.state.status !== "running") return
  input.setStore("part", active.assistant.id, produce((draft) => {
    const match = findToolPart(draft, props.callID)
    if (match?.state.status !== "running") return
    match.state = {
      status: "error",
      input: match.state.input,
      error: props.error.message,
      metadata: match.state.metadata,
      time: { ...match.state.time, end: eventTime(props.timestamp) },
    }
  }))
}

function handleReasoningStarted(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; timestamp?: number; reasoningID: string }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  insertPart(
    input,
    reasoningPart({
      messageID: active.assistant.id,
      sessionID: props.sessionID,
      index: active.parts?.length ?? 0,
      text: "",
      reasoningID: props.reasoningID,
      start: eventTime(props.timestamp),
    }),
  )
}

function handleReasoningDelta(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; reasoningID: string; delta: string }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  input.setStore("part", active.assistant.id, produce((draft) => {
    const target = draft.find((part) => part.type === "reasoning" && part.id === `${active.assistant.id}:reasoning:${props.reasoningID}`)
    if (target?.type !== "reasoning") return
    target.text += props.delta
  }))
}

function handleReasoningEnded(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; timestamp?: number; reasoningID: string; text: string }
  const active = activeAssistantParts(input, props.sessionID)
  if (!active) return
  input.setStore("part", active.assistant.id, produce((draft) => {
    const target = draft.find((part) => part.type === "reasoning" && part.id === `${active.assistant.id}:reasoning:${props.reasoningID}`)
    if (target?.type !== "reasoning") return
    target.text = props.text
    if (typeof props.timestamp === "number") target.time.end = props.timestamp
  }))
}

function handleCompactionStarted(input: MessageHandlerInput, event: MessageEvent) {
  const props = event.properties as { sessionID: string; timestamp: number; reason: "auto" | "manual" }
  const user = latestUser(input.store.message[props.sessionID])
  const id = event.id ?? ""
  insertMessage(
    input,
    userMessage({
      id,
      sessionID: props.sessionID,
      agent: user?.agent ?? "build",
      model: toV2Model(user?.model),
      created: eventTime(props.timestamp),
    }),
  )
  insertPart(input, compactionPart({ messageID: id, sessionID: props.sessionID, auto: props.reason === "auto" }))
}

// compaction.delta / compaction.ended are no-ops: the summary text already
// streams through the compaction assistant's text events, which is where the
// V1 rendering read it from.

function handleVcsBranchUpdated(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  branch?: string
  vcsCache?: VcsCache
}) {
  if (input.store.vcs?.branch === input.branch) return
  const next = { ...input.store.vcs, branch: input.branch }
  input.setStore("vcs", next)
  if (input.vcsCache) input.vcsCache.setStore("value", next)
}

function handlePermissionAsked(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  permission: PermissionRequest
}) {
  const permissions = input.store.permission[input.permission.sessionID]
  if (!permissions) {
    input.setStore("permission", input.permission.sessionID, [input.permission])
    return
  }
  const result = Binary.search(permissions, input.permission.id, (p) => p.id)
  if (result.found) {
    input.setStore("permission", input.permission.sessionID, result.index, reconcile(input.permission))
    return
  }
  input.setStore(
    "permission",
    input.permission.sessionID,
    produce((draft) => {
      draft.splice(result.index, 0, input.permission)
    }),
  )
}

function handlePermissionReplied(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  sessionID: string
  requestID: string
}) {
  const permissions = input.store.permission[input.sessionID]
  if (!permissions) return
  const result = Binary.search(permissions, input.requestID, (p) => p.id)
  if (!result.found) return
  input.setStore(
    "permission",
    input.sessionID,
    produce((draft) => {
      draft.splice(result.index, 1)
    }),
  )
}

function handleQuestionAsked(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  question: QuestionRequest
}) {
  const questions = input.store.question[input.question.sessionID]
  if (!questions) {
    input.setStore("question", input.question.sessionID, [input.question])
    return
  }
  const result = Binary.search(questions, input.question.id, (q) => q.id)
  if (result.found) {
    input.setStore("question", input.question.sessionID, result.index, reconcile(input.question))
    return
  }
  input.setStore(
    "question",
    input.question.sessionID,
    produce((draft) => {
      draft.splice(result.index, 0, input.question)
    }),
  )
}

function handleQuestionRepliedRejected(input: {
  store: Store<State>
  setStore: SetStoreFunction<State>
  sessionID: string
  requestID: string
}) {
  const questions = input.store.question[input.sessionID]
  if (!questions) return
  const result = Binary.search(questions, input.requestID, (q) => q.id)
  if (!result.found) return
  input.setStore(
    "question",
    input.sessionID,
    produce((draft) => {
      draft.splice(result.index, 1)
    }),
  )
}

export function applyDirectoryEvent(input: {
  event: MessageEvent
  store: Store<State>
  setStore: SetStoreFunction<State>
  push: (directory: string) => void
  directory: string
  loadLsp: () => void
  vcsCache?: VcsCache
  setSessionTodo?: (sessionID: string, todos: Todo[] | undefined) => void
  resolveOptimistic?: (sessionID: string, text: string) => void
}) {
  const event = input.event
  const messages: MessageHandlerInput = {
    store: input.store,
    setStore: input.setStore,
    resolveOptimistic: input.resolveOptimistic,
  }
  switch (event.type) {
    case "server.instance.disposed": {
      input.push(input.directory)
      return
    }
    case "session.created": {
      handleSessionCreated({
        store: input.store,
        setStore: input.setStore,
        info: (event.properties as { info: Session }).info,
        setSessionTodo: input.setSessionTodo,
      })
      break
    }
    case "session.next.updated": {
      handleSessionUpdated({
        store: input.store,
        setStore: input.setStore,
        info: (event.properties as { info: Session }).info,
        setSessionTodo: input.setSessionTodo,
      })
      break
    }
    case "session.next.deleted": {
      handleSessionDeleted({
        store: input.store,
        setStore: input.setStore,
        info: (event.properties as { info: Session }).info,
        setSessionTodo: input.setSessionTodo,
      })
      break
    }
    case "session.next.diff": {
      const props = event.properties as { sessionID: string; diff: SnapshotFileDiff[] }
      handleSessionDiff({
        setStore: input.setStore,
        sessionID: props.sessionID,
        diff: props.diff,
      })
      break
    }
    case "session.next.todo": {
      const props = event.properties as { sessionID: string; todos: Todo[] }
      handleTodoUpdated({
        setStore: input.setStore,
        sessionID: props.sessionID,
        todos: props.todos,
        setSessionTodo: input.setSessionTodo,
      })
      break
    }
    case "session.next.status": {
      const props = event.properties as { sessionID: string; status: SessionStatus }
      handleSessionStatus({
        setStore: input.setStore,
        sessionID: props.sessionID,
        status: props.status,
      })
      break
    }
    case "session.next.prompted":
      handlePrompted(messages, event)
      break
    case "session.next.synthetic":
      handleSynthetic(messages, event)
      break
    case "session.next.shell.started":
      handleShellStarted(messages, event)
      break
    case "session.next.shell.ended":
      handleShellEnded(messages, event)
      break
    case "session.next.step.started":
      handleStepStarted(messages, event)
      break
    case "session.next.step.ended":
      handleStepEnded(messages, event)
      break
    case "session.next.step.failed":
      handleStepFailed(messages, event)
      break
    case "session.next.text.started":
      handleTextStarted(messages, event)
      break
    case "session.next.text.delta":
      handleTextDelta(messages, event)
      break
    case "session.next.text.ended":
      handleTextEnded(messages, event)
      break
    case "session.next.tool.input.started":
      handleToolInputStarted(messages, event)
      break
    case "session.next.tool.input.delta":
      handleToolInputDelta(messages, event)
      break
    case "session.next.tool.input.ended":
      break
    case "session.next.tool.called":
      handleToolCalled(messages, event)
      break
    case "session.next.tool.progress":
      handleToolProgress(messages, event)
      break
    case "session.next.tool.success":
      handleToolSuccess(messages, event)
      break
    case "session.next.tool.failed":
      handleToolFailed(messages, event)
      break
    case "session.next.reasoning.started":
      handleReasoningStarted(messages, event)
      break
    case "session.next.reasoning.delta":
      handleReasoningDelta(messages, event)
      break
    case "session.next.reasoning.ended":
      handleReasoningEnded(messages, event)
      break
    case "session.next.retried":
      break
    case "session.next.compaction.started":
      handleCompactionStarted(messages, event)
      break
    case "session.next.compaction.delta":
    case "session.next.compaction.ended":
      break
    case "vcs.branch.updated": {
      const props = event.properties as { branch?: string }
      handleVcsBranchUpdated({
        store: input.store,
        setStore: input.setStore,
        branch: props.branch,
        vcsCache: input.vcsCache,
      })
      break
    }
    case "session.next.permission.asked": {
      // The payload wraps the whole V1 permission request as `request`, typed
      // `unknown` in the SDK (it is the V1 PermissionRequest shape).
      const request = (event.properties as { request: PermissionRequest }).request
      handlePermissionAsked({
        store: input.store,
        setStore: input.setStore,
        permission: request,
      })
      break
    }
    case "session.next.permission.replied": {
      const props = event.properties as { sessionID: string; requestID: string }
      handlePermissionReplied({
        store: input.store,
        setStore: input.setStore,
        sessionID: props.sessionID,
        requestID: props.requestID,
      })
      break
    }
    case "question.asked": {
      handleQuestionAsked({
        store: input.store,
        setStore: input.setStore,
        question: event.properties as QuestionRequest,
      })
      break
    }
    case "question.replied":
    case "question.rejected": {
      const props = event.properties as { sessionID: string; requestID: string }
      handleQuestionRepliedRejected({
        store: input.store,
        setStore: input.setStore,
        sessionID: props.sessionID,
        requestID: props.requestID,
      })
      break
    }
    case "lsp.updated": {
      input.loadLsp()
      break
    }
  }
}
