import { ModelError } from "./error"
import { anthropicHelper } from "./provider/anthropic"
import { googleHelper } from "./provider/google"
import { openaiHelper } from "./provider/openai"
import { oaCompatHelper } from "./provider/openai-compatible"

type ModelProvider = {
  id: string
  model: string
  priority?: number
  weight?: number
  disabled?: boolean
  storeModel?: string
  tpmLimit?: number
}

type ZenProvider = {
  api: string
  apiKey: string | Record<string, string>
  format?: string
  adjustCacheUsage?: boolean
}

type RetryOptions = {
  excludeProviders: string[]
  retryCount: number
}

export function selectProvider(
  reqModel: string,
  zenData: { providers: Record<string, ZenProvider> },
  authInfo: { workspaceID?: string; provider?: { credentials?: unknown } | null } | undefined,
  modelInfo: { id: string; providers: ModelProvider[]; fallbackProvider?: string; byokProvider?: string },
  ip: string,
  sessionId: string,
  trialProviders: string[] | undefined,
  retry: RetryOptions,
  stickyProvider: string | undefined,
  modelTpmLimits: Record<string, number> | undefined,
  deps: {
    t: (key: any, params?: Record<string, string | number>) => string
    opts: { format: string }
    logger: { metric: (obj: Record<string, unknown>) => void }
  },
) {
  const modelProvider = (() => {
    if (authInfo?.provider?.credentials) {
      return modelInfo.providers.find((provider) => provider.id === modelInfo.byokProvider)
    }

    if (stickyProvider) {
      const provider = modelInfo.providers.find((provider) => provider.id === stickyProvider)
      if (provider) return provider
    }

    if (trialProviders) {
      const trialProvider = trialProviders[Math.floor(Math.random() * trialProviders.length)]
      const provider = modelInfo.providers.find((provider) => provider.id === trialProvider)
      if (provider) return provider
    }

    if (retry.retryCount !== 3) {
      let topPriority = Infinity
      const providers = modelInfo.providers
        .filter((provider) => !provider.disabled)
        .filter((provider) => provider.weight !== 0)
        .filter((provider) => !retry.excludeProviders.includes(provider.id))
        .filter((provider) => {
          if (!provider.tpmLimit) return true
          const usage = modelTpmLimits?.[`${provider.id}/${provider.model}`] ?? 0
          return usage < provider.tpmLimit * 1_000_000
        })
        .map((provider) => {
          topPriority = Math.min(topPriority, provider.priority ?? Infinity)
          return provider
        })
        .filter((p) => (p.priority ?? Infinity) <= topPriority)
        .flatMap((provider) => Array(provider.weight ?? 1).fill(provider))

      const identifier = sessionId.length ? sessionId : ip
      let h = 0
      const l = identifier.length
      for (let i = l - 4; i < l; i++) {
        h = (h * 31 + identifier.charCodeAt(i)) | 0
      }
      const index = (h >>> 0) % providers.length
      const provider = providers[index || 0]
      if (provider) return provider
    }

    return modelInfo.providers.find((provider) => provider.id === modelInfo.fallbackProvider)
  })()

  if (!modelProvider) throw new ModelError(deps.t("zen.api.error.noProviderAvailable"))
  if (!(modelProvider.id in zenData.providers))
    throw new ModelError(deps.t("zen.api.error.providerNotSupported", { provider: modelProvider.id }))

  const providerProps = zenData.providers[modelProvider.id]
  return {
    ...modelProvider,
    ...providerProps,
    ...(() => {
      const opts = {
        reqModel,
        providerModel: modelProvider.model,
        adjustCacheUsage: providerProps.adjustCacheUsage,
        workspaceID: authInfo?.workspaceID,
      }
      const format = providerProps.format
      if (format === "anthropic") return anthropicHelper(opts)
      if (format === "google") return googleHelper(opts)
      if (format === "openai") return openaiHelper(opts)
      return oaCompatHelper(opts)
    })(),
  }
}
