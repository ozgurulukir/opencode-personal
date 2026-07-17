import type { ModelMessage } from "ai"

export function removeEmptyContent(msgs: ModelMessage[]): ModelMessage[] {
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
          return (
            part.text.trim().length > 0 ||
            part.providerOptions?.bedrock?.signature != null ||
            part.providerOptions?.bedrock?.redactedData != null
          )
        }
        return true
      })
      if (filtered.length === 0) return undefined
      return { ...msg, content: filtered }
    })
    .filter((msg): msg is ModelMessage => msg !== undefined && msg.content !== "")
}

export * as TransformBedrock from "./bedrock"
