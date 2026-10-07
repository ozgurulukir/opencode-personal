import type { UsageProvider, UsageReport, UsageLimit, UsageWindow, UsageCredential } from "./types"
import { buildUsageAmount, buildUsageStatus } from "./types"

const ANTHROPIC_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const ANTHROPIC_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile"
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

interface UsageBucket {
  utilization?: number
  resets_at?: string
}

interface ParsedBucket {
  utilization?: number
  resetsAt?: number
}

interface ClaudeUsageResponse {
  five_hour?: UsageBucket | null
  seven_day?: UsageBucket | null
  seven_day_opus?: UsageBucket | null
  seven_day_sonnet?: UsageBucket | null
}

function parseIsoTime(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseBucket(bucket: unknown): ParsedBucket | undefined {
  if (!bucket || typeof bucket !== "object") return undefined
  const b = bucket as UsageBucket
  const utilization = b.utilization
  const resetsAt = parseIsoTime(b.resets_at)
  if (utilization === undefined && resetsAt === undefined) return undefined
  return { utilization, resetsAt }
}

function buildLimit(args: {
  id: string
  label: string
  windowId: string
  windowLabel: string
  durationMs: number
  bucket: ParsedBucket | undefined
  tier?: string
}): UsageLimit | null {
  if (args.bucket?.utilization === undefined) return null
  const used = Math.min(Math.max(args.bucket.utilization, 0), 100)
  const amount = buildUsageAmount({ used, limit: 100, remaining: Math.max(0, 100 - used), unit: "percent" })
  const window: UsageWindow = {
    id: args.windowId,
    label: args.windowLabel,
    durationMs: args.durationMs,
    ...(args.bucket.resetsAt !== undefined ? { resetsAt: args.bucket.resetsAt } : {}),
  }
  return {
    id: args.id,
    label: args.label,
    scope: { provider: "anthropic", windowId: args.windowId, tier: args.tier },
    window,
    amount,
    status: buildUsageStatus(amount.usedFraction),
  }
}

async function fetchClaudeUsage(credential: UsageCredential): Promise<UsageReport | null> {
  if (!credential.accessToken) return null

  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    authorization: `Bearer ${credential.accessToken}`,
  }

  const response = await fetch(ANTHROPIC_USAGE_URL, { headers })
  if (!response.ok) return null

  const payload = (await response.json()) as ClaudeUsageResponse
  const fiveHour = parseBucket(payload.five_hour)
  const sevenDay = parseBucket(payload.seven_day)
  const sevenDayOpus = parseBucket(payload.seven_day_opus)
  const sevenDaySonnet = parseBucket(payload.seven_day_sonnet)

  const limits = [
    buildLimit({
      id: "anthropic:5h",
      label: "Claude 5 Hour",
      windowId: "5h",
      windowLabel: "5 Hour",
      durationMs: FIVE_HOURS_MS,
      bucket: fiveHour,
    }),
    buildLimit({
      id: "anthropic:7d",
      label: "Claude 7 Day",
      windowId: "7d",
      windowLabel: "7 Day",
      durationMs: SEVEN_DAYS_MS,
      bucket: sevenDay,
    }),
    buildLimit({
      id: "anthropic:7d:opus",
      label: "Claude 7 Day (Opus)",
      windowId: "7d",
      windowLabel: "7 Day",
      durationMs: SEVEN_DAYS_MS,
      bucket: sevenDayOpus,
      tier: "opus",
    }),
    buildLimit({
      id: "anthropic:7d:sonnet",
      label: "Claude 7 Day (Sonnet)",
      windowId: "7d",
      windowLabel: "7 Day",
      durationMs: SEVEN_DAYS_MS,
      bucket: sevenDaySonnet,
      tier: "sonnet",
    }),
  ].filter((limit): limit is UsageLimit => limit !== null)

  if (limits.length === 0) return null

  let accountId = credential.accountId
  let email = credential.email
  if (!accountId || !email) {
    try {
      const profileResp = await fetch(ANTHROPIC_PROFILE_URL, { headers })
      if (profileResp.ok) {
        const profile = (await profileResp.json()) as {
          uuid?: string
          email?: string
          account?: { uuid?: string; email?: string }
        }
        accountId = accountId ?? profile.uuid ?? profile.account?.uuid
        email = email ?? profile.email ?? profile.account?.email
      }
    } catch {}
  }

  return {
    provider: "anthropic",
    fetchedAt: Date.now(),
    limits,
    metadata: {
      ...(accountId ? { accountId } : {}),
      ...(email ? { email } : {}),
    },
  }
}

export const claudeUsageProvider: UsageProvider = {
  id: "anthropic",
  fetchUsage: fetchClaudeUsage,
  supports: (credential) => credential.type === "oauth" && !!credential.accessToken,
}
