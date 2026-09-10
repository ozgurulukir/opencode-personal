import { describe, expect, test } from "bun:test"
import { latestAssistantUsage, totalAssistantCost, type UsageProvider } from "../../../../src/cli/cmd/tui/context-usage.shared"
import type { SessionMessage, SessionMessageAssistant, SessionMessageUser } from "@opencode-ai/sdk/v2"

// The TUI message store (`sync.data.messages`) is ordered NEWEST-FIRST: the
// server returns `desc(time_created), desc(id)` and live events prepend with
// `unshift`. Regression guard: the context meters (footer, sidebar,
// subagent-footer) must report the LATEST completed assistant turn. A prior
// bug used `findLast`, which walks from the end and picked the OLDEST
// completed assistant — freezing the displayed value. These tests lock the
// newest-first sort contract.

function assistant(partial: Partial<SessionMessageAssistant> = {}): SessionMessageAssistant {
  return {
    id: "asst-1",
    type: "assistant",
    agent: "build",
    model: { id: "claude-3-5-sonnet", providerID: "anthropic", variant: "primary" },
    time: { created: 1000 },
    content: [],
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    ...partial,
  }
}

function user(text: string): SessionMessageUser {
  return {
    id: "user-1",
    type: "user",
    agent: "build",
    model: { id: "claude-3-5-sonnet", providerID: "anthropic", variant: "primary" },
    time: { created: 900 },
    text,
  }
}

const provider: UsageProvider = {
  id: "anthropic",
  models: { "claude-3-5-sonnet": { limit: { context: 200000 } } },
}

describe("latestAssistantUsage", () => {
  test("returns undefined when there are no messages", () => {
    expect(latestAssistantUsage([], [provider])).toBeUndefined()
  })

  test("returns undefined when no assistant has output tokens", () => {
    const messages = [user("hello"), assistant({ time: { created: 1000 } })]
    expect(latestAssistantUsage(messages, [provider])).toBeUndefined()
  })

  test("ignores in-progress assistant turns (no output yet) in favor of a completed one", () => {
    const messages = [
      assistant({ id: "fresh", time: { created: 1200 }, tokens: undefined }), // newest, still streaming
      assistant({
        id: "completed",
        time: { created: 1100, completed: 1100 },
        tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
      }),
    ]
    const result = latestAssistantUsage(messages, [provider])
    expect(result).toEqual({ tokens: 100 + 50 + 10 + 20 + 5, percent: Math.round((185 / 200000) * 100) })
  })

  test("picks the LATEST completed assistant in a newest-first list (the regression)", () => {
    // Newest-first ordering: the freshest completed turn is at index 0.
    const messages = [
      assistant({
        id: "newest",
        time: { created: 2000, completed: 2000 },
        tokens: { input: 1000, output: 500, reasoning: 100, cache: { read: 200, write: 50 } },
      }),
      assistant({
        id: "oldest",
        time: { created: 1000, completed: 1000 },
        tokens: { input: 10, output: 5, reasoning: 1, cache: { read: 2, write: 1 } },
      }),
    ]
    const result = latestAssistantUsage(messages, [provider])
    // Must reflect `newest`, not `oldest`. `findLast` would return `oldest`
    // (19 tokens) — this assertion fails under the old broken implementation.
    expect(result?.tokens).toBe(1000 + 500 + 100 + 200 + 50)
  })

  test("returns the latest assistant even when a newer user message sits on top", () => {
    const messages = [
      user("followup"),
      assistant({
        time: { created: 1500, completed: 1500 },
        tokens: { input: 30, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
      }),
    ]
    expect(latestAssistantUsage(messages, [provider])?.tokens).toBe(50)
  })

  test("percent is null when the model is unknown", () => {
    const messages = [assistant({ tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } } })]
    expect(latestAssistantUsage(messages, [] as UsageProvider[])?.percent).toBeNull()
  })

  test("percent is null when the model has no context limit", () => {
    const messages = [assistant({ tokens: { input: 10, output: 10, reasoning: 0, cache: { read: 0, write: 0 } } })]
    const noLimit: UsageProvider = { id: "x", models: { foo: { limit: { context: 0 } } } }
    expect(latestAssistantUsage(messages, [noLimit])?.percent).toBeNull()
  })

  test("returns undefined when all completed assistants have zero total tokens", () => {
    const messages = [
      assistant({ time: { created: 1000, completed: 1000 }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ]
    expect(latestAssistantUsage(messages, [provider])).toBeUndefined()
  })
})

describe("totalAssistantCost", () => {
  test("sums assistant costs only, ignores user messages", () => {
    const messages = [
      user("hello"),
      assistant({ cost: 0.01 }),
      assistant({ cost: 0.02 }),
    ]
    expect(totalAssistantCost(messages)).toBeCloseTo(0.03)
  })

  test("returns 0 for a session with no assistant costs", () => {
    expect(totalAssistantCost([user("hello")])).toBe(0)
  })
})

