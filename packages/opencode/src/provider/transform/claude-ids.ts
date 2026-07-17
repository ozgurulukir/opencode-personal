import type { ModelMessage } from "ai"

export function scrubToolCallIds(msgs: ModelMessage[]): ModelMessage[] {
  const scrub = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_")
  return msgs.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((part) => {
          if (part.type === "tool-call" || part.type === "tool-result") {
            return { ...part, toolCallId: scrub(part.toolCallId) }
          }
          return part
        }),
      }
    }
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: msg.content.map((part) => {
          if (part.type === "tool-result") {
            return { ...part, toolCallId: scrub(part.toolCallId) }
          }
          return part
        }),
      }
    }
    return msg
  })
}

export * as TransformClaudeIds from "./claude-ids"
