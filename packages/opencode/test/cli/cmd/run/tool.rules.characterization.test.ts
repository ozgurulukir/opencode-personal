import { describe, expect, it } from "bun:test"
import { scrollTodoFinal } from "../../../../src/cli/cmd/run/tool.rules"
import type { ToolProps } from "../../../../src/cli/cmd/run/tool.types"
import type { TodoWriteTool } from "../../../../src/tool/todo"

function mockProps(todos: Array<{ status?: string }>, hasTime?: boolean): ToolProps<typeof TodoWriteTool> {
  let time: any = {}

  if (hasTime) {
      const end = Date.now()
      const start = end - 1000 // 1s
      time = { start, end }
  }

  return {
    input: { todos },
    frame: { state: { time } } as any,
  } as any
}

describe("scrollTodoFinal", () => {
  it("handles empty list", () => {
    expect(scrollTodoFinal(mockProps([]))).toBe("0 todos")
    expect(scrollTodoFinal(mockProps([], true))).toMatch(/0 todos · 1\.0s/)
  })

  it("handles all completed", () => {
    const props = mockProps([
      { status: "completed" },
      { status: "completed" },
    ])
    expect(scrollTodoFinal(props)).toBe("2 total · 2 done")
    expect(scrollTodoFinal(mockProps([{ status: "completed" }], true))).toMatch(/1 total · 1 done · 1\.0s/)
  })

  it("handles mixed statuses", () => {
    const props = mockProps([
      { status: "completed" },
      { status: "in_progress" },
      { status: "in_progress" },
      { status: "cancelled" },
      { status: "cancelled" },
      { status: "cancelled" },
      { status: "pending" }, // left over
      { status: "pending" }, // left over
      { status: "pending" }, // left over
      { status: "pending" }, // left over
    ])
    expect(scrollTodoFinal(props)).toBe("10 total · 1 done · 2 active · 3 cancelled · 4 pending")
  })
})
