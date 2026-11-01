import type { SessionMessage, SessionMessageAssistant } from "@opencode-ai/sdk/v2"
import { usable as budgetUsable, type BudgetModel } from "@/session/context-budget"

export type UsageProvider = {
  id: string
  models: Record<string, BudgetModel>
}

/** Config slice driving the compaction budget (subset of the SDK `Config.compaction` shape). */
export type UsageConfig = {
  compaction?: { reserved?: number; context_limit?: number }
}

/**
 * Computes token usage for the most recently completed assistant turn,
 * aligned with the auto-compaction trigger. The numerator reconstructs the
 * trigger's effective usage — `ContextBudget.used()` prefers the provider
 * `total`, which includes reasoning. The V2 message shape carries no
 * `total`, but `getUsage` breaks cache and reasoning out of input/output, so
 * the component sum equals the total. The denominator is
 * `ContextBudget.usable()` — the same budget window the trigger compares
 * against. 100% means compaction is imminent.
 *
 * The TUI message store (`sync.data.messages`) is ordered **newest-first**:
 * the server returns `desc(id)` (ids are time-ordered, so id order is
 * creation order) and live events prepend with `unshift`. So the "latest"
 * assistant is the FIRST `find` match, not the last. Using `findLast` here
 * silently pinned the value to the oldest completed turn (see footer/sidebar
 * context bug), so this module is the single authority that encodes the sort
 * contract.
 */
export function latestAssistantUsage(
  messages: ReadonlyArray<SessionMessage>,
  providers: ReadonlyArray<UsageProvider>,
  config?: UsageConfig,
): { tokens: number; percent: number | null } | undefined {
  // `find` scans from index 0 = the newest entry in a newest-first store.
  const latest = messages.find(
    (item): item is SessionMessageAssistant => item.type === "assistant" && (item.tokens?.output ?? 0) > 0,
  )
  if (!latest?.tokens) return

  // The V2 message shape has no `total`; reconstruct the trigger's
  // `total`-based numerator. getUsage breaks cache and reasoning out of
  // input/output, so the component sum equals the provider total. On
  // providers that omit `total` the trigger falls back to this sum minus
  // reasoning — the meter then over-reports by reasoning tokens, the safe
  // direction (it may warn early but never hides imminent compaction).
  const tokens =
    (latest.tokens.input ?? 0) +
    (latest.tokens.output ?? 0) +
    (latest.tokens.reasoning ?? 0) +
    (latest.tokens.cache?.read ?? 0) +
    (latest.tokens.cache?.write ?? 0)
  if (tokens <= 0) return

  const model = providers.find((item) => item.id === latest.model.providerID)?.models[latest.model.id]
  if (!model) return { tokens, percent: null }

  const usable = budgetUsable(config ?? {}, model)
  const percent = usable > 0 ? Math.round((tokens / usable) * 100) : null

  return { tokens, percent }
}

/** Total assistant cost across all messages, in USD. */
export function totalAssistantCost(messages: ReadonlyArray<SessionMessage>): number {
  return messages.reduce((sum, item) => sum + (item.type === "assistant" ? (item.cost ?? 0) : 0), 0)
}
