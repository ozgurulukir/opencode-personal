import { describe, expect, test } from "bun:test"
import { subagentResultText, subagentTitle } from "../../src/agent/subagent-spawn"

describe("subagentResultText", () => {
  // Fallback strings are byte-identical to the ones previously inlined in V1
  // (`tool/task.ts`) and V2 (`v2/session.ts`) — tests match on them.
  test("no parts at all → 'Subagent produced no output parts.'", () => {
    expect(subagentResultText([])).toBe("Subagent produced no output parts.")
  })

  test("findLast picks the LAST text part among several", () => {
    const out = subagentResultText([
      { type: "text", text: "first" },
      { type: "reasoning", text: "thinking" },
      { type: "text", text: "final answer" },
    ])
    expect(out).toBe("final answer")
  })

  test("parts but no text part → 'Subagent completed without producing a text response.'", () => {
    expect(subagentResultText([{ type: "tool" }, { type: "tool" }])).toBe(
      "Subagent completed without producing a text response.",
    )
  })

  test("a non-text part's text field is ignored (e.g. reasoning parts carry text)", () => {
    const out = subagentResultText([
      { type: "reasoning", text: "internal monologue" },
      { type: "tool" },
    ])
    expect(out).toBe("Subagent completed without producing a text response.")
  })

  test("empty-string text falls back (|| semantics, not ??)", () => {
    expect(subagentResultText([{ type: "text", text: "" }])).toBe(
      "Subagent completed without producing a text response.",
    )
  })
})

describe("subagentTitle", () => {
  test("format matches the consumer regexes (/@(\\w+) subagent/, /\\s+\\(@[^)]+ subagent\\)$/)", () => {
    const title = subagentTitle("inspect bug", "general")
    expect(title).toBe("inspect bug (@general subagent)")
    expect(/@(\w+) subagent/.exec(title)?.[1]).toBe("general")
    expect(/\s+\(@[^)]+ subagent\)$/.test(title)).toBe(true)
  })
})
