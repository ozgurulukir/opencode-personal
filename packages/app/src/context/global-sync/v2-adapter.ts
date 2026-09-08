import type {
  AgentPart,
  AssistantMessage,
  CompactionPart,
  FilePart,
  Message,
  Part,
  PromptAgentAttachment,
  PromptFileAttachment,
  ReasoningPart,
  SessionMessage,
  SessionMessageAssistant,
  SessionMessageAssistantTool,
  TextPart,
  ToolPart,
  ToolState,
  UserMessage,
} from "@opencode-ai/sdk/v2/client"
import { decodeFilePath, stripFileProtocol, stripQueryAndHash } from "@/context/file/path"
import { parseCommentNote } from "@/utils/comment-note"

// The V2 message model (SessionMessage) is the server's source of truth, but
// the app's rendering chain (packages/ui DataProvider, session-turn,
// message-part) consumes the V1 Message/Part shapes. This adapter converts V2
// messages (load path) and session.next.* events (event path, in
// event-reducer.ts) into V1-shaped store slices.

type V2Model = { id: string; providerID: string; variant?: string }

// Part ids are derived from the message id + content position so the load path
// and the event path produce identical ids (stable re-fetch merges, sorted
// inserts). The zero-padded index keeps id-sort equal to content order, which
// the V1 part slices and renderers rely on.
const sequence = (index: number) => String(index).padStart(4, "0")

export const partID = {
  text: (messageID: string, index: number) => `${messageID}:${sequence(index)}:text`,
  file: (messageID: string, index: number) => `${messageID}:${sequence(index)}:file`,
  agent: (messageID: string, index: number) => `${messageID}:${sequence(index)}:agent`,
  reasoning: (messageID: string, index: number) => `${messageID}:${sequence(index)}:reasoning`,
  tool: (messageID: string, index: number) => `${messageID}:${sequence(index)}:tool`,
  synthetic: (messageID: string, index: number) => `${messageID}:${sequence(index)}:synthetic`,
  compaction: (messageID: string) => `${messageID}:${sequence(0)}:compaction`,
}

// The V2 model carries variant "default" for "no variant"; the V1 shape omits it.
const toV1Model = (model: V2Model) => ({
  providerID: model.providerID,
  modelID: model.id,
  ...(model.variant && model.variant !== "default" ? { variant: model.variant } : {}),
})

const zeroTokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

// Non-synthetic text parts joined with "\n" — mirrors the server's user
// message projection (create-user-message.ts), so optimistic entries built
// from request parts can be matched against real projected messages.
export function messageText(parts: Part[]): string {
  return parts
    .filter((part) => part.type === "text" && !part.synthetic && !part.ignored)
    .map((part) => (part as TextPart).text)
    .join("\n")
}

export function userMessage(input: {
  id: string
  sessionID: string
  agent: string
  model: V2Model
  created: number
}): UserMessage {
  return {
    id: input.id,
    sessionID: input.sessionID,
    role: "user",
    time: { created: input.created },
    agent: input.agent,
    model: toV1Model(input.model),
  }
}

export function assistantMessage(input: {
  id: string
  sessionID: string
  parentID: string
  agent: string
  model: V2Model
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
    tokens: zeroTokens,
  }
}

export function textPart(input: {
  messageID: string
  sessionID: string
  index: number
  text: string
  synthetic?: boolean
}): TextPart {
  return {
    id: partID.text(input.messageID, input.index),
    type: "text",
    text: input.text,
    ...(input.synthetic ? { synthetic: true } : {}),
    sessionID: input.sessionID,
    messageID: input.messageID,
  }
}

const filePath = (uri: string) => decodeFilePath(stripQueryAndHash(stripFileProtocol(uri)))

export function filePart(input: {
  messageID: string
  sessionID: string
  index: number
  file: PromptFileAttachment
}): FilePart {
  const source = input.file.source
  return {
    id: partID.file(input.messageID, input.index),
    type: "file",
    mime: input.file.mime,
    ...(input.file.name === undefined ? {} : { filename: input.file.name }),
    url: input.file.uri,
    ...(source === undefined
      ? {}
      : {
          source: {
            type: "file" as const,
            path: filePath(input.file.uri),
            text: { value: source.text, start: source.start, end: source.end },
          },
        }),
    sessionID: input.sessionID,
    messageID: input.messageID,
  }
}

