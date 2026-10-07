import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Info } from "@/config/agent"

describe("ConfigAgent Schema Normalization", () => {
  test("folds edit aliases in input order and lets explicit permission win", () => {
    const decoded = Schema.decodeSync(Info)({
      tools: { write: true, edit: false, patch: true, "mcp_*": false },
      permission: { edit: { "*.ts": "ask" } },
    })
    expect(decoded.permission).toEqual({ edit: { "*.ts": "ask" }, "mcp_*": "deny" })
    expect(Schema.decodeSync(Info)({ tools: { patch: true, write: false } }).permission).toEqual({ edit: "deny" })
  })

  test("translates maxSteps to steps", () => {
    const raw = {
      maxSteps: 100,
    }
    const decoded = Schema.decodeSync(Info)(raw)
    expect(decoded.steps).toBe(100)
  })

  test("translates tools boolean map to permission shape", () => {
    const raw = {
      tools: {
        write: true,
        bash: false,
        custom: true,
      },
    }
    const decoded = Schema.decodeSync(Info)(raw)
    expect(decoded.permission).toBeDefined()
    expect(decoded.permission?.edit).toBe("allow") // write collapses to edit
    expect(decoded.permission?.bash).toBe("deny")
    expect(decoded.permission?.custom).toBe("allow")
  })

  test("normalizes list-form tools from compatible agent frontmatter", () => {
    const decoded = Schema.decodeSync(Info)({
      tools: ["Read", "Write", "Bash"],
    })
    expect(decoded.tools).toEqual({ read: true, write: true, bash: true })
    expect(decoded.permission?.read).toBe("allow")
    expect(decoded.permission?.edit).toBe("allow")
    expect(decoded.permission?.bash).toBe("allow")
  })

  test("promotes unknown keys to options", () => {
    const raw = {
      unknownKey: "some-value",
      otherUnknown: 123,
    }
    const decoded = Schema.decodeSync(Info)(raw)
    expect(decoded.options).toBeDefined()
    expect(decoded.options?.unknownKey).toBe("some-value")
    expect(decoded.options?.otherUnknown).toBe(123)
  })

  test("preserves existing fields", () => {
    const raw = {
      name: "test-agent",
      model: "anthropic/claude-3-opus",
      steps: 42,
    }
    const decoded = Schema.decodeSync(Info)(raw)
    expect(decoded.name).toBe("test-agent")
    expect(decoded.model).toBe("anthropic/claude-3-opus")
    expect(decoded.steps).toBe(42)
  })
})
