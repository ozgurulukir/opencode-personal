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
  const amount = limit.amount
  if (amount.usedFraction !== undefined) return amount.usedFraction
  if (amount.used !== undefined && amount.limit !== undefined && amount.limit > 0) {
    return amount.used / amount.limit
  }
  if (amount.unit === "percent" && amount.used !== undefined) return amount.used / 100
  if (amount.remainingFraction !== undefined) return Math.max(0, 1 - amount.remainingFraction)
  return undefined
}

export function buildUsageStatus(usedFraction: number | undefined): UsageStatus | undefined {
  if (usedFraction === undefined) return undefined
  if (usedFraction >= 1) return "exhausted"
  if (usedFraction >= 0.9) return "warning"
  return "ok"
}
