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
  SessionMessageAssistantTool,
  TextPart,
  ToolPart,
  ToolState,
  UserMessage,
} from "@opencode-ai/sdk/v2/client"
import {
  legacyAgentPart,
  legacyFilePart,
  legacyReasoningPart,
  legacySubtaskPart,
  legacyTextPart,
  legacyToolPart,
  legacyToolState,
  sessionMessagesToLegacy,
  toLegacyError,
  toLegacyModel,
} from "@opencode-ai/sdk/v2/legacy"
import type { LegacyError, LegacyModelRef } from "@opencode-ai/sdk/v2/legacy"
import { decodeFilePath, stripFileProtocol, stripQueryAndHash } from "@/context/file/path"
import { parseCommentNote } from "@/utils/comment-note"

// The V2 message model (SessionMessage) is the server's source of truth, but
// the app's rendering chain (packages/ui DataProvider, session-turn,
// message-part) consumes the V1 Message/Part shapes. This adapter converts V2
// messages (load path) and session.next.* events (event path, in
// event-reducer.ts) into V1-shaped store slices.

type V2Model = LegacyModelRef

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
  subtask: (messageID: string, index: number) => `${messageID}:${sequence(index)}:subtask`,
}

// The V2 model carries variant "default" for "no variant"; the V1 shape omits it.
const toV1Model = (model: V2Model) => ({
  ...toLegacyModel(model),
})

export function assistantError(input: LegacyError | undefined): AssistantMessage["error"] {
  return toLegacyError(input)
}

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
  return legacyTextPart({
    id: partID.text(input.messageID, input.index),
    sessionID: input.sessionID,
    messageID: input.messageID,
    text: input.text,
    synthetic: input.synthetic,
  })
}

const filePath = (uri: string) => decodeFilePath(stripQueryAndHash(stripFileProtocol(uri)))

export function toolAttachmentPart(input: {
  id: string
  sessionID: string
  messageID: string
  file: PromptFileAttachment
}): FilePart {
  return legacyFilePart({
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    file: input.file,
    resolveFilePath: filePath,
  })
}

export function filePart(input: {
  messageID: string
  sessionID: string
  index: number
  file: PromptFileAttachment
}): FilePart {
  return legacyFilePart({
    id: partID.file(input.messageID, input.index),
    sessionID: input.sessionID,
    messageID: input.messageID,
    file: input.file,
    resolveFilePath: filePath,
  })
}

export function agentPart(input: {
  messageID: string
  sessionID: string
  index: number
  agent: PromptAgentAttachment
}): AgentPart {
  return legacyAgentPart({
    id: partID.agent(input.messageID, input.index),
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: input.agent,
  })
}

export function subtaskPart(input: {
  messageID: string
  sessionID: string
  index: number
  subtask: NonNullable<Extract<SessionMessage, { type: "user" }>["subtask"]>
}) {
  return legacySubtaskPart({
    id: partID.subtask(input.messageID, input.index),
    sessionID: input.sessionID,
    messageID: input.messageID,
    subtask: input.subtask,
  })
}

export function reasoningPart(input: {
  messageID: string
  sessionID: string
  index: number
  text: string
  reasoningID?: string
  start?: number
  end?: number
}): ReasoningPart {
  return legacyReasoningPart({
    id: input.reasoningID
      ? `${input.messageID}:reasoning:${input.reasoningID}`
      : partID.reasoning(input.messageID, input.index),
    sessionID: input.sessionID,
    messageID: input.messageID,
    text: input.text,
    start: input.start ?? 0,
    end: input.end,
  })
}

export function toolPart(input: {
  messageID: string
  sessionID: string
  index: number
  callID: string
  tool: string
  state: ToolState
}): ToolPart {
  return legacyToolPart({
    id: partID.tool(input.messageID, input.index),
    sessionID: input.sessionID,
    messageID: input.messageID,
    callID: input.callID,
    tool: input.tool,
    state: input.state,
  })
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
export function toolState(
  state: SessionMessageAssistantTool["state"],
  time: { created: number; ran?: number; completed?: number },
): ToolState {
  return legacyToolState(state, time, { resolveFilePath: filePath })
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
  const entries = sessionMessagesToLegacy(messages, sessionID, {
    includeSynthetic: (text) => !!parseCommentNote(text),
    resolveFilePath: filePath,
    partID: (messageID, index, type) => {
      if (type === "text") return partID.text(messageID, index)
      if (type === "file") return partID.file(messageID, index)
      if (type === "agent") return partID.agent(messageID, index)
      if (type === "subtask") return partID.subtask(messageID, index)
      if (type === "tool") return partID.tool(messageID, index)
      if (type === "compaction") return partID.compaction(messageID)
      return `${messageID}:${sequence(index)}:${type}`
    },
  })
  return {
    session: entries.map((entry) => entry.info),
    part: Object.fromEntries(entries.map((entry) => [entry.info.id, entry.parts])),
  }
}
