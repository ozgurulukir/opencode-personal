import type { Provider, SessionMessage, SessionMessageAssistant } from "@opencode-ai/sdk/v2"
import { Locale } from "@/util/locale"
import * as Model from "./model"

export type TranscriptOptions = {
  thinking: boolean
  toolDetails: boolean
  assistantMetadata: boolean
  providers?: Provider[]
}

export type SessionInfo = {
  id: string
  title: string
  time: {
    created: number
    updated: number
  }
}

export function formatTranscript(
  session: SessionInfo,
  messages: SessionMessage[],
  options: TranscriptOptions,
): string {
  const providers = Model.index(options.providers)
  let transcript = `# ${session.title}\n\n`
  transcript += `**Session ID:** ${session.id}\n`
  transcript += `**Created:** ${new Date(session.time.created).toLocaleString()}\n`
  transcript += `**Updated:** ${new Date(session.time.updated).toLocaleString()}\n\n`
  transcript += `---\n\n`

  for (const msg of messages) {
    transcript += formatMessage(msg, options, providers)
    transcript += `---\n\n`
  }

  return transcript
}

export function formatMessage(
  msg: SessionMessage,
  options: TranscriptOptions,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
): string {
  if (msg.type !== "user" && msg.type !== "assistant") return ""
  let result = ""

  if (msg.type === "user") {
    result += `## User\n\n`
    result += formatUserContent(msg)
  } else {
    result += formatAssistantHeader(msg, options.assistantMetadata, providers ?? options.providers)
    result += formatAssistantContent(msg, options)
  }

  return result
}

function formatUserContent(msg: Extract<SessionMessage, { type: "user" }>): string {
  let result = ""
  if (msg.text) result += `${msg.text}\n\n`
  for (const file of msg.files ?? []) {
    result += `_Attachment: ${file.name ?? file.uri} (${file.mime})_\n\n`
  }
  for (const agent of msg.agents ?? []) {
    result += `_Agent: @${agent.name}_\n\n`
  }
  return result
}

export function formatAssistantHeader(
  msg: SessionMessageAssistant,
  includeMetadata: boolean,
  providers?: Provider[] | ReadonlyMap<string, Provider>,
): string {
  if (!includeMetadata) {
    return `## Assistant\n\n`
  }

  const duration =
    msg.time.completed && msg.time.created ? ((msg.time.completed - msg.time.created) / 1000).toFixed(1) + "s" : ""

  const modelName = Model.name(providers, msg.model.providerID, msg.model.id)

  return `## Assistant (${Locale.titlecase(msg.agent)} · ${modelName}${duration ? ` · ${duration}` : ""})\n\n`
}

function toolOutput(state: Extract<Extract<SessionMessageAssistant["content"][number], { type: "tool" }>["state"], { status: "completed" }>): string {
  return state.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
}

function formatAssistantContent(msg: SessionMessageAssistant, options: TranscriptOptions): string {
  let result = ""
  for (const part of msg.content) {
    if (part.type === "text") {
      result += `${part.text}\n\n`
      continue
    }

    if (part.type === "reasoning") {
      if (options.thinking) {
        result += `_Thinking:_\n\n${part.text}\n\n`
      }
      continue
    }

    if (part.type === "tool") {
      result += `**Tool: ${part.name}**\n`
      if (options.toolDetails && part.state.input) {
        result += `\n**Input:**\n\`\`\`json\n${JSON.stringify(part.state.input, null, 2)}\n\`\`\`\n`
      }
      if (options.toolDetails && part.state.status === "completed") {
        const output = toolOutput(part.state)
        if (output) {
          result += `\n**Output:**\n\`\`\`\n${output}\n\`\`\`\n`
        }
      }
      if (options.toolDetails && part.state.status === "error" && part.state.error) {
        result += `\n**Error:**\n\`\`\`\n${part.state.error.message}\n\`\`\`\n`
      }
      result += `\n`
    }
  }
  return result
}
