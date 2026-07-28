import { describe, expect, test } from "bun:test"
import { contextToolSummary, findLastTextPart } from "./message-part-utils"
import type { Part, TextPart, ToolPart } from "@opencode-ai/sdk/v2"

describe("message-part optimizations", () => {
  test("contextToolSummary counts tool parts correctly", () => {
    const parts = [
      { tool: "read" },
      { tool: "glob" },
      { tool: "grep" },
      { tool: "list" },
      { tool: "read" },
      { tool: "other" },
    ] as unknown as ToolPart[]

    const summary = contextToolSummary(parts)
    expect(summary).toEqual({
      read: 2,
      search: 2,
      list: 1,
    })
  })

  test("findLastTextPart finds the last text part", () => {
    const parts = [
      { id: "1", type: "text", text: "first text" },
      { id: "2", type: "file" },
      { id: "3", type: "text", text: "last text" },
      { id: "4", type: "text", text: " " }, // Empty text part
      { id: "5", type: "file" },
    ] as unknown as Part[]

    expect(findLastTextPart(parts, "3")).toBe(true)
    expect(findLastTextPart(parts, "1")).toBe(false)
    expect(findLastTextPart(parts, "4")).toBe(false)
  })

  test("findLastTextPart handles empty array", () => {
    expect(findLastTextPart([], "1")).toBe(false)
  })
})

import { parseUserMessageParts } from "./message-part-utils"
import type { AgentPart, FilePart } from "@opencode-ai/sdk/v2"

describe("parseUserMessageParts", () => {
  test("categorizes parts into files, attachments, inlineFiles, and agents", () => {
    const parts = [
      { id: "1", type: "file", mime: "text/plain", url: "file:///README.md" },
      { id: "2", type: "file", mime: "image/png", url: "data:image/png;base64,123" }, // attachment
      { id: "3", type: "agent", agentID: "agent1" },
      { id: "4", type: "file", mime: "text/plain", url: "file:///foo.ts", source: { text: { start: 0, end: 1 } } }, // inline
      { id: "5", type: "text", text: "hello" },
    ] as Part[]

    const parsed = parseUserMessageParts(parts)
    expect(parsed.files).toHaveLength(3)
    expect(parsed.files[0].id).toBe("1")
    expect(parsed.files[1].id).toBe("2")
    expect(parsed.files[2].id).toBe("4")

    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0].id).toBe("2")

    expect(parsed.inlineFiles).toHaveLength(1)
    expect(parsed.inlineFiles[0].id).toBe("4")

    expect(parsed.agents).toHaveLength(1)
    expect(parsed.agents[0].id).toBe("3")
  })

  test("handles empty or missing parts gracefully", () => {
    const parsed1 = parseUserMessageParts([])
    expect(parsed1).toEqual({ files: [], attachments: [], inlineFiles: [], agents: [] })

    const parsed2 = parseUserMessageParts(undefined as any)
    expect(parsed2).toEqual({ files: [], attachments: [], inlineFiles: [], agents: [] })
  })
})
