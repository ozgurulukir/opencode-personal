import type { ModelMessage } from "ai"

export function injectReasoningParts(msgs: ModelMessage[]): ModelMessage[] {
  return msgs.map((msg) => {
    if (msg.role !== "assistant") return msg
    if (Array.isArray(msg.content)) {
      if (msg.content.some((part) => part.type === "reasoning")) return msg
      return { ...msg, content: [...msg.content, { type: "reasoning", text: "" }] }
    }
    return {
      ...msg,
      content: [
        ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
        { type: "reasoning" as const, text: "" },
      ],
    }
  })
}

export * as TransformDeepseek from "./deepseek"
