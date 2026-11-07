import { describe, expect, test } from "bun:test"
import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import {
  compactionConfig,
  isOverflow,
  usableWith,
  DEFAULTS,
  overflowDetail,
  preserveRecentBudget,
  summaryBudget,
  used,
  usedFromBreakdown,
  usagePercent,
} from "@opencode-ai/sdk/v2/context-budget"

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

describe("ContextBudget.overflowDetail", () => {
  const tokens = { input: 70_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }

  test("reason 'auto-off' when compaction.auto is disabled — wins over the zero-context guard", () => {
    const cfg = { compaction: { auto: false } }
    // context 0 would be 'zero-context' if auto were on; the auto gate branches first
    expect(overflowDetail(cfg, tokens, createModel({ context: 0, output: 32_000 }))).toEqual({
      overflow: false,
      reason: "auto-off",
    })
  })

  test("reason 'zero-context' when model.limit.context is 0 and no context_limit is set", () => {
    expect(overflowDetail({}, tokens, createModel({ context: 0, output: 32_000 }))).toEqual({
      overflow: false,
      reason: "zero-context",
    })
  })

  test("reason 'zero-context' does not apply when context_limit is explicitly set", () => {
    // context_limit replaces model.limit.context as the threshold base: usable = 50K - 32K = 18K
    const cfg = { compaction: { context_limit: 50_000 } }
    expect(overflowDetail(cfg, tokens, createModel({ context: 0, output: 32_000 }))).toEqual({
      overflow: true,
      reason: "threshold",
    })
  })

  test("reason 'zero-usable' when the usable window is zero or negative", () => {
    // context 16K <= 32K output reserve -> usable 0 -> can never overflow
    expect(overflowDetail({}, tokens, createModel({ context: 16_000, output: 0 }))).toEqual({
      overflow: false,
      reason: "zero-usable",
    })
  })

  test("reason 'threshold' when used tokens reach the usable window", () => {
    // used = 75K >= usable = 100K - 32K = 68K
    expect(overflowDetail({}, tokens, createModel({ context: 100_000, output: 32_000 }))).toEqual({
      overflow: true,
      reason: "threshold",
    })
  })

  test("reason 'under-budget' when used tokens stay below the window", () => {
    expect(overflowDetail({}, tokens, createModel({ context: 200_000, output: 32_000 }))).toEqual({
      overflow: false,
      reason: "under-budget",
    })
  })

  test("overflow boolean matches isOverflow for the same input", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    expect(overflowDetail({}, tokens, model).overflow).toBe(isOverflow({}, tokens, model))
  })
})

describe("ContextBudget.usedFromBreakdown", () => {
  test("sums all components including reasoning and cache read/write", () => {
    const tokens = { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } }
    expect(usedFromBreakdown(tokens)).toBe(185)
  })

  test("defaults missing fields to zero", () => {
    expect(usedFromBreakdown({ input: 100, output: 50 })).toBe(150)
    expect(usedFromBreakdown({ input: 100, output: 50, cache: { read: 20 } })).toBe(170)
  })

  test("empty breakdown sums to zero", () => {
    expect(usedFromBreakdown({})).toBe(0)
  })

  test("diverges from used(): reasoning is included here but excluded by the no-total fallback", () => {
    // used() excludes reasoning because the server's getUsage already subtracts
    // it from output; usedFromBreakdown callers pass output that still excludes it
    const tokens = { input: 100, output: 50, reasoning: 10, cache: { read: 0, write: 0 } }
    expect(usedFromBreakdown(tokens)).toBe(160)
    expect(used(tokens)).toBe(150)
  })
})

describe("ContextBudget.usagePercent", () => {
  test("rounds the used/usable ratio to an integer percent", () => {
    expect(usagePercent({ input: 100, output: 50 }, 300)).toBe(50)
    // 2/3 = 66.67 -> 67
    expect(usagePercent({ input: 2, output: 0 }, 3)).toBe(67)
  })

  test("includes reasoning and cache in the numerator", () => {
    expect(usagePercent({ input: 100, reasoning: 10, cache: { read: 20, write: 5 } }, 270)).toBe(50)
  })

  test("returns null when usable is zero or negative", () => {
    expect(usagePercent({ input: 100 }, 0)).toBeNull()
    expect(usagePercent({ input: 100 }, -5)).toBeNull()
  })
})

describe("ContextBudget.preserveRecentBudget", () => {
  test("window-scaled quarter of usable wins over the max guardrail", () => {
    // usable = 100K - 32K = 68K; floor(68K * 0.25) = 17K — above maxPreserveRecentTokens (8K)
    const model = createModel({ context: 100_000, output: 32_000 })
    expect(preserveRecentBudget({ cfg: {}, model })).toBe(17_000)
  })

  test("mid-range scaling lands between the min and max guardrails", () => {
    // usable = 40K - 20K = 20K; floor(20K * 0.25) = 5K — between 2K min and 8K max
    const model = createModel({ context: 40_000, output: 20_000 })
    expect(preserveRecentBudget({ cfg: {}, model })).toBe(5_000)
  })

  test("clamps up to minPreserveRecentTokens when the window is tiny", () => {
    // usable = max(0, 8K - 20K reserve) = 0 -> floor(0 * 0.25) = 0 -> min floor 2K
    const model = createModel({ context: 8_000, output: 1_000 })
    expect(preserveRecentBudget({ cfg: {}, model })).toBe(DEFAULTS.minPreserveRecentTokens)
  })

  test("explicit preserve_recent_tokens override wins untouched", () => {
    const cfg = { compaction: { preserve_recent_tokens: 500_000 } }
    const model = createModel({ context: 100_000, output: 32_000 })
    expect(preserveRecentBudget({ cfg, model })).toBe(500_000)
  })
})

describe("ContextBudget.summaryBudget", () => {
  test("summary_max_tokens override wins regardless of the model output cap", () => {
    const cc = compactionConfig({ compaction: { summary_max_tokens: 4_000 } })
    const bigModel = createModel({ context: 400_000, output: 128_000 })
    expect(summaryBudget(bigModel, cc)).toBe(4_000)
  })

  test("without override, the model output cap is floored by the 8K ceiling", () => {
    // maxOutputTokens = min(128K, 32K) = 32K -> min(32K, 8K) = 8K
    const cc = compactionConfig({})
    const bigModel = createModel({ context: 400_000, output: 128_000 })
    expect(summaryBudget(bigModel, cc)).toBe(DEFAULTS.maxSummaryTokens)
  })

  test("a small model output cap binds below the 8K ceiling", () => {
    // maxOutputTokens = min(4K, 32K) = 4K -> min(4K, 8K) = 4K
    const cc = compactionConfig({})
    const smallModel = createModel({ context: 100_000, output: 4_000 })
    expect(summaryBudget(smallModel, cc)).toBe(4_000)
  })
})
