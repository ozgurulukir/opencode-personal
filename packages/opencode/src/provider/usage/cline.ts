import * as Log from "@opencode-ai/core/util/log"
import type { UsageProvider, UsageReport, UsageLimit, UsageCredential } from "./types"

const CLINE_BASE_URL = "https://api.cline.bot"
const USER_ME_PATH = "/api/v1/users/me"
const USER_BALANCE_PATH = "/api/v1/users"

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

/**
 * Maps the captured `GET /api/v1/users/{id}/balance` payload
 * (`{ data: { userId, balance }, success: true }`, observed 2026-09-28) to a
 * `UsageLimit`. `balance` is an integer credit count; Cline credits price at
 * $0.01 (inferred — the docs publish no unit), so it renders as
 * `$<balance>/100 left`. A prepaid balance has no denominator or reset
 * window, so `usedFraction` stays `undefined`.
 */
function parseBalanceLimit(payload: unknown): UsageLimit | null {
  if (!payload || typeof payload !== "object") return null
  const record = payload as Record<string, unknown>
  if (!record.data || typeof record.data !== "object") return null
  const balance = (record.data as Record<string, unknown>).balance
  if (typeof balance !== "number" || !Number.isFinite(balance)) return null
  return {
    id: "cline-pass:balance",
    label: "ClinePass Balance",
    scope: { provider: "cline-pass" },
    amount: { remaining: balance / 100, unit: "usd" },
  }
}

/**
 * Fetches the ClinePass credit balance as a two-call chain: resolve the user
 * id via `GET /users/me`, then read `GET /users/{id}/balance`. The live API
 * wraps both payloads in a `{ data, success }` envelope the docs omit; the
 * `users/me` parser also accepts the documented flat profile shape. Returns
 * `null` on any failure (non-OK response, unparseable payload, empty limits)
 * so the `/usage` dialog simply omits the ClinePass section — graceful
 * degradation, never a broken dialog.
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

  const limits = [balance].filter((limit): limit is UsageLimit => limit !== null)
  if (limits.length === 0) return null

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
