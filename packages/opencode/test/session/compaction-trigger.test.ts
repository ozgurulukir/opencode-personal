import { describe, expect, test } from "bun:test"
import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import { MessageV2 } from "../../src/session/message-v2"
import type { MessageID, SessionID } from "../../src/session/schema"
import {
  adjustTokensAfterPrune,
  breakerTripped,
  BREAKER_LIMIT,
  BREAKER_MESSAGE,
  isCurrentTurnContinue,
  shouldCompactAfterTurn,
} from "../../src/session/compaction-trigger"

function createModel(opts: { context: number; output: number; input?: number }): Provider.Model {
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

// Test fixture: only the fields the trigger policy reads are populated.
function turn(userID: string, parts: unknown[]): MessageV2.WithParts {
  return {
    info: {
      id: userID as MessageID,
      role: "user",
      sessionID: "ses_test" as SessionID,
      agent: "build",
      model: { providerID: "test" as never, modelID: "test-model" as never },
      time: { created: 0 },
    },
    parts,
  } as unknown as MessageV2.WithParts
}

describe("CompactionTrigger.shouldCompactAfterTurn", () => {
  const tokens = { input: 75_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }

  test("returns true when used tokens exceed the usable window", () => {
    // used = 75K input + 5K output = 80K >= 100K - 32K = 68K
    const model = createModel({ context: 100_000, output: 32_000 })
    expect(shouldCompactAfterTurn({ cfg: {}, model, tokens, summary: false, continueTurn: false })).toBe(true)
  })

  test("returns false when used tokens are within the usable window", () => {
    const model = createModel({ context: 200_000, output: 32_000 })
    expect(shouldCompactAfterTurn({ cfg: {}, model, tokens, summary: false, continueTurn: false })).toBe(false)
  })

  test("reserves headroom when limit.input is set — compaction triggers near boundary", () => {
    // Simulate Claude with prompt caching: input limit = 200K, output limit = 32K.
    // used = 180K + 3K cache.read + 15K = 198K; usable = limit.input - output = 168K.
    // Related issues: #10634, #8089, #11086, #12621
    const model = createModel({ context: 200_000, input: 200_000, output: 32_000 })
    const nearBoundary = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }
    expect(shouldCompactAfterTurn({ cfg: {}, model, tokens: nearBoundary, summary: false, continueTurn: false })).toBe(
      true,
    )
  })

  test("symmetry — limit.input model triggers identically to an equivalent model without it", () => {
    const withInputLimit = createModel({ context: 200_000, input: 200_000, output: 32_000 })
    const withoutInputLimit = createModel({ context: 200_000, output: 32_000 })
    // 181K total (166K input + 5K cache.read + 10K output) — above context-output (168K), below the input limit (200K)
    const at181K = { input: 166_000, output: 10_000, reasoning: 0, cache: { read: 5_000, write: 0 } }
    const withLimit = shouldCompactAfterTurn({
      cfg: {},
      model: withInputLimit,
      tokens: at181K,
      summary: false,
      continueTurn: false,
    })
    const withoutLimit = shouldCompactAfterTurn({
      cfg: {},
      model: withoutInputLimit,
      tokens: at181K,
      summary: false,
      continueTurn: false,
    })
    // Both models have identical real capacity — they should agree
    expect(withLimit).toBe(true)
    expect(withoutLimit).toBe(true)
  })

  test("includes cache.read in the token count", () => {
    // usable = 100K - 32K = 68K; 60K + 5K = 65K stays under, +3K cache.read hits it
    const model = createModel({ context: 100_000, output: 32_000 })
    const withoutCache = { input: 60_000, output: 5_000, reasoning: 0, cache: { read: 0, write: 0 } }
    expect(shouldCompactAfterTurn({ cfg: {}, model, tokens: withoutCache, summary: false, continueTurn: false })).toBe(
      false,
    )
    const withCache = { input: 60_000, output: 5_000, reasoning: 0, cache: { read: 3_000, write: 0 } }
    expect(shouldCompactAfterTurn({ cfg: {}, model, tokens: withCache, summary: false, continueTurn: false })).toBe(true)
  })

  test("limit.input model stays quiet just below the boundary", () => {
    // usable = limit.input - output = 200K - 32K = 168K; 165K total stays under
    const model = createModel({ context: 200_000, input: 200_000, output: 32_000 })
    const justBelow = { input: 150_000, output: 10_000, reasoning: 0, cache: { read: 5_000, write: 0 } }
    expect(shouldCompactAfterTurn({ cfg: {}, model, tokens: justBelow, summary: false, continueTurn: false })).toBe(false)
  })

  test("returns false when model context limit is 0 and no context_limit is set", () => {
    const model = createModel({ context: 0, output: 32_000 })
    expect(shouldCompactAfterTurn({ cfg: {}, model, tokens, summary: false, continueTurn: false })).toBe(false)
  })

  test("returns false when usable context is 0 (tight model context <= output reserve)", () => {
    const model = createModel({ context: 16_000, output: 0 }) // output: 0 falls back to the 32K default
    const small = { input: 10_000, output: 1_000, reasoning: 0, cache: { read: 0, write: 0 } }
    expect(shouldCompactAfterTurn({ cfg: {}, model, tokens: small, summary: false, continueTurn: false })).toBe(false)
  })

  test("returns false when compaction.auto is disabled", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    const cfg = { compaction: { auto: false } } as Config.Info
    expect(shouldCompactAfterTurn({ cfg, model, tokens, summary: false, continueTurn: false })).toBe(false)
  })

  test("never triggers for summary turns, even when overflowing", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    expect(shouldCompactAfterTurn({ cfg: {}, model, tokens, summary: true, continueTurn: false })).toBe(false)
  })

  test("never triggers for continue turns, even when overflowing", () => {
    const model = createModel({ context: 100_000, output: 32_000 })
    expect(shouldCompactAfterTurn({ cfg: {}, model, tokens, summary: false, continueTurn: true })).toBe(false)
  })
})

