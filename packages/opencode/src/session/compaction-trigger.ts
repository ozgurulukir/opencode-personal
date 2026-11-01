import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { MessageID } from "./schema"
import { MessageV2 } from "./message-v2"
import * as ContextBudget from "@opencode-ai/sdk/v2/context-budget"
import { Log } from "@opencode-ai/core/util/log"

export type CompactionReason = "threshold" | "provider-rejected"

const log = Log.create({ service: "session.compaction-trigger" })
const warnedModels = new Set<string>()

/**
 * Compaction trigger policy — the single authority for "should this turn
 * auto-compact". No Effects; the only side effect is the warn-once
 * zero-budget diagnostic (module-level `warnedModels` + `Log`), so the
 * decision itself stays testable directly instead of being re-implemented in
 * tests or inlined across the run loop and the stream processor. Call sites
 * adapt their own context onto these inputs.
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
  const overflow = ContextBudget.isOverflow(input.cfg, input.tokens, input.model)
  if (!overflow) warnZeroBudget(input.cfg, input.model)
  return overflow
}

/**
 * Warn-once diagnostic relocated from the shared budget module (which stays
 * dependency-pure for the SDK). `isOverflow` collapses "no overflow" and
 * "broken budget" into the same `false`; surface the broken-budget case when
 * the trigger actually consults it. The early-return guards mirror
 * `isOverflow`'s so the warning fires in exactly the cases the old in-module
 * warn did.
 */
function warnZeroBudget(cfg: Config.Info, model: Provider.Model) {
  const cc = ContextBudget.compactionConfig(cfg)
  if (!cc.auto) return
  if (model.limit.context === 0 && !cc.contextLimit) return
  if (ContextBudget.usable(cfg, model) > 0) return
  const key = model.id ?? "unknown"
  if (warnedModels.has(key)) return
  warnedModels.add(key)
  log.warn("Usable context window is zero or negative; auto-compaction disabled for model", {
    model: key,
    context: model.limit.context,
  })
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
