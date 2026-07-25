import { describe, expect, test } from "bun:test"
import { getUsage } from "@/session/session"
import type { LanguageModelUsage } from "ai"
import type { ProviderMetadata } from "ai"

// Helper to build minimal usage object
const usage = (overrides: Partial<LanguageModelUsage> = {}): LanguageModelUsage => ({
  inputTokens: 1000,
  outputTokens: 500,
  totalTokens: 2000,
  inputTokenDetails: { noCacheTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokenDetails: { textTokens: 500, reasoningTokens: 0 },
  ...overrides,
})

describe("getUsage — characterization", () => {
  test("basic usage without metadata", () => {
    const result = getUsage({
      model: { cost: { input: 3, output: 15 } } as any,
      usage: usage(),
    })
    expect(result.tokens.total).toBe(2000)
    expect(result.tokens.input).toBe(1000)
    expect(result.tokens.output).toBe(500)
    expect(result.tokens.reasoning).toBe(0)
    expect(result.cost).toBeGreaterThan(0)
  })

  test("handles non-finite values as zero", () => {
    const result = getUsage({
      model: { cost: { input: 3, output: 15 } } as any,
      usage: usage({
        inputTokens: NaN,
        outputTokens: Infinity,
        totalTokens: NaN,
      }),
    })
    expect(result.tokens.input).toBe(0)
    expect(result.tokens.output).toBe(0)
    // Note: totalTokens is NOT sanitized through safe(), it passes through raw
    expect(result.tokens.total).toBeNaN()
  })

  test("reasoning tokens extracted from outputTokenDetails", () => {
    const result = getUsage({
      model: { cost: { input: 3, output: 15 } } as any,
      usage: usage({
        outputTokenDetails: { textTokens: 300, reasoningTokens: 200 },
      }),
    })
    expect(result.tokens.reasoning).toBe(200)
    expect(result.tokens.output).toBe(300) // 500 - 200
  })

  test("cache tokens subtracted from input", () => {
    const result = getUsage({
      model: { cost: { input: 3, output: 15 } } as any,
      usage: usage({
        inputTokenDetails: { noCacheTokens: 850, cacheReadTokens: 100, cacheWriteTokens: 50 },
      }),
    })
    expect(result.tokens.input).toBe(850) // 1000 - 100 - 50
    expect(result.tokens.cache.read).toBe(100)
    expect(result.tokens.cache.write).toBe(50)
  })

  test("anthropic metadata parsed when cacheWriteTokens is absent", () => {
    const result = getUsage({
      model: { cost: { input: 3, output: 15 } } as any,
      usage: usage({
        inputTokenDetails: { noCacheTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
      metadata: { anthropic: { cacheCreationInputTokens: 75 } } as any,
    })
    // cacheWriteTokens is 0, so the ?? chain reaches anthropic metadata
    expect(result.tokens.cache.write).toBe(75)
  })

  test("over200K pricing triggers when input + cache > 200000", () => {
    const result = getUsage({
      model: {
        cost: {
          input: 3,
          output: 15,
          experimentalOver200K: { input: 6, output: 30 },
        },
      } as any,
      usage: usage({
        inputTokens: 150000,
        inputTokenDetails: { noCacheTokens: 80000, cacheReadTokens: 60000, cacheWriteTokens: 0 },
      }),
    })
    // cacheWriteTokens is undefined, so adjustedInputTokens = 150000 - 60000 - 0 = 90000
    expect(result.tokens.input).toBe(90000)
    expect(result.cost).toBeGreaterThan(0)
  })
})
