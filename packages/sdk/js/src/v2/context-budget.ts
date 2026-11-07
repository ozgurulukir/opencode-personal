// Structural slices so server, TUI, and app share one budget implementation:
// the TUI and app hold SDK-shaped config and public provider models (not the
// server-internal types), and Config.Info / the internal Provider.Model
// satisfy these structurally. Hosted in the SDK so the compaction trigger and
// every context meter consume the same math instead of re-deriving it (the
// #351 drift class).
export type CompactionSettingsInput = {
  compaction?: {
    auto?: boolean
    prune?: boolean
    tail_turns?: number
    preserve_recent_tokens?: number
    reserved?: number
    prune_minimum_tokens?: number
    prune_protect_tokens?: number
    tool_output_max_chars?: number
    min_preserve_recent_tokens?: number
    max_preserve_recent_tokens?: number
    prune_protected_tools?: Array<string>
    summary_max_tokens?: number
    autocontinue?: boolean
    context_limit?: number
  }
}

export type BudgetModel = {
  id?: string
  limit: { context: number; input?: number; output?: number }
}

export type BudgetTokens = {
  total?: number
  input: number
  output: number
  reasoning?: number
  cache: { read: number; write: number }
}

// Output-token cap shared with the server's request shaping. Mirrors the
// server's Flag read (`number()` in `@opencode-ai/core/flag/flag`: positive
// integer env override) inline so this module stays dependency-free; the
// `typeof process` guard keeps browser bundles on the default.
const parsedOutputTokenMax =
  typeof process === "undefined" ? NaN : Number(process.env.OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX)
const hasOutputTokenOverride = Number.isInteger(parsedOutputTokenMax) && parsedOutputTokenMax > 0
export const OUTPUT_TOKEN_MAX = hasOutputTokenOverride ? parsedOutputTokenMax : 32_000

// Structural param: the TUI context meter passes the public provider model
// shape, which carries the same `limit.output` field.
export function maxOutputTokens(model: { limit: { output?: number } }): number {
  return Math.min(model.limit.output ?? 0, OUTPUT_TOKEN_MAX) || OUTPUT_TOKEN_MAX
}

export const DEFAULTS = {
  compactionBuffer: 20_000,
  pruneMinimumTokens: 20_000,
  pruneProtectTokens: 40_000,
  toolOutputMaxChars: 2_000,
  defaultTailTurns: 2,
  minPreserveRecentTokens: 2_000,
  maxPreserveRecentTokens: 8_000,
  maxSummaryTokens: 8_000,
} as const

export function compactionConfig(cfg: CompactionSettingsInput) {
  return {
    auto: cfg.compaction?.auto !== false,
    prune: cfg.compaction?.prune !== false,
    tailTurns: cfg.compaction?.tail_turns ?? DEFAULTS.defaultTailTurns,
    preserveRecentTokens: cfg.compaction?.preserve_recent_tokens,
    reserved: cfg.compaction?.reserved,
    pruneMinimumTokens: cfg.compaction?.prune_minimum_tokens ?? DEFAULTS.pruneMinimumTokens,
    pruneProtectTokens: cfg.compaction?.prune_protect_tokens ?? DEFAULTS.pruneProtectTokens,
    toolOutputMaxChars: cfg.compaction?.tool_output_max_chars ?? DEFAULTS.toolOutputMaxChars,
    minPreserveRecentTokens: cfg.compaction?.min_preserve_recent_tokens ?? DEFAULTS.minPreserveRecentTokens,
    maxPreserveRecentTokens: cfg.compaction?.max_preserve_recent_tokens ?? DEFAULTS.maxPreserveRecentTokens,
    pruneProtectedTools: cfg.compaction?.prune_protected_tools ?? ["skill"],
    summaryMaxTokens: cfg.compaction?.summary_max_tokens,
    maxSummaryTokens: DEFAULTS.maxSummaryTokens,
    autocontinue: cfg.compaction?.autocontinue !== false,
    contextLimit: cfg.compaction?.context_limit,
  }
}

export function usable(cfg: CompactionSettingsInput, model: BudgetModel) {
  return usableWith(cfg, model, compactionConfig(cfg))
}