export function agentPart(input: {
  messageID: string
  sessionID: string
  index: number
  agent: PromptAgentAttachment
}): AgentPart {
  const source = input.agent.source
  return {
    id: partID.agent(input.messageID, input.index),
    type: "agent",
    name: input.agent.name,
    ...(source === undefined ? {} : { source: { value: source.text, start: source.start, end: source.end } }),
    sessionID: input.sessionID,
    messageID: input.messageID,
  }
}

export function reasoningPart(input: {
  messageID: string
  sessionID: string
  index: number
  text: string
}): ReasoningPart {
  return {
    id: partID.reasoning(input.messageID, input.index),
    type: "reasoning",
    text: input.text,
    time: { start: 0 },
    sessionID: input.sessionID,
    messageID: input.messageID,
  }
}

export function toolPart(input: {
  messageID: string
  sessionID: string
  index: number
  callID: string
  tool: string
  state: ToolState
}): ToolPart {
  return {
    id: partID.tool(input.messageID, input.index),
    type: "tool",
    callID: input.callID,
    tool: input.tool,
    state: input.state,
    sessionID: input.sessionID,
    messageID: input.messageID,
  }
}

export function compactionPart(input: { messageID: string; sessionID: string; auto: boolean }): CompactionPart {
  return {
    id: partID.compaction(input.messageID),
    type: "compaction",
    auto: input.auto,
    sessionID: input.sessionID,
    messageID: input.messageID,
  }
}

// V2 tool states carry the parsed input, structured metadata and content
// items; the V1 renderer reads state.input as an object, state.metadata for
// structured data and state.output as joined text. Timestamps come from the
// V2 tool item (created/ran/completed), not the state.
export function toolState(state: SessionMessageAssistantTool["state"], time: { created: number; ran?: number; completed?: number }): ToolState {
  if (state.status === "pending") return { status: "pending", input: {}, raw: state.input }
  const start = time.ran ?? time.created
  if (state.status === "running")
    return { status: "running", input: state.input, metadata: state.structured, time: { start } }
  const output = state.content
    .filter((item): item is Extract<(typeof state.content)[number], { type: "text" }> => item.type === "text")
    .map((item) => item.text)
    .join("\n")
  // The V1 completed/error states require an end timestamp.
  const end = time.completed ?? start
  if (state.status === "completed")
    return {
      status: "completed",
      input: state.input,
      output,
      title: "",
      metadata: state.structured,
      time: { start, end },
    }
  return {
    status: "error",
    input: state.input,
    error: state.error.message,
    metadata: state.structured,
    time: { start, end },
  }
}

// The synthetic wrapper text the V1 shell flow put on the user message.
export const SHELL_SYNTHETIC_TEXT = "The following tool was executed by the user"

// A V2 synthetic message is only rendered when it is a file/line comment
// note; it becomes a synthetic text part on the most recent user message
// (messageComments scans user message parts). Other synthetics (subagent
// results etc.) were not rendered by the app's V1 pipeline either.
export function commentPart(input: {
  messageID: string
  sessionID: string
  index: number
  text: string
}): TextPart | undefined {
  if (!parseCommentNote(input.text)) return undefined
  return textPart({ ...input, synthetic: true })
}

export type MessagePair = { message: Message; parts: Part[] }

