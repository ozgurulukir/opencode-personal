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
 * Parses the documented `GET /api/v1/users/me` payload
 * (`{ id, email?, name?, active_account_id? }`). Returns `null` for
 * non-object payloads or a missing/empty `id`, since the id is required to
 * address the subsequent balance call.
 */
export function parseCurrentUser(raw: unknown): CurrentUser | null {
  if (!raw || typeof raw !== "object") return null
  const record = raw as Record<string, unknown>
  const id = typeof record.id === "string" ? record.id : undefined
  if (!id) return null
  return {
    id,
    ...(typeof record.email === "string" ? { email: record.email } : {}),
    ...(typeof record.active_account_id === "string" ? { accountId: record.active_account_id } : {}),
  }
}

/**
 * Maps the `/api/v1/users/{id}/balance` payload to a `UsageLimit`.
 *
 * The Cline docs do not publish a response schema for this endpoint, so this
 * stub accepts `null`/non-object payloads and returns `null` rather than
 * inventing field names. Once a real 200 response is captured, map it to
 * `{ id: "cline-pass:balance", label: "ClinePass Balance",
 *    scope: { provider: "cline-pass" }, amount: { remaining, unit: "usd" } }`
 * — a prepaid balance has no denominator or reset window, so `usedFraction`
 * stays `undefined`.
 */
function parseBalanceLimit(payload: unknown): UsageLimit | null {
  if (!payload || typeof payload !== "object") return null
  return null
}

/**
 * Fetches the ClinePass credit balance as a two-call chain: resolve the user
 * id via `GET /users/me` (documented), then read `GET /users/{id}/balance`.
 *
 * The balance→`UsageLimit` mapping is intentionally gated: the endpoint's
 * response shape is undocumented, so `parseBalanceLimit` is inert until a real
 * response is captured. With no mapped limit the `limits` array is empty and
 * the whole call returns `null`, so the `/usage` dialog simply omits the
 * ClinePass section (graceful degradation). The documented `users/me`
 * resolution ships fully implemented and unit-tested via `parseCurrentUser`.
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
