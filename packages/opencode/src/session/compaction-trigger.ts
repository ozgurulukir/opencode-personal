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
 * Marker metadata the completed auto-compaction writes on its synthetic
 * "Continue" user text part. Single source of truth for both the writer
 * (compaction.ts) and the readers (the guards below) — the double-compaction
 * bug class was caused by these drifting apart. Deliberately structural: the
 * part's `synthetic` flag (checked separately by e.g. the copilot plugin
 * reader) and other part details are NOT part of this contract.
 */
export const COMPACTION_CONTINUE_METADATA = { compaction_continue: true } as const

/**
 * Whether a part is the synthetic "Continue" marker a completed
 * auto-compaction injects. Kept structural (not `MessageV2`-typed) so both
 * server-side guards and SDK-shaped consumers can reuse it; the synthetic
 * check is a separate concern left to each reader.
 */
export function isCompactionContinuePart(p: { type: string; metadata?: { compaction_continue?: boolean } }): boolean {
  return p.type === "text" && p.metadata?.compaction_continue === true
}

/**
 * Whether the current turn is the synthetic "Continue" message a completed
 * auto-compaction injects. The threshold site skips such turns so a
 * just-finished compaction cannot immediately re-trigger (the
 * double-compaction bug class; see `MessageV2.latest`).
 */
export function isCurrentTurnContinue(msgs: MessageV2.WithParts[], userID: MessageID): boolean {
  const userMsg = msgs.findLast((m) => m.info.id === userID)
  return userMsg?.parts.some(isCompactionContinuePart) ?? false
}

/**
 * Auto-compaction decision for a finished assistant turn. Summary turns
 * never trigger (their output IS the compaction), continue turns are guarded
 * against re-triggering, and the budget math itself (auto gate, reserved
 * floor, zero-context guards) lives in `ContextBudget.overflowDetail`.
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
  const detail = ContextBudget.overflowDetail(input.cfg, input.tokens, input.model)
  if (!detail.overflow) warnZeroBudget(detail, input.model)
  return detail.overflow
}

/**
 * Warn-once diagnostic relocated from the shared budget module (which stays
 * dependency-pure for the SDK). `overflowDetail`'s reason replaces the guards
 * this function used to re-implement: warn only when the reason is
 * "zero-usable" — auto-off ("auto-compaction disabled" would only echo the
 * user's own setting) and zero-context (nothing is broken) stay silent, and a
 * healthy budget ("under-budget" / "threshold") is not a diagnostic.
 */
function warnZeroBudget(detail: ContextBudget.OverflowDetail, model: Provider.Model) {
  if (detail.reason !== "zero-usable") return
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
