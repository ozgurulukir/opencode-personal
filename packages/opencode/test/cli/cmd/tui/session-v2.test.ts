import { describe, expect, test } from "bun:test"
import { formatSkillLabel } from "../../../../src/cli/cmd/tui/feature-plugins/system/skill-label.shared"

describe("formatSkillLabel", () => {
  test("renders names-only skill calls", () => {
    expect(formatSkillLabel({ names: ["alpha", "beta"] })).toBe('2 Skills: alpha, beta')
  })

  test("deduplicates name and names while preserving order", () => {
    expect(formatSkillLabel({ name: "alpha", names: ["alpha", "beta", "alpha"] })).toBe('2 Skills: alpha, beta')
  })

  test("keeps the single-skill and pending fallbacks", () => {
    expect(formatSkillLabel({ name: "alpha" })).toBe('Skill "alpha"')
    expect(formatSkillLabel({}, "loading input")).toBe('Skill "loading input"')
    expect(formatSkillLabel({})).toBe("Skill")
  })

  test("summarizes long skill lists", () => {
    expect(formatSkillLabel({ names: ["alpha", "beta", "gamma", "delta"] })).toBe("4 Skills: alpha, beta, gamma, +1")
  })
})
