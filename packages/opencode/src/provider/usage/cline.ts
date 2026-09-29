import * as Log from "@opencode-ai/core/util/log"
import { safeCatch } from "@/util/error"
import { isRecord } from "@/util/record"
import type { UsageProvider, UsageReport, UsageLimit, UsageCredential } from "./types"

const CLINE_BASE_URL = "https://api.cline.bot"
const USER_ME_PATH = "/api/v1/users/me"
const USER_PLAN_PATH = "/api/v1/users/me/plan"
const USER_BALANCE_PATH = "/api/v1/users"

// The live `balance` value is stored in micro-USD (1 unit = $0.000001 — Cline's own
// client calls the unit "microcredits"). Two readings of the same integer are possible,
// and they differ by 10,000x:
//   - cents:      balance / 100       → 8442 / 100       = $84.42       (previously shipped)
//   - micro-USD:  balance / 1_000_000 → 8442 / 1_000_000 = $0.008442    (three client sources)
// Client-source evidence for micro-USD:
//   - apps/cline-hub/src/webview/src/components/views/settings/account-view.tsx:341-346 (`value / 1_000_000`)
//   - apps/vscode/webview-ui/src/utils/format.ts:39-41 (`microcredits / 10000` → credits; 1 credit = $0.01)
//   - apps/vscode/webview-ui/src/components/chat/CreditLimitError.tsx:52 ("stored in microcredits")
// The app.cline.bot dashboard "Credits Balance" card is the ground truth and the arbiter;
// flipping this single constant is the entire correction.
const BALANCE_UNITS_PER_USD = 1_000_000

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const log = Log.create({ service: "cline-usage" })

interface CurrentUser {
  id: string
  email?: string
  accountId?: string
}

/**
 * Parses the `GET /api/v1/users/me` payload. The live API wraps the profile in
 * an envelope (`{ data: { id, email, ... }, success: true }`, captured
 * 2026-09-28) even though the published docs show a flat
 * `{ id, email, name, active_account_id }` — both shapes are accepted. Returns
 * `null` for non-object payloads or a missing/empty `id`, since the id is
 * required to address the subsequent balance call.
 */
export function parseCurrentUser(raw: unknown): CurrentUser | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const profile = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record
  const id = typeof profile.id === "string" ? profile.id : undefined
  if (!id) return null
  return {
    id,
    ...(typeof profile.email === "string" ? { email: profile.email } : {}),
    ...(typeof profile.active_account_id === "string" ? { accountId: profile.active_account_id } : {}),
  }
}

/** Subscription metadata the `/usage` dialog can show from `GET /users/me/plan`. */
export interface UserPlan {
  displayName?: string
  interval?: string
  periodEnd?: number
  canceled?: boolean
}

/**
 * Parses the `GET /api/v1/users/me/plan` payload
 * (`{ data: { plan: { displayName, interval, ... }, currentPeriodEnd, canceledAt, ... }, success: true }`,
 * captured live 2026-09-29). Returns `null` for non-object input, a missing envelope, a
 * missing `data` object, or a payload that carries no plan name/interval/period end;
 * individual fields are omitted when absent. `canceled` reflects the presence of
 * `canceledAt` (the subscription is set not to renew).
 */
export function parseUserPlan(raw: unknown): UserPlan | null {
  if (!isRecord(raw) || !isRecord(raw.data)) return null
  const envelope = raw.data
  const plan = isRecord(envelope.plan) ? envelope.plan : undefined
  const displayName = typeof plan?.displayName === "string" ? plan.displayName : undefined
  const interval = typeof plan?.interval === "string" ? plan.interval : undefined
  const periodEnd = typeof envelope.currentPeriodEnd === "string" ? Date.parse(envelope.currentPeriodEnd) : Number.NaN
  if (!displayName && !interval && !Number.isFinite(periodEnd)) return null
  return {
    ...(displayName ? { displayName } : {}),
    ...(interval ? { interval } : {}),
    ...(Number.isFinite(periodEnd) ? { periodEnd } : {}),
    canceled: typeof envelope.canceledAt === "string" && envelope.canceledAt.length > 0,
  }
}

