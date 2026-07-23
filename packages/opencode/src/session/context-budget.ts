import type { Config } from "@/config/config"
import { ProviderTransform } from "@/provider/transform"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"

export const DEFAULTS = {
  compactionBuffer: 20_000,
  pruneMinimumTokens: 20_000,
  pruneProtectTokens: 40_000,
  toolOutputMaxChars: 2_000,
  defaultTailTurns: 2,
  minPreserveRecentTokens: 2_000,
  maxPreserveRecentTokens: 8_000,
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
  if (context === 0) return 0

  const reserved = cc.reserved ?? Math.min(DEFAULTS.compactionBuffer, ProviderTransform.maxOutputTokens(model))
  return model.limit.input
    ? Math.max(0, model.limit.input - reserved)
    : Math.max(0, context - ProviderTransform.maxOutputTokens(model))
}

export { usableWith }

export function used(tokens: MessageV2.Assistant["tokens"]) {
  return tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
}

export function isOverflow(cfg: Config.Info, tokens: MessageV2.Assistant["tokens"], model: Provider.Model) {
  if (!compactionConfig(cfg).auto) return false
  if (model.limit.context === 0) return false

  return used(tokens) >= usable(cfg, model)
}
