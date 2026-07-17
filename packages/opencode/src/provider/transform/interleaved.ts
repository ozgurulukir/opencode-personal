import type { ModelMessage } from "ai"
import type { Model } from "../model"

export function extractReasoningField(msgs: ModelMessage[], model: Model): ModelMessage[] {
  if (typeof model.capabilities.interleaved !== "object") return msgs
  const field = model.capabilities.interleaved.field
  return msgs.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const reasoningParts = msg.content.filter((part: any) => part.type === "reasoning")
      const reasoningText = reasoningParts.map((part: any) => part.text).join("")

      // Filter out reasoning parts from content
      const filteredContent = msg.content.filter((part: any) => part.type !== "reasoning")

      // Include reasoning_content | reasoning_details directly on the message for all assistant messages.
      // Always set the field even when empty — some providers (e.g. DeepSeek) may return empty
      // reasoning_content which still needs to be sent back in subsequent requests.
      return {
        ...msg,
        content: filteredContent,
        providerOptions: {
          ...msg.providerOptions,
          openaiCompatible: {
            ...msg.providerOptions?.openaiCompatible,
            [field]: reasoningText,
          },
        },
      }
    }

    return msg
  })
}

export * as TransformInterleaved from "./interleaved"
