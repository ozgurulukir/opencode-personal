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
