import { describe, expect, test } from "bun:test"
import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { compactionConfig, isOverflow, usableWith, DEFAULTS } from "../../src/session/context-budget"

function createModel(opts: {
  context: number
  output: number
  input?: number
}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
  } as Provider.Model
}

describe("ContextBudget.usableWith", () => {
  test("table-driven reserve and base calculation across branches (#328)", () => {
    // 1. Standard model without context_limit or limit.input
    // context: 200K, output: 32K -> reserve = max(20K, 32K) = 32K -> usable = 168K
    const standardModel = createModel({ context: 200_000, output: 32_000 })
    expect(usableWith({}, standardModel, compactionConfig({}))).toBe(168_000)

    // User-set reserved is honored in standard model (previously ignored!)
    const reservedCfg: Config.Info = { compaction: { reserved: 50_000 } }
    expect(usableWith(reservedCfg, standardModel, compactionConfig(reservedCfg))).toBe(150_000)

    // User-set reserved is floored at maxOutputTokens across all branches
    const smallReservedCfg: Config.Info = { compaction: { reserved: 10_000 } }
    expect(usableWith(smallReservedCfg, standardModel, compactionConfig(smallReservedCfg))).toBe(168_000)

    // 2. Model with limit.input (maxOutputTokens capped at OUTPUT_TOKEN_MAX 32K -> reserve = 32K)
    const inputModel = createModel({ context: 400_000, input: 272_000, output: 128_000 })
    expect(usableWith({}, inputModel, compactionConfig({}))).toBe(240_000) // 272K - 32K = 240K

    // 3. context_limit set below context
    const ctxLimitCfg: Config.Info = { compaction: { context_limit: 100_000 } }
    expect(usableWith(ctxLimitCfg, standardModel, compactionConfig(ctxLimitCfg))).toBe(68_000) // 100K - 32K = 68K

    // 4. context_limit set ABOVE model.limit.context is clamped to model.limit.context
    const excessiveLimitCfg: Config.Info = { compaction: { context_limit: 300_000 } }
    expect(usableWith(excessiveLimitCfg, standardModel, compactionConfig(excessiveLimitCfg))).toBe(168_000) // clamped to 200K - 32K = 168K
  })

  test("usable is 0 when context is smaller than output reserve (#327)", () => {
    const tightModel = createModel({ context: 16_000, output: 0 }) // output: 0 falls back to 32K
    expect(usableWith({}, tightModel, compactionConfig({}))).toBe(0)
  })
})

describe("ContextBudget.isOverflow", () => {
  test("returns false when usable context is 0 (#327)", () => {
    const tightModel = createModel({ context: 16_000, output: 0 })
    const tokens = { input: 10_000, output: 1_000, reasoning: 0, cache: { read: 0, write: 0 } }
    expect(isOverflow({}, tokens, tightModel)).toBe(false)
  })

  test("returns false when model.limit.context is 0 and no context_limit is set", () => {
    const zeroModel = createModel({ context: 0, output: 32_000 })
    const tokens = { input: 10_000, output: 1_000, reasoning: 0, cache: { read: 0, write: 0 } }
    expect(isOverflow({}, tokens, zeroModel)).toBe(false)
  })

  test("returns true when used tokens exceed usable window", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const tokens = { input: 70_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } } // 75K > 68K
    expect(isOverflow({}, tokens, model)).toBe(true)
  })
})
