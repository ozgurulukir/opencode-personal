import type { Config } from "@/config/config"
import { ProviderTransform } from "@/provider/transform"
import type { Provider } from "@/provider/provider"
import { Log } from "@opencode-ai/core/util/log"
import type { MessageV2 } from "./message-v2"

const log = Log.create({ service: "session.context-budget" })
const warnedModels = new Set<string>()

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

export function compactionConfig(cfg: Config.Info) {
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

export function usable(cfg: Config.Info, model: Provider.Model) {
  return usableWith(cfg, model, compactionConfig(cfg))
}

function usableWith(
  cfg: Config.Info,
  model: Provider.Model,
  cc: ReturnType<typeof compactionConfig>,
) {
  const context = model.limit.context
  if (!cc.contextLimit && context === 0) return 0

  const reserved = Math.max(
    cc.reserved ?? DEFAULTS.compactionBuffer,
    ProviderTransform.maxOutputTokens(model),
  )

  const effectiveContext = context > 0 ? context : Infinity
  const effectiveInput = model.limit.input ?? Infinity
  const effectiveLimit = cc.contextLimit ?? Infinity

  const base = Math.min(effectiveContext, effectiveInput, effectiveLimit)
  if (!Number.isFinite(base)) return 0

  return Math.max(0, base - reserved)
}

export { usableWith }

export function used(tokens: MessageV2.Assistant["tokens"]) {
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

export function isOverflow(cfg: Config.Info, tokens: MessageV2.Assistant["tokens"], model: Provider.Model) {
  const cc = compactionConfig(cfg)
  if (!cc.auto) return false
  // When contextLimit is set, it replaces model.limit.context as the threshold base.
  // Skip the model.limit.context === 0 guard — the user explicitly set a limit.
  if (!cc.contextLimit && model.limit.context === 0) return false

  const u = usable(cfg, model)
  if (u <= 0) {
    if (!warnedModels.has(model.id)) {
      warnedModels.add(model.id)
      log.warn("Usable context window is zero or negative; auto-compaction disabled for model", {
        model: model.id,
        context: model.limit.context,
      })
    }
    return false
  }

  return used(tokens) >= u
}
