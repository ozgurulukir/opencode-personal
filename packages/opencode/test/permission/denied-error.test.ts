import { describe, test, expect } from "bun:test"
import { Permission } from "../../src/permission"

describe("Permission.DeniedError source", () => {
  test("DeniedError without source omits source in message", () => {
    const err = new Permission.DeniedError({
      ruleset: [{ permission: "edit", pattern: "*", action: "deny" }],
    })
    expect(err.message).toContain("relevant rules")
    expect(err.message).not.toContain("(from")
    expect(err.source).toBeUndefined()
  })

  test("DeniedError with source includes source in message", () => {
    const err = new Permission.DeniedError({
      ruleset: [{ permission: "edit", pattern: "*", action: "deny" }],
      source: "agent",
    })
    expect(err.message).toContain("(from agent)")
    expect(err.source).toBe("agent")
  })

  test("DeniedError with session source", () => {
    const err = new Permission.DeniedError({
      ruleset: [{ permission: "task", pattern: "dangerous-agent", action: "deny" }],
      source: "session",
    })
    expect(err.message).toContain("(from session)")
    expect(err.source).toBe("session")
  })

  test("DeniedError is a tagged error", () => {
    const err = new Permission.DeniedError({
      ruleset: [],
      source: "agent",
    })
    expect(err._tag).toBe("PermissionDeniedError")
  })
})