// Convert an ascending (oldest-first) V2 message list into V1 store slices.
// Turn structure is rebuilt along the way: assistants attach to the most
// recent user message (parentID), shell and compaction messages expand into
// user-wrapper + assistant pairs, and synthetic comment notes attach to the
// most recent user message's parts. The V2 message shapes carry no sessionID
// (the endpoint is session-scoped), so it is passed in.
export function sessionMessagesToV1(
  messages: SessionMessage[],
  sessionID: string,
): {
  session: Message[]
  part: Record<string, Part[]>
} {
  const session: Message[] = []
  const part: Record<string, Part[]> = {}
  let parentID = ""
  let context: { agent: string; model: V2Model } | undefined

  const add = (pair: MessagePair) => {
    session.push(pair.message)
    part[pair.message.id] = pair.parts
  }

  for (const message of messages) {
    if (message.type === "user") {
      const parts: Part[] = [textPart({ messageID: message.id, sessionID, index: 0, text: message.text })]
      let index = parts.length
      for (const file of message.files ?? [])
        parts.push(filePart({ messageID: message.id, sessionID, index: index++, file }))
      for (const agent of message.agents ?? [])
        parts.push(agentPart({ messageID: message.id, sessionID, index: index++, agent }))
      parentID = message.id
      context = { agent: message.agent, model: message.model }
      add({
        message: userMessage({
          id: message.id,
          sessionID,
          agent: message.agent,
          model: message.model,
          created: message.time.created,
        }),
        parts,
      })
      continue
    }

    if (message.type === "assistant") {
      add(assistantPair(message, sessionID, parentID))
      continue
    }

    if (message.type === "shell") {
      // V1 shell flow: user message with a synthetic wrapper text part, then
      // an assistant carrying the bash tool part.
      const agent = context?.agent ?? "build"
      const model = context?.model ?? { id: "", providerID: "" }
      add({
        message: userMessage({
          id: message.id,
          sessionID,
          agent,
          model,
          created: message.time.created,
        }),
        parts: [
          textPart({
            messageID: message.id,
            sessionID,
            index: 0,
            text: SHELL_SYNTHETIC_TEXT,
            synthetic: true,
          }),
        ],
      })
      parentID = message.id
      const assistantID = `${message.id}:assistant`
      const state: ToolState = message.time.completed
        ? {
            status: "completed",
            input: { command: message.command },
            output: message.output,
            title: "",
            metadata: { output: message.output, description: "" },
            time: { start: message.time.created, end: message.time.completed },
          }
        : {
            status: "running",
            input: { command: message.command },
            metadata: { output: message.output, description: "" },
            time: { start: message.time.created },
          }
      add({
        message: assistantMessage({
          id: assistantID,
          sessionID,
          parentID: message.id,
          agent,
          model,
          created: message.time.created,
        }),
        parts: [
          toolPart({
            messageID: assistantID,
            sessionID,
            index: 0,
            callID: message.callID,
            tool: "bash",
            state,
          }),
        ],
      })
      continue
    }

    if (message.type === "compaction") {
      // V1 compaction flow: user message carrying the compaction part (the
      // turn divider); the summary assistant is a separate V2 message that
      // attaches to this wrapper.
      const agent = context?.agent ?? "build"
      const model = context?.model ?? { id: "", providerID: "" }
      add({
        message: userMessage({
          id: message.id,
          sessionID,
          agent,
          model,
          created: message.time.created,
        }),
        parts: [compactionPart({ messageID: message.id, sessionID, auto: message.reason === "auto" })],
      })
      parentID = message.id
      continue
    }

    if (message.type === "synthetic") {
      const target = context && parentID ? part[parentID] : undefined
      if (!target) continue
      const comment = commentPart({
        messageID: parentID,
        sessionID,
        index: target.length,
        text: message.text,
      })
      if (comment) target.push(comment)
      continue
    }

    // agent-switched / model-switched have no V1 rendering.
  }

  return { session, part }
}

function assistantPair(message: SessionMessageAssistant, sessionID: string, parentID: string): MessagePair {
  const info = assistantMessage({
    id: message.id,
    sessionID,
    parentID,
    agent: message.agent,
    model: message.model,
    created: message.time.created,
  })
  if (message.time.completed) info.time.completed = message.time.completed
  // The V2 projection flattens errors to {type, message}; reconstruct the V1
  // UnknownError shape the renderer reads (error.name / error.data.message).
  // Abort typing (MessageAbortedError) is lost in the V2 event payload.
  if (message.error) info.error = { name: "UnknownError", data: { message: message.error.message } }
  if (message.finish) info.finish = message.finish
  if (message.cost !== undefined) info.cost = message.cost
  if (message.tokens) info.tokens = message.tokens

  const parts: Part[] = []
  for (const item of message.content) {
    const index = parts.length
    if (item.type === "text") {
      parts.push(textPart({ messageID: message.id, sessionID, index, text: item.text }))
      continue
    }
    if (item.type === "reasoning") {
      parts.push(reasoningPart({ messageID: message.id, sessionID, index, text: item.text }))
      continue
    }
    parts.push(
      toolPart({
        messageID: message.id,
        sessionID,
        index,
        callID: item.id,
        tool: item.name,
        state: toolState(item.state, item.time),
      }),
    )
  }
  return { message: info, parts }
}
