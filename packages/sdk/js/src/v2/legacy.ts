import type {
  AssistantMessage,
  AgentPart,
  FilePart,
  Message,
  Part,
  PromptAgentAttachment,
  PromptFileAttachment,
  PromptSubtaskAttachment,
  ReasoningPart,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  SubtaskPart,
  TextPart,
  ToolPart,
  ToolState,
  UserMessage,
} from "./client.js"

export type LegacyModelRef = {
  id: string
  providerID: string
  variant?: string
}

export type LegacyError = {
  type: string
  message: string
}

export type LegacyHistoryEntry = {
  info: Message
  parts: Part[]
}

export type LegacyHistoryOptions = {
  includeTextTime?: boolean
  partID?: (messageID: string, index: number, type: Part["type"]) => string
  resolveFilePath?: (uri: string) => string
  includeSynthetic?: (text: string) => boolean
}

export function toLegacyModel(input: LegacyModelRef | undefined): UserMessage["model"] {
  return {
    providerID: input?.providerID ?? "",
    modelID: input?.id ?? "",
    ...(input?.variant && input.variant !== "default" ? { variant: input.variant } : {}),
  }
}

export function toLegacyError(input: LegacyError | undefined): AssistantMessage["error"] {
  if (!input) return undefined
  if (input.type === "aborted" || (input.type === "unknown" && input.message.toLowerCase().includes("abort"))) {
    return { name: "MessageAbortedError", data: { message: input.message } }
  }
  return { name: "UnknownError", data: { message: input.message } }
}

export function legacyTextPart(input: {
  id: string
  sessionID: string
  messageID: string
  text: string
  start?: number
  end?: number
  synthetic?: boolean
}): TextPart {
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "text",
    text: input.text,
    ...(input.start === undefined
      ? {}
      : { time: { start: input.start, ...(input.end === undefined ? {} : { end: input.end }) } }),
    ...(input.synthetic ? { synthetic: true } : {}),
  }
}

const legacyFilePath = (uri: string) => {
  const protocol = uri.startsWith("file://") ? uri.slice("file://".length) : uri
  const query = protocol.search(/[?#]/)
  const path = query === -1 ? protocol : protocol.slice(0, query)
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

export function legacyFilePart(input: {
  id: string
  sessionID: string
  messageID: string
  file: PromptFileAttachment
  resolveFilePath?: (uri: string) => string
}): FilePart {
  const source = input.file.source
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "file",
    mime: input.file.mime,
    url: input.file.uri,
    ...(input.file.name === undefined ? {} : { filename: input.file.name }),
    ...(source === undefined
      ? {}
      : {
          source: {
            type: "file" as const,
            path: (input.resolveFilePath ?? legacyFilePath)(input.file.uri),
            text: { value: source.text, start: source.start, end: source.end },
          },
        }),
  }
}

export function legacyAgentPart(input: {
  id: string
  sessionID: string
  messageID: string
  agent: PromptAgentAttachment
}): AgentPart {
  return {
    id: input.id,
    type: "agent",
    name: input.agent.name,
    ...(input.agent.source === undefined
      ? {}
      : { source: { value: input.agent.source.text, start: input.agent.source.start, end: input.agent.source.end } }),
    sessionID: input.sessionID,
    messageID: input.messageID,
  }
}

export function legacySubtaskPart(input: {
  id: string
  sessionID: string
  messageID: string
  subtask: PromptSubtaskAttachment
}): SubtaskPart {
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "subtask",
    prompt: input.subtask.prompt,
    description: input.subtask.description,
    agent: input.subtask.agent,
    ...(input.subtask.model ? { model: input.subtask.model } : {}),
    ...(input.subtask.command !== undefined ? { command: input.subtask.command } : {}),
  }
}

export function legacyReasoningPart(input: {
  id: string
  sessionID: string
  messageID: string
  text: string
  start: number
  end?: number
}): ReasoningPart {
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "reasoning",
    text: input.text,
    time: { start: input.start, ...(input.end === undefined ? {} : { end: input.end }) },
  }
}