describe("CompactionTrigger.isCurrentTurnContinue", () => {
  const continuePart = { type: "text", text: "Continue", metadata: { compaction_continue: true } }
  const plainPart = { type: "text", text: "hello" }

  test("true when the turn's user message carries compaction_continue metadata", () => {
    const msgs = [turn("msg_1", [plainPart]), turn("msg_2", [continuePart])]
    expect(isCurrentTurnContinue(msgs, "msg_2" as MessageID)).toBe(true)
  })

  test("false for a regular user turn", () => {
    const msgs = [turn("msg_1", [continuePart]), turn("msg_2", [plainPart])]
    expect(isCurrentTurnContinue(msgs, "msg_2" as MessageID)).toBe(false)
  })

  test("false when the user message is missing from the list", () => {
    expect(isCurrentTurnContinue([turn("msg_1", [plainPart])], "msg_9" as MessageID)).toBe(false)
  })
})

describe("CompactionTrigger.adjustTokensAfterPrune", () => {
  test("subtracts pruned tokens from input and total", () => {
    const adjusted = adjustTokensAfterPrune(
      { input: 90_000, output: 20_000, reasoning: 0, cache: { read: 0, write: 0 }, total: 110_000 },
      5_000,
    )
    expect(adjusted.input).toBe(85_000)
    expect(adjusted.total).toBe(105_000)
  })

  test("clamps at zero and leaves total absent when it was absent", () => {
    const adjusted = adjustTokensAfterPrune(
      { input: 1_000, output: 20_000, reasoning: 0, cache: { read: 0, write: 0 } },
      5_000,
    )
    expect(adjusted.input).toBe(0)
    expect(adjusted.total).toBeUndefined()
  })
})

describe("CompactionTrigger circuit breaker", () => {
  test("trips at 2 consecutive auto-compactions", () => {
    expect(BREAKER_LIMIT).toBe(2)
    expect(breakerTripped(0)).toBe(false)
    expect(breakerTripped(1)).toBe(false)
    expect(breakerTripped(2)).toBe(true)
    expect(breakerTripped(3)).toBe(true)
  })

  test("breaker message names the remediation", () => {
    expect(BREAKER_MESSAGE).toContain("Context still exceeds the limit after compaction")
    expect(BREAKER_MESSAGE).toContain("compaction.context_limit")
  })
})
