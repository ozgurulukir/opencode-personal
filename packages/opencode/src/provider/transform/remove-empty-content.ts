import type { ModelMessage } from "ai"

/**
 * Filters empty text/reasoning parts from messages. Reasoning parts with empty
 * text are kept when they carry a provider signature or redacted data — the
 * provider key selects which providerOptions field is checked. Pinned by
 * test/provider/transform.test.ts ("anthropic empty content filtering").
 */
export function removeEmptyContent(msgs: ModelMessage[], provider: "anthropic" | "bedrock"): ModelMessage[] {
  return msgs
    .map((msg) => {
      if (typeof msg.content === "string") {
        if (msg.content === "") return undefined
        return msg
      }
      if (!Array.isArray(msg.content)) return msg
      const filtered = msg.content.filter((part) => {
        if (part.type === "text") {
          return part.text !== ""
        }
        if (part.type === "reasoning") {
          const options = provider === "anthropic" ? part.providerOptions?.anthropic : part.providerOptions?.bedrock
          return part.text.trim().length > 0 || options?.signature != null || options?.redactedData != null
        }
        return true
      })
      if (filtered.length === 0) return undefined
      return { ...msg, content: filtered }
    })
    .filter((msg): msg is ModelMessage => msg !== undefined && msg.content !== "")
}
