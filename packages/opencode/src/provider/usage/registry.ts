import type { Auth } from "@/auth"
import type { UsageProvider, UsageReport, UsageCredential } from "./types"
import { claudeUsageProvider } from "./claude"
import { zaiUsageProvider } from "./zai"
import { clineUsageProvider } from "./cline"
import { openaiUsageProvider } from "./openai"

/** All registered usage providers. */
const providers: UsageProvider[] = [claudeUsageProvider, zaiUsageProvider, clineUsageProvider, openaiUsageProvider]

/** Maps opencode provider IDs to usage provider IDs. */
const PROVIDER_ID_MAP: Record<string, string> = {
  anthropic: "anthropic",
  "zai-coding-plan": "zai",
  zai: "zai",
  "cline-pass": "cline-pass",
}

function authCredentials(auth: Record<string, Auth.Info>): { providerId: string; credential: UsageCredential }[] {
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
export async function fetchUsageReports(auth: Record<string, Auth.Info>): Promise<UsageReport[]> {
  const credentials = authCredentials(auth)
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
