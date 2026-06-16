import { describe, expect, test } from "bun:test"
import { calculateCost, calculateOccurredCost } from "../../../../src/routes/zen/util/cost"

describe("calculateCost", () => {
  test("input and output cost: tokens * rate * 100", () => {
    const result = calculateCost({ cost: { input: 2, output: 3 } }, { inputTokens: 10, outputTokens: 20 })
    expect(result.inputCost).toBe(2_000)
    expect(result.outputCost).toBe(6_000)
    expect(result.totalCostInCent).toBe(8_000)
  })

  test("cost200K used when input + cache tokens > 200_000", () => {
    const result = calculateCost(
      { cost: { input: 1, output: 0 }, cost200K: { input: 0.5, output: 0 } },
      { inputTokens: 150_000, outputTokens: 0, cacheReadTokens: 60_001 },
    )
    expect(result.inputCost).toBe(7_500_000)
  })

  test("base cost used when input + cache tokens <= 200_000", () => {
    const result = calculateCost(
      { cost: { input: 1, output: 0 }, cost200K: { input: 0.5, output: 0 } },
      { inputTokens: 150_000, outputTokens: 0, cacheReadTokens: 50_000 },
    )
    expect(result.inputCost).toBe(15_000_000)
  })

  test("cacheRead cost included when rate and tokens present", () => {
    const result = calculateCost(
      { cost: { input: 1, output: 0, cacheRead: 0.25 } },
      { inputTokens: 100, outputTokens: 0, cacheReadTokens: 40 },
    )
    expect(result.cacheReadCost).toBe(1_000)
  })

  test("cacheRead omitted when model has no cacheRead rate", () => {
    const result = calculateCost(
      { cost: { input: 1, output: 0 } },
      { inputTokens: 100, outputTokens: 0, cacheReadTokens: 40 },
    )
    expect(result.cacheReadCost).toBeUndefined()
  })

  test("cacheWrite5m cost", () => {
    const result = calculateCost(
      { cost: { input: 1, output: 0, cacheWrite5m: 0.3 } },
      { inputTokens: 100, outputTokens: 0, cacheWrite5mTokens: 50 },
    )
    expect(result.cacheWrite5mCost).toBe(1_500)
  })

  test("total includes all defined cache costs", () => {
    const result = calculateCost(
      { cost: { input: 1, output: 2, cacheRead: 0.5, cacheWrite5m: 0.3, cacheWrite1h: 0.4 } },
      { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWrite5mTokens: 5, cacheWrite1hTokens: 2 },
    )
    expect(result.totalCostInCent).toBe(20_730)
  })
})

describe("calculateOccurredCost", () => {
  test("formats balance cost as fixed-8 decimal string", () => {
    expect(calculateOccurredCost("balance", { totalCostInCent: 12345, inputCost: 0, outputCost: 0 })).toBe(
      "123.45000000",
    )
    expect(calculateOccurredCost("balance", { totalCostInCent: 1, inputCost: 0, outputCost: 0 })).toBe("0.01000000")
  })

  test("returns zero for non-balance sources", () => {
    expect(calculateOccurredCost("subscription", { totalCostInCent: 123, inputCost: 0, outputCost: 0 })).toBe("0")
    expect(calculateOccurredCost("free", { totalCostInCent: 999, inputCost: 0, outputCost: 0 })).toBe("0")
    expect(calculateOccurredCost("anonymous", { totalCostInCent: 0, inputCost: 0, outputCost: 0 })).toBe("0")
    expect(calculateOccurredCost("lite", { totalCostInCent: 50, inputCost: 0, outputCost: 0 })).toBe("0")
  })
})
