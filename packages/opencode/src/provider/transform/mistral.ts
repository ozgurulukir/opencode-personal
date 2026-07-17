import type { ModelMessage } from "ai"

export function normalizeForMistral(msgs: ModelMessage[]): ModelMessage[] {
  const scrub = (id: string) => {
    return id
      .replace(/[^a-zA-Z0-9]/g, "") // Remove non-alphanumeric characters
      .substring(0, 9) // Take first 9 characters
      .padEnd(9, "0") // Pad with zeros if less than 9 characters
  }
  const result: ModelMessage[] = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const nextMsg = msgs[i + 1]

    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      msg.content = msg.content.map((part) => {
        if (part.type === "tool-call" || part.type === "tool-result") {
          return { ...part, toolCallId: scrub(part.toolCallId) }
        }
        return part
      })
    }
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      msg.content = msg.content.map((part) => {
        if (part.type === "tool-result") {
          return { ...part, toolCallId: scrub(part.toolCallId) }
        }
        return part
      })
    }
    result.push(msg)

    // Fix message sequence: tool messages cannot be followed by user messages
    if (msg.role === "tool" && nextMsg?.role === "user") {
      result.push({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "Done.",
          },
        ],
      })
    }
  }
  return result
}

export * as TransformMistral from "./mistral"
