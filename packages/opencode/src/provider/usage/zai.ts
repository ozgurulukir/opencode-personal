import type { UsageProvider, UsageReport, UsageLimit, UsageWindow, UsageCredential } from "./types"
import { buildUsageAmount, buildUsageStatus } from "./types"

const ZAI_BASE_URL = "https://api.z.ai"
const QUOTA_PATH = "/api/monitor/usage/quota/limit"
const MODEL_USAGE_PATH = "/api/monitor/usage/model-usage"
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

interface ZaiLimitItem {
  type?: string
  usage?: number
  currentValue?: number
  percentage?: number
  remaining?: number
  nextResetTime?: number
}

interface ZaiQuotaResponse {
  success?: boolean
  code?: number
  msg?: string
  data?: {
    limits?: unknown[]
  }
}

function parseMillis(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : undefined
  if (n === undefined || !Number.isFinite(n)) return undefined
  return n > 1_000_000_000_000 ? n : n * 1000
}

function parseLimitItem(raw: unknown): ZaiLimitItem | null {
  if (!raw || typeof raw !== "object") return null
  const v = raw as Record<string, unknown>
  const type = typeof v.type === "string" ? v.type : undefined
  if (!type) return null
  const num = (k: string) => (typeof v[k] === "number" ? v[k] : typeof v[k] === "string" ? Number(v[k]) : undefined)
  return {
    type,
    usage: num("usage"),
    currentValue: num("currentValue"),
    percentage: num("percentage"),
    remaining: num("remaining"),
    nextResetTime: parseMillis(v.nextResetTime),
  }
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}+${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function fetchZaiUsage(credential: UsageCredential): Promise<UsageReport | null> {
  if (!credential.apiKey) return null

  const headers: Record<string, string> = {
    Authorization: credential.apiKey,
    "Content-Type": "application/json",
  }

  let payload: ZaiQuotaResponse | null = null
  try {
    const resp = await fetch(`${ZAI_BASE_URL}${QUOTA_PATH}`, { headers })
    if (!resp.ok) return null
    payload = (await resp.json()) as ZaiQuotaResponse
  } catch {
    return null
  }

  if (!payload || payload.success !== true) return null

  const rawLimits = Array.isArray(payload.data?.limits) ? payload.data!.limits! : []
  const limits: UsageLimit[] = []

  for (const raw of rawLimits) {
    const item = parseLimitItem(raw)
    if (!item) continue

    const window: UsageWindow = {
      id: "quota",
      label: "Quota",
      durationMs: SEVEN_DAYS_MS,
      ...(item.nextResetTime !== undefined ? { resetsAt: item.nextResetTime } : {}),
    }

    if (item.type === "TOKENS_LIMIT") {
      const amount = buildUsageAmount({
        used: item.currentValue,
        limit: item.usage,
        remaining: item.remaining,
        percentage: item.percentage,
        unit: "tokens",
      })
      limits.push({
        id: "zai:tokens",
        label: "ZAI Token Quota",
        scope: { provider: "zai", windowId: "quota" },
        window,
        amount,
        status: buildUsageStatus(amount.usedFraction),
      })
    }

    if (item.type === "TIME_LIMIT") {
      const amount = buildUsageAmount({
        used: item.currentValue,
        limit: item.usage,
        remaining: item.remaining,
        percentage: item.percentage,
        unit: "requests",
      })
      limits.push({
        id: "zai:requests",
        label: "ZAI Request Quota",
        scope: { provider: "zai", windowId: "quota" },
        window,
        amount,
        status: buildUsageStatus(amount.usedFraction),
      })
    }
  }

  if (limits.length === 0) return null

  const report: UsageReport = {
    provider: "zai",
    fetchedAt: Date.now(),
    limits,
    metadata: {},
  }

  // Also fetch model-level usage breakdown (best-effort)
  const now = new Date()
  const start = new Date(now.getTime() - SEVEN_DAYS_MS)
  const modelUrl = `${ZAI_BASE_URL}${MODEL_USAGE_PATH}?startTime=${encodeURIComponent(formatDate(start))}&endTime=${encodeURIComponent(formatDate(now))}`
  try {
    const resp = await fetch(modelUrl, { headers })
    if (resp.ok) {
      report.metadata!.modelUsage = await resp.json()
    }
  } catch {}

  return report
}

export const zaiUsageProvider: UsageProvider = {
  id: "zai",
  fetchUsage: fetchZaiUsage,
  supports: (credential) => credential.type === "api_key" && !!credential.apiKey,
}
