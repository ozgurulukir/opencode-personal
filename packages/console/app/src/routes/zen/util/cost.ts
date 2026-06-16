export type CostInfo = {
  totalCostInCent: number
  inputCost: number
  outputCost: number
  cacheReadCost?: number
  cacheWrite5mCost?: number
  cacheWrite1hCost?: number
}

export type BillingSource = "anonymous" | "free" | "byok" | "subscription" | "lite" | "balance"

export function calculateCost(
  modelInfo: {
    cost200K?: { input: number; output: number; cacheRead?: number; cacheWrite5m?: number; cacheWrite1h?: number }
    cost: { input: number; output: number; cacheRead?: number; cacheWrite5m?: number; cacheWrite1h?: number }
  },
  usageInfo: {
    inputTokens: number
    outputTokens: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWrite5mTokens?: number
    cacheWrite1hTokens?: number
  },
): CostInfo {
  const { inputTokens, outputTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens } = usageInfo

  const modelCost =
    modelInfo.cost200K &&
    inputTokens + (cacheReadTokens ?? 0) + (cacheWrite5mTokens ?? 0) + (cacheWrite1hTokens ?? 0) > 200_000
      ? modelInfo.cost200K
      : modelInfo.cost

  const inputCost = modelCost.input * inputTokens * 100
  const outputCost = modelCost.output * outputTokens * 100
  const cacheReadCost = (() => {
    if (!cacheReadTokens) return undefined
    if (!modelCost.cacheRead) return undefined
    return modelCost.cacheRead * cacheReadTokens * 100
  })()
  const cacheWrite5mCost = (() => {
    if (!cacheWrite5mTokens) return undefined
    if (!modelCost.cacheWrite5m) return undefined
    return modelCost.cacheWrite5m * cacheWrite5mTokens * 100
  })()
  const cacheWrite1hCost = (() => {
    if (!cacheWrite1hTokens) return undefined
    if (!modelCost.cacheWrite1h) return undefined
    return modelCost.cacheWrite1h * cacheWrite1hTokens * 100
  })()
  const totalCostInCent =
    inputCost + outputCost + (cacheReadCost ?? 0) + (cacheWrite5mCost ?? 0) + (cacheWrite1hCost ?? 0)
  return {
    totalCostInCent,
    inputCost,
    outputCost,
    cacheReadCost,
    cacheWrite5mCost,
    cacheWrite1hCost,
  }
}

export function calculateOccurredCost(billingSource: BillingSource, costInfo: CostInfo): string {
  return billingSource === "balance" ? (costInfo.totalCostInCent / 100).toFixed(8) : "0"
}
