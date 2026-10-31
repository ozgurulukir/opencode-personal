import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { MessageID } from "./schema"
import { MessageV2 } from "./message-v2"
import * as ContextBudget from "./context-budget"

export type CompactionReason = "threshold" | "provider-rejected"

/**
 * Compaction trigger policy — the single authority for "should this turn
 * auto-compact". Pure functions, no Effects and no IO, so the decision is
 * testable directly instead of being re-implemented in tests or inlined
 * across the run loop and the stream processor. Call sites adapt their own
 * context onto these inputs.
 */

/**
 * Whether the current turn is the synthetic "Continue" message a completed
 * auto-compaction injects. The threshold site skips such turns so a
 * just-finished compaction cannot immediately re-trigger (the
 * double-compaction bug class; see `MessageV2.latest`).
 */
export function isCurrentTurnContinue(msgs: MessageV2.WithParts[], userID: MessageID): boolean {
  const userMsg = msgs.findLast((m) => m.info.id === userID)
  return userMsg?.parts.some((p) => p.type === "text" && p.metadata?.compaction_continue) ?? false
}

/**
 * Auto-compaction decision for a finished assistant turn. Summary turns
 * never trigger (their output IS the compaction), continue turns are guarded
 * against re-triggering, and the budget math itself (auto gate, reserved
 * floor, zero-context guards) lives in `ContextBudget.isOverflow`.
 */
export function shouldCompactAfterTurn(input: {
  cfg: Config.Info
  model: Provider.Model
  tokens: MessageV2.Assistant["tokens"]
  summary: boolean
  continueTurn: boolean
}): boolean {
  if (input.summary) return false
  if (input.continueTurn) return false
  return ContextBudget.isOverflow(input.cfg, input.tokens, input.model)
}

/** Reflects pruned token counts on the finished turn before the overflow check. */
export function adjustTokensAfterPrune(
  tokens: MessageV2.Assistant["tokens"],
  pruned: number,
): MessageV2.Assistant["tokens"] {
  return {
    ...tokens,
    input: Math.max(0, tokens.input - pruned),
    ...(tokens.total !== undefined ? { total: Math.max(0, tokens.total - pruned) } : {}),
  }
}

/**
 * Auto-compaction circuit breaker: stop after this many consecutive
 * auto-compactions that still leave the context overflowing — the configured
 * limits cannot fit the session and retrying would loop forever.
 */
export const BREAKER_LIMIT = 2
export const BREAKER_MESSAGE =
  "Context still exceeds the limit after compaction. Raise compaction.context_limit or lower reserved."
export function breakerTripped(consecutiveAutoCompactions: number): boolean {
  return consecutiveAutoCompactions >= BREAKER_LIMIT
}
