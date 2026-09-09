import type {
  AssistantMessage,
  Event,
  Message,
  Part,
  PromptAgentAttachment,
  PromptFileAttachment,
  PromptSubtaskAttachment,
  SessionMessage,
  StepFinishPart,
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
  sessionMessagesToLegacy as sharedSessionMessagesToLegacy,
  toLegacyError,
  toLegacyModel,
} from "@opencode-ai/sdk/v2/legacy"
import type { LegacyModelRef } from "@opencode-ai/sdk/v2/legacy"

type ModelRef = LegacyModelRef

type SessionMessageWithParts = {
  info: Message
  parts: Part[]
}

type SessionState = {
  userID?: string
  assistantID?: string
  model: ModelRef
  agent: string
  textID?: string
  reasoning: Map<string, { id: string; start: number }>
  tools: Map<string, { id: string; tool: string; start: number; input: Record<string, unknown> }>
}

const zeroTokens = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

const migratedLegacyEvents = new Set([
  "message.updated",
  "message.updated.batch",
  "message.part.updated",
  "message.part.updated.batch",
  "message.part.delta",
  "message.removed",
  "message.part.removed",
  "session.error",
  "session.status",
  "permission.asked",
  "permission.replied",
])

function userInfo(input: {
  id: string
  sessionID: string
  agent: string
  model: ModelRef
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

function assistantInfo(input: {
  id: string
  sessionID: string
  parentID: string
  agent: string
  model: ModelRef
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

export function sessionMessagesToLegacy(messages: SessionMessage[], sessionID: string): SessionMessageWithParts[] {
  return sharedSessionMessagesToLegacy(messages, sessionID, { includeTextTime: true })
}

function legacy(id: string, type: string, properties: Record<string, unknown>): Event {
  // The generated Event union cannot express the intermediate V1 shape with
  // a dynamic type. All properties are built from generated SDK fields above;
  // this is the single compatibility boundary for the existing run reducer.
  return { id, type, properties } as unknown as Event
}

type NativeData = {
  sessionID: string
  timestamp: number
  agent: string
  model: ModelRef
  prompt: {
    text: string
    files?: PromptFileAttachment[]
    agents?: PromptAgentAttachment[]
    subtask?: PromptSubtaskAttachment
  }
  finish: string
  cost: number
  tokens: AssistantMessage["tokens"]
  error: { type: string; message: string }
  delta: string
  text: string
  reasoningID: string
  callID: string
  name: string
  tool: string
  input: Record<string, unknown>
  provider: { metadata?: Record<string, unknown> }
  structured: Record<string, unknown>
  content: Array<{ type: string; text?: string; uri?: string; mime?: string; name?: string }>
  output: string
  command: string
  status: { type: string }
  request: object
  requestID: string
  reply: string
}

function nativeData(event: Event) {
  return event.properties as unknown as NativeData
}

function native(type: string) {
  return type.startsWith("session.next.")
}

function stateFor(states: Map<string, SessionState>, sessionID: string) {
  const current = states.get(sessionID)
  if (current) return current
  const next: SessionState = {
    agent: "build",
    model: { id: "", providerID: "" },
    reasoning: new Map(),
    tools: new Map(),
  }
  states.set(sessionID, next)
  return next
}

function outputText(content: Array<{ type: string; text?: string }>) {
  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n")
}

function toolEvent(
  event: Event,
  state: SessionState,
  input: {
    callID: string
    tool?: string
    status: ToolState["status"]
    timestamp: number
    input?: Record<string, unknown>
    structured?: Record<string, unknown>
    output?: string
    error?: string
    attachments?: PromptFileAttachment[]
  },
): Event[] {
  const sessionID = nativeData(event).sessionID
  const current = state.tools.get(input.callID)
  const partID = current?.id ?? `${state.assistantID ?? event.id}:tool:${input.callID}`
  const tool = input.tool ?? current?.tool ?? "tool"
  const start = current?.start ?? input.timestamp
  const toolInput = input.input ?? current?.input ?? {}
  state.tools.set(input.callID, { id: partID, tool, start, input: toolInput })
  const end = input.timestamp
  const attachments = input.attachments?.map((file, index) =>
    legacyFilePart({
      id: `${partID}:attachment:${index}`,
      sessionID,
      messageID: state.assistantID ?? `${event.id}:assistant`,
      file,
    }),
  )
  const part = legacyToolPart({
    id: partID,
    sessionID,
    messageID: state.assistantID ?? `${event.id}:assistant`,
    callID: input.callID,
    tool,
    state:
      input.status === "pending"
        ? { status: "pending", input: toolInput, raw: "" }
        : input.status === "running"
          ? { status: "running", input: toolInput, metadata: input.structured, time: { start } }
          : input.status === "completed"
            ? {
                status: "completed",
                input: toolInput,
                output: input.output ?? "",
                title: "",
                metadata: input.structured ?? {},
                time: { start, end },
                ...(attachments?.length ? { attachments } : {}),
              }
            : {
                status: "error",
                input: toolInput,
                error: input.error ?? "unknown error",
                metadata: input.structured,
                time: { start, end },
              },
  })
  return [legacy(`${event.id}:part`, "message.part.updated", { sessionID, part, time: input.timestamp })]
}

function ensureAssistant(events: Event[], event: Event, state: SessionState, timestamp: number, id = event.id) {
  if (state.assistantID) return
  state.assistantID = id
  events.push(
    legacy(`${event.id}:message`, "message.updated", {
      sessionID: nativeData(event).sessionID,
      info: assistantInfo({
        id,
        sessionID: nativeData(event).sessionID,
        parentID: state.userID ?? "",
        agent: state.agent,
        model: state.model,
        created: timestamp,
      }),
    }),
  )
}

function stepFinish(
  event: Event,
  state: SessionState,
  props: { finish: string; cost: number; tokens: AssistantMessage["tokens"] },
): StepFinishPart {
  const assistantID = state.assistantID ?? `${event.id}:assistant`
  return {
    id: `${assistantID}:step:${event.id}`,
    sessionID: nativeData(event).sessionID,
    messageID: assistantID,
    type: "step-finish",
    reason: props.finish,
    cost: props.cost,
    tokens: props.tokens,
  }
}

export function isMigratedLegacyEvent(type: string) {
  return migratedLegacyEvents.has(type)
}

export function createV2EventAdapter() {
  const states = new Map<string, SessionState>()

  return {
    adapt(event: Event): Event[] {
      if (!native(event.type)) return [event]
      const props = nativeData(event)
      const sessionID = props.sessionID
      const state = stateFor(states, sessionID)
      const timestamp = props.timestamp

      switch (event.type) {
        case "session.next.agent.switched":
          state.agent = props.agent
          return []
        case "session.next.model.switched":
          state.model = props.model
          return []
        case "session.next.prompted": {
          state.userID = event.id
          state.agent = props.agent
          state.model = props.model
          state.textID = undefined
          const parts: Part[] = [
            legacyTextPart({
              id: `${event.id}:text`,
              sessionID,
              messageID: event.id,
              text: props.prompt.text,
              start: timestamp,
              end: timestamp,
            }),
          ]
          let index = 1
          for (const file of props.prompt.files ?? []) {
            parts.push(legacyFilePart({ id: `${event.id}:${index++}:file`, sessionID, messageID: event.id, file }))
          }
          for (const agent of props.prompt.agents ?? []) {
            parts.push(legacyAgentPart({ id: `${event.id}:${index++}:agent`, sessionID, messageID: event.id, agent }))
          }
          if (props.prompt.subtask) {
            parts.push(
              legacySubtaskPart({
                id: `${event.id}:${index}:subtask`,
                sessionID,
                messageID: event.id,
                subtask: props.prompt.subtask,
              }),
            )
          }
          return [
            legacy(`${event.id}:message`, "message.updated", {
              sessionID,
              info: userInfo({ id: event.id, sessionID, agent: state.agent, model: state.model, created: timestamp }),
            }),
            legacy(`${event.id}:part`, "message.part.updated", {
              sessionID,
              part: parts[0],
              time: timestamp,
            }),
            ...parts
              .slice(1)
              .map((part) =>
                legacy(`${event.id}:${part.id}`, "message.part.updated", { sessionID, part, time: timestamp }),
              ),
          ]
        }
        case "session.next.step.started": {
          state.agent = props.agent
          state.model = props.model
          state.assistantID = event.id
          state.textID = undefined
          state.reasoning.clear()
          state.tools.clear()
          return [
            legacy(`${event.id}:message`, "message.updated", {
              sessionID,
              info: assistantInfo({
                id: event.id,
                sessionID,
                parentID: state.userID ?? "",
                agent: state.agent,
                model: state.model,
                created: timestamp,
              }),
            }),
          ]
        }
        case "session.next.step.ended": {
          const part = stepFinish(event, state, { finish: props.finish, cost: props.cost, tokens: props.tokens })
          return [legacy(`${event.id}:part`, "message.part.updated", { sessionID, part, time: timestamp })]
        }
        case "session.next.step.failed":
          return [legacy(`${event.id}:error`, "session.error", { sessionID, error: toLegacyError(props.error) })]
        case "session.next.text.started": {
          if (!state.assistantID) return []
          state.textID = `${state.assistantID}:text:${event.id}`
          return [
            legacy(`${event.id}:part`, "message.part.updated", {
              sessionID,
              part: legacyTextPart({ id: state.textID, sessionID, messageID: state.assistantID, text: "", start: timestamp }),
              time: timestamp,
            }),
          ]
        }
        case "session.next.text.delta": {
          if (!state.assistantID || !state.textID) return []
          return [
            legacy(`${event.id}:delta`, "message.part.delta", {
              sessionID,
              messageID: state.assistantID,
              partID: state.textID,
              field: "text",
              delta: props.delta,
            }),
          ]
        }
        case "session.next.text.ended": {
          if (!state.assistantID) return []
          const id = state.textID ?? `${state.assistantID}:text:${event.id}`
          state.textID = undefined
          return [
            legacy(`${event.id}:part`, "message.part.updated", {
              sessionID,
              part: legacyTextPart({
                id,
                sessionID,
                messageID: state.assistantID,
                text: props.text,
                start: timestamp,
                end: timestamp,
              }),
              time: timestamp,
            }),
          ]
        }
        case "session.next.reasoning.started": {
          if (!state.assistantID) return []
          const id = `${state.assistantID}:reasoning:${props.reasoningID}`
          state.reasoning.set(props.reasoningID, { id, start: timestamp })
          return [
            legacy(`${event.id}:part`, "message.part.updated", {
              sessionID,
              part: legacyReasoningPart({ id, sessionID, messageID: state.assistantID, text: "", start: timestamp }),
              time: timestamp,
            }),
          ]
        }
        case "session.next.reasoning.delta": {
          const id = state.reasoning.get(props.reasoningID)?.id
          if (!state.assistantID || !id) return []
          return [
            legacy(`${event.id}:delta`, "message.part.delta", {
              sessionID,
              messageID: state.assistantID,
              partID: id,
              field: "text",
              delta: props.delta,
            }),
          ]
        }
        case "session.next.reasoning.ended": {
          if (!state.assistantID) return []
          const current = state.reasoning.get(props.reasoningID)
          const id = current?.id ?? `${state.assistantID}:reasoning:${props.reasoningID}`
          state.reasoning.delete(props.reasoningID)
          return [
            legacy(`${event.id}:part`, "message.part.updated", {
              sessionID,
              part: legacyReasoningPart({
                id,
                sessionID,
                messageID: state.assistantID,
                text: props.text,
                start: current?.start ?? timestamp,
                end: timestamp,
              }),
              time: timestamp,
            }),
          ]
        }
        case "session.next.tool.input.started": {
          if (!state.assistantID) return []
          state.tools.set(props.callID, {
            id: `${state.assistantID}:tool:${props.callID}`,
            tool: props.name,
            start: timestamp,
            input: {},
          })
          return toolEvent(event, state, { callID: props.callID, tool: props.name, status: "pending", timestamp })
        }
        case "session.next.tool.input.delta":
        case "session.next.tool.input.ended":
          return []
        case "session.next.tool.called":
          if (!state.assistantID) return []
          return toolEvent(event, state, {
            callID: props.callID,
            tool: props.tool,
            status: "running",
            timestamp,
            input: props.input,
            structured: props.provider.metadata,
          })
        case "session.next.tool.progress":
          if (!state.assistantID) return []
          return toolEvent(event, state, {
            callID: props.callID,
            status: "running",
            timestamp,
            structured: props.structured,
            input: state.tools.get(props.callID)?.input,
          })
        case "session.next.tool.success":
          if (!state.assistantID) return []
          return toolEvent(event, state, {
            callID: props.callID,
            status: "completed",
            timestamp,
            structured: props.structured,
            output: outputText(props.content),
            input: state.tools.get(props.callID)?.input,
            attachments: props.content
              .filter(
                (item): item is { type: "file"; uri: string; mime: string; name?: string } =>
                  item.type === "file" && typeof item.uri === "string" && typeof item.mime === "string",
              )
              .map(({ uri, mime, name }) => ({ uri, mime, ...(name === undefined ? {} : { name }) })),
          })
        case "session.next.tool.failed":
          if (!state.assistantID) return []
          return toolEvent(event, state, {
            callID: props.callID,
            status: "error",
            timestamp,
            structured: props.provider.metadata,
            error: props.error.message,
            input: state.tools.get(props.callID)?.input,
          })
        case "session.next.shell.started": {
          const events: Event[] = []
          ensureAssistant(events, event, state, timestamp)
          events.push(
            ...toolEvent(event, state, {
              callID: props.callID,
              tool: "bash",
              status: "running",
              timestamp,
              input: { command: props.command },
            }),
          )
          return events
        }
        case "session.next.shell.ended":
          if (!state.assistantID) return []
          return toolEvent(event, state, {
            callID: props.callID,
            tool: "bash",
            status: "completed",
            timestamp,
            output: props.output,
            input: { command: state.tools.get(props.callID)?.input.command ?? "" },
          })
        case "session.next.synthetic": {
          if (!state.userID) return []
          return [
            legacy(`${event.id}:part`, "message.part.updated", {
              sessionID,
              part: legacyTextPart({
                id: `${event.id}:synthetic`,
                sessionID,
                messageID: state.userID,
                text: props.text,
                start: timestamp,
                end: timestamp,
                synthetic: true,
              }),
              time: timestamp,
            }),
          ]
        }
        case "session.next.status": {
          if (!props.status || typeof props.status !== "object" || typeof props.status.type !== "string") return []
          return [legacy(event.id, "session.status", { sessionID, status: props.status })]
        }
        case "session.next.permission.asked":
          if (!props.request || typeof props.request !== "object") return []
          return [legacy(event.id, "permission.asked", { ...props.request, sessionID })]
        case "session.next.permission.replied":
          return [legacy(event.id, "permission.replied", { sessionID, requestID: props.requestID, reply: props.reply })]
        case "session.next.retried":
          return [
            legacy(`${event.id}:error`, "session.error", {
              sessionID,
              error: { name: "UnknownError", data: { message: props.error.message } },
            }),
          ]
        default:
          return []
      }
    },
  }
}
