/** Provider-side usage/quota types. Ported from oh-my-pi's packages/ai/src/usage.ts. */

export type UsageUnit = "percent" | "tokens" | "requests" | "usd" | "unknown"

export type UsageStatus = "ok" | "warning" | "exhausted" | "unknown"

export interface UsageWindow {
  id: string
  label: string
  durationMs?: number
  resetsAt?: number
}

export interface UsageAmount {
  used?: number
  limit?: number
  remaining?: number
  usedFraction?: number
  remainingFraction?: number
  unit: UsageUnit
}

export interface UsageScope {
  provider: string
  accountId?: string
  tier?: string
  windowId?: string
}

export interface UsageLimit {
  id: string
  label: string
  scope: UsageScope
  window?: UsageWindow
  amount: UsageAmount
  status?: UsageStatus
  notes?: string[]
}

export interface UsageReport {
  provider: string
  fetchedAt: number
  limits: UsageLimit[]
  metadata?: Record<string, unknown>
}

/** Credential needed to call a provider's usage API. */
export interface UsageCredential {
  type: "api_key" | "oauth"
  apiKey?: string
  accessToken?: string
  accountId?: string
  email?: string
}

/** Provider usage fetcher interface. */
export interface UsageProvider {
  id: string
  fetchUsage(credential: UsageCredential): Promise<UsageReport | null>
  supports(credential: UsageCredential): boolean
}

export function resolveUsedFraction(limit: UsageLimit): number | undefined {
  return resolveAmountFraction(limit.amount)
}

function resolveAmountFraction(amount: UsageAmount): number | undefined {
  if (amount.usedFraction !== undefined) return amount.usedFraction
  if (amount.used !== undefined && amount.limit !== undefined && amount.limit > 0) {
    return amount.used / amount.limit
  }
  if (amount.unit === "percent" && amount.used !== undefined) return amount.used / 100
  if (amount.remainingFraction !== undefined) return Math.max(0, 1 - amount.remainingFraction)
  return undefined
}

export function buildUsageAmount(args: UsageAmount & { percentage?: number }): UsageAmount {
  const fraction = resolveAmountFraction({
    ...args,
    ...(args.percentage !== undefined ? { usedFraction: Math.min(Math.max(args.percentage / 100, 0), 1) } : {}),
  })
  const usedFraction = fraction !== undefined ? Math.min(fraction, 1) : undefined
  return {
    used: args.used,
    limit: args.limit,
    remaining: args.remaining,
    usedFraction,
    remainingFraction: usedFraction !== undefined ? Math.max(1 - usedFraction, 0) : undefined,
    unit: args.unit,
  }
}

export function buildUsageStatus(usedFraction: number | undefined): UsageStatus | undefined {
  if (usedFraction === undefined) return undefined
  if (usedFraction >= 1) return "exhausted"
  if (usedFraction >= 0.9) return "warning"
  return "ok"
}
