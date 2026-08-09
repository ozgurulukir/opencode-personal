import { describe, expect, test } from "bun:test"
import { agentColor, messageAgentColor } from "./agent"

describe("agentColor", () => {
  test("returns custom color if provided", () => {
    expect(agentColor("ask", "#ff0000")).toBe("#ff0000")
    expect(agentColor("unknown", "#00ff00")).toBe("#00ff00")
  })

  test("returns default color for known agents", () => {
    expect(agentColor("ask")).toBe("var(--icon-agent-ask-base)")
    expect(agentColor("build")).toBe("var(--icon-agent-build-base)")
    expect(agentColor("docs")).toBe("var(--icon-agent-docs-base)")
    expect(agentColor("plan")).toBe("var(--icon-agent-plan-base)")
  })

  test("returns default color for known agents (case-insensitive)", () => {
    expect(agentColor("Ask")).toBe("var(--icon-agent-ask-base)")
    expect(agentColor("BUILD")).toBe("var(--icon-agent-build-base)")
    expect(agentColor("Docs")).toBe("var(--icon-agent-docs-base)")
    expect(agentColor("Plan")).toBe("var(--icon-agent-plan-base)")
  })

  test("returns consistent deterministic hashed color for unknown agents", () => {
    const color1 = agentColor("reviewer")
    const color2 = agentColor("reviewer")
    expect(color1).toBe(color2)

    // Test case insensitivity for hashed colors
    const color3 = agentColor("Reviewer")
    expect(color1).toBe(color3)

    const color4 = agentColor("tester")
    // Should be from palette
    expect(color4.startsWith("var(")).toBe(true)
  })
})

describe("messageAgentColor", () => {
  const agents = [{ name: "ask", color: "#111111" }, { name: "build" }, { name: "reviewer", color: "#222222" }]

  test("returns undefined for empty or undefined list", () => {
    expect(messageAgentColor(undefined, agents)).toBeUndefined()
    expect(messageAgentColor([], agents)).toBeUndefined()
  })

  test("returns color for the last user message with an agent", () => {
    const list = [
      { role: "user", agent: "ask" },
      { role: "assistant" },
      { role: "user", agent: "reviewer" },
      { role: "assistant" },
    ]
    // The last user message has agent: "reviewer", custom color is "#222222"
    expect(messageAgentColor(list, agents)).toBe("#222222")
  })

  test("ignores non-user messages with agent", () => {
    const list = [
      { role: "user", agent: "ask" },
      { role: "assistant", agent: "reviewer" }, // Should be ignored
    ]
    // Should return "ask" custom color "#111111"
    expect(messageAgentColor(list, agents)).toBe("#111111")
  })

  test("falls back to default colors if agent doesn't have custom color", () => {
    const list = [{ role: "user", agent: "build" }]
    // "build" is in agents but has no color, falls back to agentColor
    expect(messageAgentColor(list, agents)).toBe("var(--icon-agent-build-base)")
  })

  test("falls back to hashed color if agent is not in the list", () => {
    const list = [{ role: "user", agent: "unknown" }]
    // "unknown" is not in agents, falls back to hashed color
    expect(messageAgentColor(list, agents)).toBe(agentColor("unknown"))
  })

  test("returns undefined if no user message has an agent", () => {
    const list = [{ role: "user" }, { role: "assistant", agent: "ask" }]
    expect(messageAgentColor(list, agents)).toBeUndefined()
  })
})
