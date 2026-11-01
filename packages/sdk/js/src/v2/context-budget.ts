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

export function used(tokens: BudgetTokens) {
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

export function isOverflow(cfg: CompactionSettingsInput, tokens: BudgetTokens, model: BudgetModel) {
  const cc = compactionConfig(cfg)
  if (!cc.auto) return false
  // When contextLimit is set, it replaces model.limit.context as the threshold base.
  // Skip the model.limit.context === 0 guard — the user explicitly set a limit.
  if (!cc.contextLimit && model.limit.context === 0) return false

  const u = usable(cfg, model)
  // A zero/negative budget means the model can never overflow. The warn-once
  // diagnostic for this case lives at the trigger site
  // (compaction-trigger.ts) so this module stays dependency-free.
  if (u <= 0) return false

  return used(tokens) >= u
}