function outputText(state: Extract<SessionMessageAssistantTool["state"], { status: "completed" | "error" }>) {
  return state.content
    .filter((item): item is Extract<(typeof state.content)[number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n")
}

export function legacyToolState(
  state: SessionMessageAssistantTool["state"],
  time: { created: number; ran?: number; completed?: number },
  input?: { id?: string; sessionID?: string; messageID?: string; resolveFilePath?: (uri: string) => string },
): ToolState {
  if (state.status === "pending") return { status: "pending", input: {}, raw: state.input }
  const start = time.ran ?? time.created
  if (state.status === "running")
    return { status: "running", input: state.input, metadata: state.structured, time: { start } }
  const end = time.completed ?? start
  if (state.status === "completed") {
    const files = state.attachments?.length
      ? state.attachments
      : state.content
          .filter((item): item is Extract<(typeof state.content)[number], { type: "file" }> => item.type === "file")
          .map(({ uri, mime, name }) => ({ uri, mime, ...(name === undefined ? {} : { name }) }))
    const attachments = files?.map((file, index) =>
      legacyFilePart({
        id: `${input?.id ?? "tool"}:attachment:${index}`,
        sessionID: input?.sessionID ?? "",
        messageID: input?.messageID ?? "",
        file,
        resolveFilePath: input?.resolveFilePath,
      }),
    )
    return {
      status: "completed",
      input: state.input,
      output: outputText(state),
      title: "",
      metadata: state.structured,
      time: { start, end },
      ...(attachments?.length ? { attachments } : {}),
    }
  }
  return {
    status: "error",
    input: state.input,
    error: state.error.message,
    metadata: state.structured,
    time: { start, end },
  }
}

export function legacyToolPart(input: {
  id: string
  sessionID: string
  messageID: string
  callID: string
  tool: string
  state: ToolState
}): ToolPart {
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "tool",
    callID: input.callID,
    tool: input.tool,
    state: input.state,
  }
}

function legacyUserInfo(input: {
  id: string
  sessionID: string
  agent: string
  model: LegacyModelRef
  created: number
}): UserMessage {
  return {
    id: input.id,
    sessionID: input.sessionID,
    role: "user",
    time: { created: input.created },
    agent: input.agent,
    model: toLegacyModel(input.model),
  }
}

function legacyAssistantInfo(input: {
  id: string
  sessionID: string
  parentID: string
  agent: string
  model: LegacyModelRef
  created: number
}): AssistantMessage {
  return {
    id: input.id,
    sessionID: input.sessionID,
    role: "assistant",
    parentID: input.parentID,
    time: { created: input.created },
    agent: input.agent,
    mode: input.agent,
    modelID: input.model.id,
    providerID: input.model.providerID,
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
}

function defaultPartID(messageID: string, index: number, type: Part["type"]) {
  return `${messageID}:${index}:${type}`
}

function historyUserParts(
  message: Extract<SessionMessage, { type: "user" }>,
  sessionID: string,
  options: LegacyHistoryOptions,
): Part[] {
  const partID = options.partID ?? defaultPartID
  const time = options.includeTextTime ? { start: message.time.created, end: message.time.created } : undefined
  const parts: Part[] = [
    legacyTextPart({
      id: partID(message.id, 0, "text"),
      sessionID,
      messageID: message.id,
      text: message.text,
      ...time,
    }),
  ]
  let index = 1
  for (const file of message.files ?? []) {
    parts.push(
      legacyFilePart({
        id: partID(message.id, index++, "file"),
        sessionID,
        messageID: message.id,
        file,
        resolveFilePath: options.resolveFilePath,
      }),
    )
  }
  for (const agent of message.agents ?? []) {
    parts.push(legacyAgentPart({ id: partID(message.id, index++, "agent"), sessionID, messageID: message.id, agent }))
  }
  if (message.subtask) {
    parts.push(
      legacySubtaskPart({
        id: partID(message.id, index, "subtask"),
        sessionID,
        messageID: message.id,
        subtask: message.subtask,
      }),
    )
  }
  return parts
}

function historyAssistantParts(
  message: SessionMessageAssistant,
  sessionID: string,
  options: LegacyHistoryOptions,
): Part[] {
  const partID = options.partID ?? defaultPartID
  return message.content.map((item, index) => {
    if (item.type === "text") {
      return legacyTextPart({
        id: partID(message.id, index, "text"),
        sessionID,
        messageID: message.id,
        text: item.text,
        ...(options.includeTextTime ? { start: message.time.created, end: message.time.completed } : {}),
      })
    }
    if (item.type === "reasoning") {
      return legacyReasoningPart({
        id: `${message.id}:reasoning:${item.id}`,
        sessionID,
        messageID: message.id,
        text: item.text,
        start: message.time.created,
        end: message.time.completed,
      })
    }
    const id = partID(message.id, index, "tool")
    return legacyToolPart({
      id,
      sessionID,
      messageID: message.id,
      callID: item.id,
      tool: item.name,
      state: legacyToolState(item.state, item.time, {
        id,
        sessionID,
        messageID: message.id,
        resolveFilePath: options.resolveFilePath,
      }),
    })
  })
}

export function sessionMessagesToLegacy(
  messages: SessionMessage[],
  sessionID: string,
  options: LegacyHistoryOptions = {},
): LegacyHistoryEntry[] {
  const output: LegacyHistoryEntry[] = []
  let parentID = ""
  let context: { agent: string; model: LegacyModelRef } | undefined
  const partID = options.partID ?? defaultPartID

  for (const message of messages) {
    if (message.type === "user") {
      output.push({
        info: legacyUserInfo({
          id: message.id,
          sessionID,
          agent: message.agent,
          model: message.model,
          created: message.time.created,
        }),
        parts: historyUserParts(message, sessionID, options),
      })
      parentID = message.id
      context = { agent: message.agent, model: message.model }
      continue
    }

    if (message.type === "assistant") {
      const info = legacyAssistantInfo({
        id: message.id,
        sessionID,
        parentID,
        agent: message.agent,
        model: message.model,
        created: message.time.created,
      })
      if (message.time.completed !== undefined) info.time.completed = message.time.completed
      if (message.error) info.error = toLegacyError(message.error)
      if (message.finish !== undefined) info.finish = message.finish
      if (message.cost !== undefined) info.cost = message.cost
      if (message.tokens) info.tokens = message.tokens
      output.push({ info, parts: historyAssistantParts(message, sessionID, options) })
      continue
    }

    if (message.type === "shell") {
      const agent = context?.agent ?? "build"
      const model = context?.model ?? { id: "", providerID: "" }
      output.push({
        info: legacyUserInfo({ id: message.id, sessionID, agent, model, created: message.time.created }),
        parts: [
          legacyTextPart({
            id: partID(message.id, 0, "text"),
            sessionID,
            messageID: message.id,
            text: "The following tool was executed by the user",
            start: message.time.created,
            end: message.time.created,
            synthetic: true,
          }),
        ],
      })
      parentID = message.id
      const assistantID = `${message.id}:assistant`
      const toolID = partID(assistantID, 0, "tool")
      const state: ToolState =
        message.time.completed === undefined
          ? {
              status: "running",
              input: { command: message.command },
              metadata: { output: message.output, description: "" },
              time: { start: message.time.created },
            }
          : {
              status: "completed",
              input: { command: message.command },
              output: message.output,
              title: "",
              metadata: { output: message.output, description: "" },
              time: { start: message.time.created, end: message.time.completed },
            }
      output.push({
        info: legacyAssistantInfo({
          id: assistantID,
          sessionID,
          parentID: message.id,
          agent,
          model,
          created: message.time.created,
        }),
        parts: [
          legacyToolPart({
            id: toolID,
            sessionID,
            messageID: assistantID,
            callID: message.callID,
            tool: "bash",
            state,
          }),
        ],
      })
      continue
    }

    if (message.type === "compaction") {
      const agent = context?.agent ?? "build"
      const model = context?.model ?? { id: "", providerID: "" }
      parentID = message.id
      output.push({
        info: legacyUserInfo({ id: message.id, sessionID, agent, model, created: message.time.created }),
        parts: [
          {
            id: partID(message.id, 0, "compaction"),
            sessionID,
            messageID: message.id,
            type: "compaction",
            auto: message.reason === "auto",
          },
        ],
      })
      continue
    }

    if (message.type === "synthetic") {
      const target = output
        .slice()
        .reverse()
        .find((item) => item.info.role === "user" && item.info.id === parentID)
      if (!target || options.includeSynthetic?.(message.text) === false) continue
      target.parts.push(
        legacyTextPart({
          id: `${message.id}:synthetic`,
          sessionID,
          messageID: parentID,
          text: message.text,
          start: message.time.created,
          end: message.time.created,
          synthetic: true,
        }),
      )
    }
  }

  return output
}
