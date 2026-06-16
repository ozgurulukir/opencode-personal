import path from "path"
import { Global } from "@opencode-ai/core/global"
import type { UsageProvider, UsageReport, UsageCredential } from "./types"
import { claudeUsageProvider } from "./claude"

export * as UsageTypes from "./types"
export { claudeUsageProvider } from "./claude"

/** All registered usage providers. */
const providers: UsageProvider[] = [claudeUsageProvider]

/** Auth entry from auth.json. */
interface AuthEntry {
  type: "oauth" | "api" | "wellknown"
  access?: string
  refresh?: string
  key?: string
  accountId?: string
}

/** Read auth.json and convert to UsageCredential. */
function readAuthCredentials(): Record<string, UsageCredential> {
  const file = path.join(Global.Path.data, "auth.json")
  try {
    const data = require("fs").readFileSync(file, "utf-8")
    const auth = JSON.parse(data) as Record<string, AuthEntry>
    const result: Record<string, UsageCredential> = {}
    for (const [providerId, entry] of Object.entries(auth)) {
      if (entry.type === "oauth" && entry.access) {
        result[providerId] = {
          type: "oauth",
          accessToken: entry.access,
          accountId: entry.accountId,
        }
      } else if (entry.type === "api" && entry.key) {
        result[providerId] = {
          type: "api_key",
          apiKey: entry.key,
        }
      }
    }
    return result
  } catch {
    return {}
  }
}

/** Fetch usage reports from all providers that support the available credentials. */
export async function fetchUsageReports(): Promise<UsageReport[]> {
  const credentials = readAuthCredentials()
  const reports: UsageReport[] = []

  for (const provider of providers) {
    for (const [providerId, credential] of Object.entries(credentials)) {
      if (!provider.supports(credential)) continue
      if (provider.id !== providerId && providerId !== "anthropic") continue

      try {
        const report = await provider.fetchUsage(credential)
        if (report) reports.push(report)
      } catch {}
    }
  }

  return reports
}
