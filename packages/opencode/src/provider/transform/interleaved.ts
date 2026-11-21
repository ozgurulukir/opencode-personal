import type { ModelMessage } from "ai"
import type { Model } from "../model"

// The reasoning content-part shape in the ai-sdk ModelMessage union. `ai`
// doesn't re-export `ReasoningPart` as a type, so we match it structurally
// and narrow via a type guard (replaces the previous `(part: any)` filters).
type ReasoningPart = { type: "reasoning"; text: string }

function isReasoningPart(part: { type: unknown }): part is ReasoningPart {
  return part.type === "reasoning"
}

export function extractReasoningField(msgs: ModelMessage[], model: Model): ModelMessage[] {
  if (typeof model.capabilities.interleaved !== "object") return msgs
  const field = model.capabilities.interleaved.field
  return msgs.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const reasoningParts = msg.content.filter(isReasoningPart)
      const reasoningText = reasoningParts.map((part) => part.text).join("")

      // Filter out reasoning parts from content
      const filteredContent = msg.content.filter((part) => !isReasoningPart(part))

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
