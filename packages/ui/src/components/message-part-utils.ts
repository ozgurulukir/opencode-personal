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

import { attached, inline } from "./message-file"
import type { AgentPart, FilePart } from "@opencode-ai/sdk/v2"

export function parseUserMessageParts(rawParts: Part[] | undefined) {
  const files: FilePart[] = []
  const attachments: FilePart[] = []
  const inlineFiles: FilePart[] = []
  const agents: AgentPart[] = []
  const parts = rawParts ?? []

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.type === "file") {
      const filePart = p as FilePart
      files.push(filePart)
      if (attached(filePart)) attachments.push(filePart)
      if (inline(filePart)) inlineFiles.push(filePart)
    } else if (p.type === "agent") {
      agents.push(p as AgentPart)
    }
  }
  return { files, attachments, inlineFiles, agents }
}