function usableWith(
  cfg: CompactionSettingsInput,
  model: BudgetModel,
  cc: ReturnType<typeof compactionConfig>,
) {
  const context = model.limit.context
  if (!cc.contextLimit && context === 0) return 0

  const reserved = Math.max(cc.reserved ?? DEFAULTS.compactionBuffer, maxOutputTokens(model))

  const effectiveContext = context > 0 ? context : Infinity
  const effectiveInput = model.limit.input ?? Infinity
  const effectiveLimit = cc.contextLimit ?? Infinity

  const base = Math.min(effectiveContext, effectiveInput, effectiveLimit)
  if (!Number.isFinite(base)) return 0

  return Math.max(0, base - reserved)
}

export { usableWith }

// Tail-preservation budget for compaction selection: the user-configured
// `preserve_recent_tokens` if set, otherwise a quarter of the usable window
// clamped between the min/max guardrails.
export function preserveRecentBudget(input: { cfg: CompactionSettingsInput; model: BudgetModel }): number {
  const cc = compactionConfig(input.cfg)
  const windowScaledMax = Math.max(
    cc.maxPreserveRecentTokens,
    Math.floor(usableWith(input.cfg, input.model, cc) * 0.25),
  )
  return (
    cc.preserveRecentTokens ??
    Math.min(
      windowScaledMax,
      Math.max(cc.minPreserveRecentTokens, Math.floor(usableWith(input.cfg, input.model, cc) * 0.25)),
    )
  )
}

// Output budget for the summarizer model: the configured override wins,
// otherwise the model's output cap floored by the practical 8K ceiling.
export function summaryBudget(model: BudgetModel, cc: ReturnType<typeof compactionConfig>): number {
  return cc.summaryMaxTokens ?? Math.min(maxOutputTokens(model), cc.maxSummaryTokens)
}

export function used(tokens: BudgetTokens) {
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

/**
 * Numerator for context-usage meters that receive decomposed token counts
 * (no provider `total`). Deliberately diverges from `used()`: `used()` excludes
 * `reasoning` in its no-total fallback because the server's `getUsage` already
 * subtracts reasoning from `output` (`output = rawOutput - reasoning`), while
 * callers of this function pass tokens where `output` still excludes reasoning,
 * so reasoning must be added back for the sum to equal the provider total.
 */
export type TokenBreakdown = {
  input?: number
  output?: number
  reasoning?: number
  cache?: { read?: number; write?: number }
}

export function usedFromBreakdown(tokens: TokenBreakdown): number {
  return (
    (tokens.input ?? 0) +
    (tokens.output ?? 0) +
    (tokens.reasoning ?? 0) +
    (tokens.cache?.read ?? 0) +
    (tokens.cache?.write ?? 0)
  )
}

export function usagePercent(tokens: TokenBreakdown, usable: number): number | null {
  if (usable <= 0) return null
  return Math.round((usedFromBreakdown(tokens) / usable) * 100)
}

export type OverflowDetail = {
  overflow: boolean
  reason: "threshold" | "auto-off" | "zero-context" | "zero-usable" | "under-budget"
}

/**
 * `isOverflow` with a reason attached. Branch order mirrors the historical
 * `isOverflow` guards exactly (auto gate first), so the `overflow` boolean is
 * identical for all inputs. Callers that only need the boolean keep using
 * `isOverflow`; the diagnostic consumer (compaction trigger's warn-once
 * zero-budget path) derives its decision from `reason`.
 */
export function overflowDetail(cfg: CompactionSettingsInput, tokens: BudgetTokens, model: BudgetModel): OverflowDetail {
  const cc = compactionConfig(cfg)
  if (!cc.auto) return { overflow: false, reason: "auto-off" }
  // When contextLimit is set, it replaces model.limit.context as the threshold base.
  // Skip the model.limit.context === 0 guard — the user explicitly set a limit.
  if (!cc.contextLimit && model.limit.context === 0) return { overflow: false, reason: "zero-context" }

  const u = usable(cfg, model)
  // A zero/negative budget means the model can never overflow. The warn-once
  // diagnostic for this case lives at the trigger site
  // (compaction-trigger.ts) so this module stays dependency-free.
  if (u <= 0) return { overflow: false, reason: "zero-usable" }

  if (used(tokens) >= u) return { overflow: true, reason: "threshold" }
  return { overflow: false, reason: "under-budget" }
}

export function isOverflow(cfg: CompactionSettingsInput, tokens: BudgetTokens, model: BudgetModel): boolean {
  return overflowDetail(cfg, tokens, model).overflow
}
