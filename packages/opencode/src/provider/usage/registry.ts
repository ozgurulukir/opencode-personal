import type { Auth } from "@/auth"
import type { UsageProvider, UsageReport, UsageCredential } from "./types"
import { claudeUsageProvider } from "./claude"
import { zaiUsageProvider } from "./zai"
import { clineUsageProvider } from "./cline"
import { openaiUsageProvider } from "./openai"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "usage" })

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
    } else if (entry.type === "api" && entry.key) {
      result.push({
        providerId: usageProviderId,
        credential: { type: "api_key", apiKey: entry.key },
      })
    } else if (entry.type === "wellknown" && entry.token) {
      result.push({
        providerId: usageProviderId,
        credential: { type: "api_key", apiKey: entry.token },
      })
    }
  }
  return result
}

/** Fetch usage reports from all providers that support the available credentials. */
export async function fetchUsageReports(auth: Record<string, Auth.Info>): Promise<UsageReport[]> {
  const credentials = authCredentials(auth)

  const reports = await Promise.all(
    credentials.flatMap(({ providerId, credential }) =>
      providers
        .filter((provider) => provider.id === providerId && provider.supports(credential))
        .map(async (provider): Promise<UsageReport | null> => {
          try {
            return await provider.fetchUsage(credential)
          } catch (err) {
            log.warn("failed to fetch provider usage report", { providerId, error: err })
            return null
          }
        }),
    ),
  )

  return reports.filter((report): report is UsageReport => report !== null)
}