/**
 * Maps the captured `GET /api/v1/users/{id}/balance` payload
 * (`{ data: { userId, balance }, success: true }`, observed 2026-09-29) to a
 * `UsageLimit`. `balance` is an integer count of micro-USD (1 unit = $0.000001), so it
 * converts to dollars via `BALANCE_UNITS_PER_USD` (8442 → $0.008442); three Cline-client
 * sources agree on that unit (see the constant above). The balance is a pay-as-you-go
 * credit pool with no denominator or reset window, so `usedFraction` stays `undefined`,
 * and `notes` points the user at the dashboard for the subscription windows the API omits.
 */
function parseBalanceLimit(payload: unknown): UsageLimit | null {
  if (!payload || typeof payload !== "object") return null
  const record = payload as Record<string, unknown>
  if (!record.data || typeof record.data !== "object") return null
  const balance = (record.data as Record<string, unknown>).balance
  if (typeof balance !== "number" || !Number.isFinite(balance)) return null
  return {
    id: "cline-pass:credits",
    label: "ClinePass Credits (pay-as-you-go)",
    scope: { provider: "cline-pass" },
    amount: { remaining: balance / BALANCE_UNITS_PER_USD, unit: "usd" },
    notes: [
      "Subscription windows (5h/weekly/monthly) are not exposed by the Cline API — check app.cline.bot/dashboard/subscription",
    ],
  }
}

/**
 * Fetches the ClinePass credit balance as a two-call chain: resolve the user id via
 * `GET /users/me`, then read `GET /users/{id}/balance`. A best-effort third call
 * (`GET /users/me/plan`) appends subscription metadata when the API returns it. The live
 * API wraps every payload in a `{ data, success }` envelope the docs omit; the `users/me`
 * parser also accepts the documented flat profile shape. Returns `null` on any balance
 * failure (non-OK response, unparseable payload) so the `/usage` dialog simply omits the
 * ClinePass section — graceful degradation, never a broken dialog. A plan-call failure is
 * logged and swallowed so it can never take the balance row down with it.
 */
async function fetchClineUsage(credential: UsageCredential): Promise<UsageReport | null> {
  if (!credential.apiKey) return null

  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${credential.apiKey}`,
  }

  const meResponse = await fetch(`${CLINE_BASE_URL}${USER_ME_PATH}`, { headers })
  if (!meResponse.ok) {
    log.warn("cline usage: /users/me request was rejected", { status: meResponse.status })
    return null
  }
  const user = parseCurrentUser(await meResponse.json())
  if (!user) return null

  const balanceResponse = await fetch(`${CLINE_BASE_URL}${USER_BALANCE_PATH}/${encodeURIComponent(user.id)}/balance`, {
    headers,
  })
  if (!balanceResponse.ok) return null
  const balance = parseBalanceLimit(await balanceResponse.json())
  if (!balance) return null

  const limits: UsageLimit[] = [balance]
  try {
    const planResponse = await fetch(`${CLINE_BASE_URL}${USER_PLAN_PATH}`, { headers })
    if (planResponse.ok) {
      const plan = parseUserPlan(await planResponse.json())
      if (plan) {
        const periodEnd = plan.periodEnd !== undefined ? new Date(plan.periodEnd) : undefined
        const label = plan.displayName ?? (plan.interval ? `Cline Pass (${plan.interval})` : "Cline Pass")
        limits.push({
          id: "cline-pass:plan",
          label: plan.canceled ? `${label} — canceled` : label,
          scope: { provider: "cline-pass" },
          ...(periodEnd
            ? {
                window: {
                  id: "period",
                  label: `until ${MONTH_NAMES[periodEnd.getUTCMonth()]} ${periodEnd.getUTCDate()}`,
                },
              }
            : {}),
          amount: { unit: "unknown" },
        })
      }
    }
  } catch (error) {
    safeCatch("cline usage: /users/me/plan request failed", error)
  }

  return {
    provider: "cline-pass",
    fetchedAt: Date.now(),
    limits,
    metadata: {
      ...(user.email ? { email: user.email } : {}),
      ...(user.accountId ? { accountId: user.accountId } : {}),
    },
  }
}

export const clineUsageProvider: UsageProvider = {
  id: "cline-pass",
  fetchUsage: fetchClineUsage,
  supports: (credential) => credential.type === "api_key" && !!credential.apiKey,
}
