import type { ModelMessage } from "ai"
import { removeEmptyContent as removeEmptyContentFor } from "./remove-empty-content"

export function removeEmptyContent(msgs: ModelMessage[]): ModelMessage[] {
  return removeEmptyContentFor(msgs, "anthropic")
}

export function reorderToolUseBlocks(msgs: ModelMessage[]): ModelMessage[] {
  // Anthropic rejects assistant turns where tool_use blocks are followed by non-tool
  // content, e.g. [tool_use, tool_use, text], with:
  // `tool_use` ids were found without `tool_result` blocks immediately after...
  //
  // Reorder that invalid shape into [text] + [tool_use, tool_use]. Consecutive
  // assistant messages are later merged by the provider/SDK, so preserving the
  // original [tool_use...] then [text] order still produces the invalid payload.
  //
  // The root cause appears to be somewhere upstream where the stream is originally
  // processed. We were unable to locate an exact narrower reproduction elsewhere,
  // so we keep this transform in place for the time being.
  return msgs.flatMap((msg) => {
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) return [msg]

    const parts = msg.content
    const first = parts.findIndex((part) => part.type === "tool-call")
    if (first === -1) return [msg]
    if (!parts.slice(first).some((part) => part.type !== "tool-call")) return [msg]
    return [
      { ...msg, content: parts.filter((part) => part.type !== "tool-call") },
      { ...msg, content: parts.filter((part) => part.type === "tool-call") },
    ]
  })
}

export * as TransformAnthropic from "./anthropic"
