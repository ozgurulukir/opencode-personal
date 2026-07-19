import { describe, test, expect } from "bun:test"
import { Permission } from "../../src/permission"

describe("Permission.evaluateWithSource", () => {
  test("returns ask with no source when no match", () => {
    const result = Permission.evaluateWithSource("task", "code-reviewer", {
      source: "agent",
      rules: [],
    })
    expect(result.action).toBe("ask")
    expect(result.source).toBeUndefined()
  })

  test("returns matching rule with source label", () => {
    const result = Permission.evaluateWithSource("task", "code-reviewer", {
      source: "agent",
      rules: [{ permission: "task", pattern: "code-reviewer", action: "deny" }],
    })
    expect(result.action).toBe("deny")
    expect(result.source).toBe("agent")
  })

  test("last matching ruleset wins (source reflects winning ruleset)", () => {
    const result = Permission.evaluateWithSource("edit", "file.ts", {
      source: "agent",
      rules: [{ permission: "edit", pattern: "*", action: "deny" }],
    }, {
      source: "session",
      rules: [{ permission: "edit", pattern: "file.ts", action: "allow" }],
    })
    expect(result.action).toBe("allow")
    expect(result.source).toBe("session")
  })

  test("agent deny wins over session allow when agent comes last", () => {
    const result = Permission.evaluateWithSource("edit", "file.ts", {
      source: "session",
      rules: [{ permission: "edit", pattern: "file.ts", action: "allow" }],
    }, {
      source: "agent",
      rules: [{ permission: "edit", pattern: "*", action: "deny" }],
    })
    expect(result.action).toBe("deny")
    expect(result.source).toBe("agent")
  })

  test("multiple rulesets with no match returns ask", () => {
    const result = Permission.evaluateWithSource("task", "unknown", {
      source: "agent",
      rules: [{ permission: "task", pattern: "code-reviewer", action: "deny" }],
    }, {
      source: "session",
      rules: [{ permission: "task", pattern: "general", action: "allow" }],
    })
    expect(result.action).toBe("ask")
    expect(result.source).toBeUndefined()
  })

  test("empty rulesets returns ask", () => {
    const result = Permission.evaluateWithSource("task", "anything")
    expect(result.action).toBe("ask")
    expect(result.source).toBeUndefined()
  })
})
