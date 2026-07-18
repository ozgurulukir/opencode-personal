import type { Part, TextPart, ToolPart } from "@opencode-ai/sdk/v2"

export function contextToolSummary(parts: ToolPart[]) {
  // ⚡ Bolt Optimization: Replace multiple .filter().length with a single loop to reduce GC pressure
  let read = 0
  let search = 0
  let list = 0
  for (let i = 0; i < parts.length; i++) {
    const tool = parts[i].tool
    if (tool === "read") read++
    else if (tool === "glob" || tool === "grep") search++
    else if (tool === "list") list++
  }
  return { read, search, list }
}

export function findLastTextPart(parts: Part[], targetId: string) {
  // ⚡ Bolt Optimization: Use a backward loop to avoid creating an intermediate array and exit early
  let last: TextPart | undefined
  for (let i = parts.length - 1; i >= 0; i--) {
    const item = parts[i]
    if (item?.type === "text" && !!(item as TextPart).text?.trim()) {
      last = item as TextPart
      break
    }
  }
  return last?.id === targetId
}
