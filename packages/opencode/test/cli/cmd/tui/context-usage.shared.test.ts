import { describe, expect, test } from "bun:test"
import { latestAssistantUsage, totalAssistantCost, type UsageConfig, type UsageProvider } from "../../../../src/cli/cmd/tui/context-usage.shared"
import { isOverflow, used as budgetUsed } from "@opencode-ai/sdk/v2/context-budget"
import type { SessionMessage, SessionMessageAssistant, SessionMessageUser } from "@opencode-ai/sdk/v2"

// The TUI message store (`sync.data.messages`) is ordered NEWEST-FIRST: the
// server returns `desc(id)` (ULIDs, so id order is time order) and live events prepend with
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

// 200K context / 32K output: reserved = max(20K default, 32K output) = 32K,
// usable = 168K. 100% on the meter == the auto-compaction threshold.
const provider: UsageProvider = {
  id: "anthropic",
  models: { "claude-3-5-sonnet": { limit: { context: 200000, output: 32000 } } },
}
const usable = 168000

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
    expect(result).toEqual({ tokens: 100 + 50 + 10 + 20 + 5, percent: 0 })
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

  test("numerator reconstructs the provider total (reasoning included, like the trigger)", () => {
    const withReasoning = [assistant({ tokens: { input: 100, output: 50, reasoning: 999, cache: { read: 0, write: 0 } } })]
    expect(latestAssistantUsage(withReasoning, [provider])?.tokens).toBe(100 + 50 + 999)
  })

  test("percent is measured against the usable budget, not the raw context window", () => {
    const half = usable / 2
    const messages = [assistant({ tokens: { input: half - 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } })]
    // 84K/168K = 50%, whereas the old raw-window math showed 84K/200K = 42%.
    expect(latestAssistantUsage(messages, [provider])?.percent).toBe(50)
  })

  test("compaction.context_limit moves the displayed percent with the trigger threshold", () => {
    const config: UsageConfig = { compaction: { context_limit: 100000 } }
    // usable = 100000 - 32000 = 68000; 34000 tokens = 50% (old display: 17% of the raw window).
    const messages = [assistant({ tokens: { input: 33999, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } })]
    expect(latestAssistantUsage(messages, [provider], config)?.percent).toBe(50)
  })

  test("compaction.reserved is honored as the headroom", () => {
    const config: UsageConfig = { compaction: { reserved: 40000 } }
    // usable = 200000 - 40000 = 160000; 80000 tokens = 50%.
    const messages = [assistant({ tokens: { input: 79999, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } })]
    expect(latestAssistantUsage(messages, [provider], config)?.percent).toBe(50)
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

describe("display percent agrees with the compaction trigger", () => {
  const cases: Array<{ used: number; limit?: number }> = [
    { used: usable - 1 },
    { used: usable },
    { used: usable + 1 },
    { used: usable * 2 },
    { used: 1 },
    { used: 34000, limit: 100000 },
    { used: 68000, limit: 100000 },
  ]

  for (const { used: tokens, limit } of cases) {
    test(`${tokens} tokens${limit ? ` with context_limit ${limit}` : ""}: percent >= 100 iff isOverflow`, () => {
      const config: UsageConfig | undefined = limit ? { compaction: { context_limit: limit } } : undefined
      const messages: SessionMessage[] = [
        assistant({ tokens: { input: tokens - 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } }),
      ]
      const percent = latestAssistantUsage(messages, [provider], config)?.percent
      const overflow = isOverflow(config ?? {}, { input: tokens, output: 0, cache: { read: 0, write: 0 } }, {
        id: "claude-3-5-sonnet",
        limit: { context: 200000, output: 32000 },
      })
      expect(percent).not.toBeNull()
      // Display percent rounds to the nearest integer, so it can read 100%
      // marginally below the exact threshold. The guaranteed invariant is
      // one-sided: overflow ⇒ meter reads >= 100%, no overflow ⇒ <= 100%.
      if (overflow) expect(percent!).toBeGreaterThanOrEqual(100)
      else expect(percent!).toBeLessThanOrEqual(100)
    })
  }

  test("numerator equals the trigger's total-based usage for the same turn (live-stream path)", () => {
    // The live MessageV2 turn carries `total` (getUsage populates it from the
    // provider), so the trigger's numerator is the total — which includes
    // reasoning. The display holds the V2 message shape (no `total`) and must
    // reconstruct that same number from the components.
    const base = { input: 80_000, output: 4_000, reasoning: 10_000, cache: { read: 60_000, write: 2_000 } }
    const total = 80_000 + 4_000 + 10_000 + 60_000 + 2_000
    const display = latestAssistantUsage([assistant({ tokens: base })], [provider])
    const trigger = budgetUsed({ ...base, total })
    expect(display?.tokens).toBe(trigger)
    expect(display?.tokens).toBe(156_000)
  })

  test("reasoning-heavy turn: the meter reads 100% exactly when the trigger fires", () => {
    // Regression guard for the excluded-reasoning divergence: with reasoning
    // dropped from the numerator, a turn whose total reaches the usable
    // window showed ~88% on the meter while compaction fired.
    const tokens = { input: 146_000, output: 2_000, reasoning: 20_000, cache: { read: 0, write: 0 } }
    const display = latestAssistantUsage([assistant({ tokens })], [provider])
    expect(display?.percent).toBeGreaterThanOrEqual(100)
    expect(
      isOverflow({}, { ...tokens, total: 168_000 }, { id: "claude-3-5-sonnet", limit: { context: 200_000, output: 32_000 } }),
    ).toBe(true)
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
