import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { isOverflow } from "@opencode-ai/sdk/v2/context-budget"
import { getSessionContextMetrics } from "./session-context-metrics"

const assistant = (
  id: string,
  tokens: { input: number; output: number; reasoning: number; read: number; write: number },
  cost: number,
  providerID = "openai",
  modelID = "gpt-4.1",
) => {
  return {
    id,
    role: "assistant",
    providerID,
    modelID,
    cost,
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: {
        read: tokens.read,
        write: tokens.write,
      },
    },
    time: { created: 1 },
  } as unknown as Message
}

const user = (id: string) => {
  return {
    id,
    role: "user",
    cost: 0,
    time: { created: 1 },
  } as unknown as Message
}

describe("getSessionContextMetrics", () => {
  test("computes totals and usage from latest assistant with tokens", () => {
    const messages = [
      user("u1"),
      assistant("a1", { input: 0, output: 0, reasoning: 0, read: 0, write: 0 }, 0.5),
      assistant("a2", { input: 60_000, output: 10_000, reasoning: 9_000, read: 4_000, write: 1_000 }, 1.25),
    ]
    const providers = [
      {
        id: "openai",
        name: "OpenAI",
        models: {
          "gpt-4.1": {
            name: "GPT-4.1",
            limit: { context: 200_000, output: 32_000 },
          },
        },
      },
    ]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.totalCost).toBe(1.75)
    expect(metrics.context?.message.id).toBe("a2")
    expect(metrics.context?.total).toBe(84_000)
    expect(metrics.context?.usage).toBe(50)
    expect(metrics.context?.providerLabel).toBe("OpenAI")
    expect(metrics.context?.modelLabel).toBe("GPT-4.1")
  })

  test("preserves fallback labels and null usage when model metadata is missing", () => {
    const messages = [assistant("a1", { input: 40, output: 10, reasoning: 0, read: 0, write: 0 }, 0.1, "p-1", "m-1")]
    const providers = [{ id: "p-1", models: {} }]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.context?.providerLabel).toBe("p-1")
    expect(metrics.context?.modelLabel).toBe("m-1")
    expect(metrics.context?.limit).toBeUndefined()
    expect(metrics.context?.usage).toBeNull()
  })

  test("recomputes when message array is mutated in place", () => {
    const messages = [assistant("a1", { input: 10, output: 10, reasoning: 10, read: 10, write: 10 }, 0.25)]
    const providers = [{ id: "openai", models: {} }]

    const one = getSessionContextMetrics(messages, providers)
    messages.push(assistant("a2", { input: 100, output: 20, reasoning: 0, read: 0, write: 0 }, 0.75))
    const two = getSessionContextMetrics(messages, providers)

    expect(one.context?.message.id).toBe("a1")
    expect(two.context?.message.id).toBe("a2")
    expect(two.totalCost).toBe(1)
  })

  test("returns empty metrics when inputs are undefined", () => {
    const metrics = getSessionContextMetrics(undefined, undefined)

    expect(metrics.totalCost).toBe(0)
    expect(metrics.context).toBeUndefined()
  })

  test("usage divides by the compaction budget, not the raw context window", () => {
    // 200K context with a 32K output reserve -> 168K usable; 168K tokens
    // reads 100% (the old raw-window formula would have reported 84%).
    const messages = [assistant("a1", { input: 100_000, output: 20_000, reasoning: 30_000, read: 16_000, write: 2_000 }, 0.5)]
    const providers = [
      { id: "openai", models: { "gpt-4.1": { name: "GPT-4.1", limit: { context: 200_000, output: 32_000 } } } },
    ]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.context?.total).toBe(168_000)
    expect(metrics.context?.usage).toBe(100)
  })

  test("compaction.context_limit replaces the model window in the denominator", () => {
    const messages = [assistant("a1", { input: 60_000, output: 6_000, reasoning: 0, read: 2_000, write: 0 }, 0.5)]
    const providers = [
      { id: "openai", models: { "gpt-4.1": { name: "GPT-4.1", limit: { context: 200_000, output: 32_000 } } } },
    ]

    const metrics = getSessionContextMetrics(messages, providers, { compaction: { context_limit: 100_000 } })

    expect(metrics.context?.usage).toBe(100) // 68_000 tokens over the 68_000 usable window
  })

  test("unknown context window yields null usage", () => {
    const messages = [assistant("a1", { input: 500, output: 100, reasoning: 0, read: 0, write: 0 }, 0.1)]
    const providers = [{ id: "openai", models: { "gpt-4.1": { name: "GPT-4.1", limit: { context: 0 } } } }]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.context?.usage).toBeNull()
  })

  test("context smaller than the output reserve yields null usage", () => {
    // usable = max(0, 30_000 - 32_000) = 0 — the trigger can never fire for
    // this model, so there is no meaningful percent to show.
    const messages = [assistant("a1", { input: 200, output: 100, reasoning: 0, read: 0, write: 0 }, 0.1)]
    const providers = [
      { id: "openai", models: { "gpt-4.1": { name: "GPT-4.1", limit: { context: 30_000, output: 32_000 } } } },
    ]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.context?.usage).toBeNull()
  })

  test("usage can exceed 100 when tokens pass the budget", () => {
    const messages = [assistant("a1", { input: 200_000, output: 40_000, reasoning: 60_000, read: 32_000, write: 4_000 }, 0.5)]
    const providers = [
      { id: "openai", models: { "gpt-4.1": { name: "GPT-4.1", limit: { context: 200_000, output: 32_000 } } } },
    ]

    const metrics = getSessionContextMetrics(messages, providers)

    expect(metrics.context?.total).toBe(336_000)
    expect(metrics.context?.usage).toBe(200) // 336_000 over the 168_000 budget
  })

  test("app parity: meter percent agrees with the compaction trigger", () => {
    // Mirrors the TUI suite's "display percent agrees with the compaction
    // trigger" cases (context-usage.shared.test.ts): the meter divides by the
    // same usable() the trigger compares against. Rounding is one-sided:
    // overflow => percent >= 100, no overflow => percent <= 100.
    const cases = [167_999, 168_000, 168_001, 336_000]
    const providers = [
      { id: "openai", models: { "gpt-4.1": { name: "GPT-4.1", limit: { context: 200_000, output: 32_000 } } } },
    ]

    for (const tokens of cases) {
      const messages = [assistant("a1", { input: tokens - 1, output: 1, reasoning: 0, read: 0, write: 0 }, 0.5)]
      const percent = getSessionContextMetrics(messages, providers).context?.usage
      const overflow = isOverflow(
        {},
        { input: tokens, output: 0, cache: { read: 0, write: 0 } },
        { id: "gpt-4.1", limit: { context: 200_000, output: 32_000 } },
      )
      expect(percent).not.toBeNull()
      if (overflow) expect(percent!).toBeGreaterThanOrEqual(100)
      else expect(percent!).toBeLessThanOrEqual(100)
    }
  })
})
