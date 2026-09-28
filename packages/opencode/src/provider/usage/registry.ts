import path from "path"
import { Global } from "@opencode-ai/core/global"
import type { UsageProvider, UsageReport, UsageCredential } from "./types"
import { claudeUsageProvider } from "./claude"
import { zaiUsageProvider } from "./zai"
import { clineUsageProvider } from "./cline"

export * as UsageTypes from "./types"
export { claudeUsageProvider } from "./claude"
export { zaiUsageProvider } from "./zai"
export { clineUsageProvider } from "./cline"
export { resolveUsedFraction } from "./types"
export type { UsageReport, UsageLimit, UsageAmount, UsageWindow, UsageProvider, UsageCredential } from "./types"

/** All registered usage providers. */
const providers: UsageProvider[] = [claudeUsageProvider, zaiUsageProvider, clineUsageProvider]

/** Maps opencode provider IDs to usage provider IDs. */
const PROVIDER_ID_MAP: Record<string, string> = {
  anthropic: "anthropic",
  "zai-coding-plan": "zai",
  zai: "zai",
  "cline-pass": "cline-pass",
}

/** Auth entry from auth.json. */
interface AuthEntry {
  type: "oauth" | "api" | "wellknown"
  access?: string
  refresh?: string
  key?: string
  accountId?: string
}

/** Read auth.json and convert to UsageCredential keyed by usage provider ID. */
function readAuthCredentials(): { providerId: string; credential: UsageCredential }[] {
  const file = path.join(Global.Path.data, "auth.json")
  let auth: Record<string, AuthEntry>
  try {
    const data = require("fs").readFileSync(file, "utf-8")
    auth = JSON.parse(data)
  } catch {
    return []
  }

  const result: { providerId: string; credential: UsageCredential }[] = []
  for (const [opencodeId, entry] of Object.entries(auth)) {
    const usageProviderId = PROVIDER_ID_MAP[opencodeId] ?? opencodeId
    if (entry.type === "oauth" && entry.access) {
      result.push({
        providerId: usageProviderId,
        credential: { type: "oauth", accessToken: entry.access, accountId: entry.accountId },
      })
    } else if ((entry.type === "api" || entry.type === "wellknown") && entry.key) {
      result.push({
        providerId: usageProviderId,
        credential: { type: "api_key", apiKey: entry.key },
      })
    }
  }
  return result
}

/** Fetch usage reports from all providers that support the available credentials. */
export async function fetchUsageReports(): Promise<UsageReport[]> {
  const credentials = readAuthCredentials()
  const reports: UsageReport[] = []

  for (const { providerId, credential } of credentials) {
    for (const provider of providers) {
      if (provider.id !== providerId) continue
      if (!provider.supports(credential)) continue
      try {
        const report = await provider.fetchUsage(credential)
        if (report) reports.push(report)
      } catch {}
    }
  }

  return reports
}
