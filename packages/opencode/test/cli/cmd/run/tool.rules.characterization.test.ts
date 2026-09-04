import { describe, expect, it } from "bun:test"
import { runSkill, scrollSkillStart, scrollTodoFinal } from "../../../../src/cli/cmd/run/tool.rules"
import type { ToolProps } from "../../../../src/cli/cmd/run/tool.types"
import type { SkillTool } from "../../../../src/tool/skill"
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

function skillProps(input: { name?: string; names?: string[] }): ToolProps<typeof SkillTool> {
  return { input } as ToolProps<typeof SkillTool>
}

describe("runSkill", () => {
  it("renders no names", () => {
    expect(runSkill(skillProps({}))).toEqual({ icon: "→", title: "Skill" })
  })

  it("renders a single name", () => {
    expect(runSkill(skillProps({ name: "alpha" }))).toEqual({ icon: "→", title: 'Skill "alpha"' })
  })

  it("joins multiple names with count and truncates past three", () => {
    expect(runSkill(skillProps({ names: ["alpha", "beta"] }))).toEqual({ icon: "→", title: "2 Skills: alpha, beta" })
    expect(runSkill(skillProps({ names: ["alpha", "beta", "gamma", "delta"] }))).toEqual({
      icon: "→",
      title: "4 Skills: alpha, beta, gamma, +1",
    })
  })

  it("deduplicates name and names", () => {
    expect(runSkill(skillProps({ name: "alpha", names: ["alpha", "beta"] }))).toEqual({
      icon: "→",
      title: "2 Skills: alpha, beta",
    })
  })
})

describe("scrollSkillStart", () => {
  it("renders no names", () => {
    expect(scrollSkillStart(skillProps({}))).toBe("→ Skill")
  })

  it("renders a single name", () => {
    expect(scrollSkillStart(skillProps({ name: "alpha" }))).toBe('→ Skill "alpha"')
  })

  it("uses the unified multi-name label format", () => {
    expect(scrollSkillStart(skillProps({ names: ["alpha", "beta"] }))).toBe("→ 2 Skills: alpha, beta")
    expect(scrollSkillStart(skillProps({ names: ["alpha", "beta", "gamma"] }))).toBe("→ 3 Skills: alpha, beta, gamma")
    expect(scrollSkillStart(skillProps({ names: ["alpha", "beta", "gamma", "delta"] }))).toBe(
      "→ 4 Skills: alpha, beta, gamma, +1",
    )
  })
})
