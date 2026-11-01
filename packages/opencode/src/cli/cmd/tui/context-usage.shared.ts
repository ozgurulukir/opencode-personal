import type { SessionMessage, SessionMessageAssistant } from "@opencode-ai/sdk/v2"
import { used as budgetUsed, usable as budgetUsable, type BudgetModel } from "@/session/context-budget"

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
 * aligned with the auto-compaction trigger: the numerator uses
 * `ContextBudget.used()` (excludes `reasoning`; the SDK message shape carries
 * no `total`, so the component sum is the display-side path) and the
 * denominator uses `ContextBudget.usable()` — the same budget window the
 * trigger compares against. 100% means compaction is imminent.
 *
 * The TUI message store (`sync.data.messages`) is ordered **newest-first**:
 * the server returns `desc(id)` (ids are ULIDs, so id order is time order)
 * and live events prepend with `unshift`. So the "latest" assistant is the
 * FIRST `find` match, not
 * the last. Using `findLast` here silently pinned the value to the oldest
 * completed turn (see footer/sidebar context bug), so this module is the single
 * authority that encodes the sort contract.
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

  // The SDK message tokens shape has no `total`; used() sums the components
  // (reasoning deliberately excluded, matching the trigger).
  const tokens = budgetUsed({
    input: latest.tokens.input ?? 0,
    output: latest.tokens.output ?? 0,
    cache: {
      read: latest.tokens.cache?.read ?? 0,
      write: latest.tokens.cache?.write ?? 0,
    },
  })
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
