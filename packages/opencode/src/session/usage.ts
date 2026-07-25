import { Decimal } from "decimal.js"
import type { LanguageModelUsage } from "ai"
import type { ProviderMetadata } from "ai"
import type { Provider } from "@/provider/provider"

export function getUsage(input: { model: Provider.Model; usage: LanguageModelUsage; metadata?: ProviderMetadata }) {
  const safe = (value: number) => {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, value)
  }
  const inputTokens = safe(input.usage.inputTokens ?? 0)
  const outputTokens = safe(input.usage.outputTokens ?? 0)
  const reasoningTokens = safe(input.usage.outputTokenDetails?.reasoningTokens ?? input.usage.reasoningTokens ?? 0)

  const cacheReadInputTokens = safe(
    input.usage.inputTokenDetails?.cacheReadTokens ?? input.usage.cachedInputTokens ?? 0,
  )
  const cacheWriteInputTokens = safe(Number(
    input.usage.inputTokenDetails?.cacheWriteTokens ||
    input.metadata?.["anthropic"]?.["cacheCreationInputTokens"] ||
    input.metadata?.["vertex"]?.["cacheCreationInputTokens"] ||
    // @ts-expect-error
    input.metadata?.["bedrock"]?.["usage"]?.["cacheWriteInputTokens"] ||
    // @ts-expect-error
    input.metadata?.["venice"]?.["usage"]?.["cacheCreationInputTokens"] ||
    0,
  ))

  const adjustedInputTokens = safe(inputTokens - cacheReadInputTokens - cacheWriteInputTokens)

  const total = input.usage.totalTokens

  const tokens = {
    total,
    input: adjustedInputTokens,
    output: safe(outputTokens - reasoningTokens),
    reasoning: reasoningTokens,
    cache: {
      write: cacheWriteInputTokens,
      read: cacheReadInputTokens,
    },
  }

  const costInfo =
    input.model.cost?.experimentalOver200K && tokens.input + tokens.cache.read > 200_000
      ? input.model.cost.experimentalOver200K
      : input.model.cost
  return {
    cost: safe(
      new Decimal(0)
        .add(new Decimal(tokens.input).mul(costInfo?.input ?? 0).div(1_000_000))
        .add(new Decimal(tokens.output).mul(costInfo?.output ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.read).mul(costInfo?.cache?.read ?? 0).div(1_000_000))
        .add(new Decimal(tokens.cache.write).mul(costInfo?.cache?.write ?? 0).div(1_000_000))
        .add(new Decimal(tokens.reasoning).mul(costInfo?.output ?? 0).div(1_000_000))
        .toNumber(),
    ),
    tokens,
  }
}
