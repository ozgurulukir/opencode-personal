import type { UsageAmount, UsageCredential, UsageLimit, UsageProvider, UsageReport, UsageWindow } from "./types"
import { buildUsageStatus } from "./types"

const CHATGPT_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function finiteNumber(value: unknown): number | undefined {
  const result = typeof value === "number" ? value : typeof value === "string" ? Number(value) : undefined
  return result !== undefined && Number.isFinite(result) ? result : undefined
}

function parseResetAt(value: unknown): number | undefined {
  const seconds = finiteNumber(value)
  if (seconds === undefined) return undefined
  return seconds > 1_000_000_000_000 ? seconds : seconds * 1000
}

function formatWindowLabel(durationSeconds: number | undefined): string {
  if (durationSeconds === 5 * 60 * 60) return "5 Hour"
  if (durationSeconds === 7 * 24 * 60 * 60) return "7 Day"
  if (durationSeconds !== undefined && durationSeconds % (24 * 60 * 60) === 0)
    return `${durationSeconds / (24 * 60 * 60)} Day`
  if (durationSeconds !== undefined && durationSeconds % (60 * 60) === 0) return `${durationSeconds / (60 * 60)} Hour`
  if (durationSeconds !== undefined && durationSeconds % 60 === 0) return `${durationSeconds / 60} Minute`
  return "Quota"
}

function parseWindow(raw: unknown, id: string): { window: UsageWindow; amount: UsageAmount } | null {
  if (!isRecord(raw)) return null

  const usedPercent = finiteNumber(raw.used_percent)
  if (usedPercent === undefined) return null

  const durationSeconds = finiteNumber(raw.limit_window_seconds)
  const resetsAt = parseResetAt(raw.reset_at)
  const used = Math.min(Math.max(usedPercent, 0), 100)
  const usedFraction = used / 100

  return {
    window: {
      id,
      label: formatWindowLabel(durationSeconds),
      ...(durationSeconds !== undefined ? { durationMs: durationSeconds * 1000 } : {}),
      ...(resetsAt !== undefined ? { resetsAt } : {}),
    },
    amount: {
      used,
      limit: 100,
      remaining: 100 - used,
      usedFraction,
      remainingFraction: 1 - usedFraction,
      unit: "percent",
    },
  }
}

function buildRateLimitRows(args: { rateLimit: unknown; idPrefix: string; tier?: string }): UsageLimit[] {
  const rateLimit = args.rateLimit
  if (!isRecord(rateLimit)) return []

  return (["primary", "secondary"] as const).flatMap((kind) => {
    const parsed = parseWindow(
      rateLimit[kind === "primary" ? "primary_window" : "secondary_window"],
      `${args.idPrefix}:${kind}`,
    )
    if (!parsed) return []

    return [
      {
        id: `${args.idPrefix}:${kind}`,
        label: `${parsed.window.label} Limit`,
        scope: { provider: "openai", windowId: parsed.window.id, ...(args.tier ? { tier: args.tier } : {}) },
        window: parsed.window,
        amount: parsed.amount,
        status: buildUsageStatus(parsed.amount.usedFraction),
      },
    ]
  })
}

export function parseOpenAIUsage(raw: unknown, credential: UsageCredential): UsageReport | null {
  if (!isRecord(raw)) return null

  const limits = buildRateLimitRows({ rateLimit: raw.rate_limit, idPrefix: "openai" })
  const additional = Array.isArray(raw.additional_rate_limits) ? raw.additional_rate_limits : []

  for (const item of additional) {
    if (!isRecord(item)) continue
    const tier = [item.limit_name, item.normal_model_slug, item.metered_feature].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    )
    if (!tier) continue
    limits.push(...buildRateLimitRows({ rateLimit: item.rate_limit, idPrefix: `openai:${tier}`, tier }))
  }

  if (limits.length === 0) return null

  const planType = typeof raw.plan_type === "string" ? raw.plan_type : undefined
  const accountId = credential.accountId ?? (typeof raw.account_id === "string" ? raw.account_id : undefined)
  const resetCredits = isRecord(raw.rate_limit_reset_credits)
    ? finiteNumber(raw.rate_limit_reset_credits.available_count)
    : undefined

  return {
    provider: "openai",
    fetchedAt: Date.now(),
    limits,
    metadata: {
      ...(accountId ? { accountId } : {}),
      ...(planType ? { planType } : {}),
      ...(resetCredits !== undefined ? { resetCredits } : {}),
    },
  }
}

async function fetchOpenAIUsage(credential: UsageCredential): Promise<UsageReport | null> {
  if (!credential.accessToken) return null

  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${credential.accessToken}`,
    ...(credential.accountId ? { "ChatGPT-Account-Id": credential.accountId } : {}),
  }

  const response = await fetch(CHATGPT_USAGE_URL, { headers })
  if (!response.ok) return null
  return parseOpenAIUsage(await response.json(), credential)
}

export const openaiUsageProvider: UsageProvider = {
  id: "openai",
  fetchUsage: fetchOpenAIUsage,
  supports: (credential) => credential.type === "oauth" && !!credential.accessToken,
}
