import type { SessionMessage, SessionMessageAssistant } from "@opencode-ai/sdk/v2"

export type UsageProvider = {
  id: string
  models: Record<string, { limit: { context: number } }>
}

/**
 * Computes token usage for the most recently completed assistant turn.
 *
 * The TUI message store (`sync.data.messages`) is ordered **newest-first**:
 * the server returns `desc(time_created), desc(id)` and live events prepend
 * with `unshift`. So the "latest" assistant is the FIRST `find` match, not the
 * last. Using `findLast` here silently pinned the value to the oldest
 * completed turn (see footer/sidebar context bug), so this module is the single
 * authority that encodes the sort contract.
 */
export function latestAssistantUsage(
  messages: ReadonlyArray<SessionMessage>,
  providers: ReadonlyArray<UsageProvider>,
): { tokens: number; percent: number | null } | undefined {
  // `find` scans from index 0 = the newest entry in a newest-first store.
  const latest = messages.find(
    (item): item is SessionMessageAssistant => item.type === "assistant" && (item.tokens?.output ?? 0) > 0,
  )
  if (!latest) return

  const tokens =
    (latest.tokens?.input ?? 0) +
    (latest.tokens?.output ?? 0) +
    (latest.tokens?.reasoning ?? 0) +
    (latest.tokens?.cache.read ?? 0) +
    (latest.tokens?.cache.write ?? 0)
  if (tokens <= 0) return

  const model = providers.find((item) => item.id === latest.model.providerID)?.models[latest.model.id]
  const percent = model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null

  return { tokens, percent }
}

/** Total assistant cost across all messages, in USD. */
export function totalAssistantCost(messages: ReadonlyArray<SessionMessage>): number {
  return messages.reduce((sum, item) => sum + (item.type === "assistant" ? (item.cost ?? 0) : 0), 0)
}
