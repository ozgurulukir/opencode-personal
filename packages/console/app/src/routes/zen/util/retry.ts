import type { ZenData } from "@opencode-ai/console-core/model.js"
import type { BillingSource } from "./billing"
import { fetchWith429Retry } from "./http"
import { selectProvider } from "./provider-selector"
import { createBodyConverter } from "./provider/provider"
import { validateModelSettings, updateProviderKey } from "./validation"
import { validateModel } from "./model"
import { authenticate } from "./auth"
import type { Key } from "~/i18n"

export type RetryOptions = {
  excludeProviders: string[]
  retryCount: number
}

export type RetryDeps = {
  model: string
  zenData: Awaited<ReturnType<typeof ZenData.list>>
  authInfo: Awaited<ReturnType<typeof authenticate>>
  modelInfo: Awaited<ReturnType<typeof validateModel>>
  ip: string
  sessionId: string
  trialProviders: any
  stickyProvider: any
  modelTpmLimits: any
  body: any
  isStream: boolean
  billingSource: BillingSource
  request: Request
  opts: {
    format: ZenData.Format
    parseApiKey: (headers: Headers) => string | undefined
  }
  t: (key: Key, params?: Record<string, string | number>) => string
  logger: {
    metric: (values: Record<string, any>) => void
    debug: (message: string) => void
  }
  selectProvider?: typeof selectProvider
  validateModelSettings?: typeof validateModelSettings
  updateProviderKey?: typeof updateProviderKey
  createBodyConverter?: typeof createBodyConverter
  fetchWith429Retry?: typeof fetchWith429Retry
}

export async function executeRetriableRequest(
  deps: RetryDeps,
  retry: RetryOptions = { excludeProviders: [], retryCount: 0 },
): Promise<{ providerInfo: Awaited<ReturnType<typeof selectProvider>>; reqBody: string; res: Response; startTimestamp: number }> {
  const select = deps.selectProvider ?? selectProvider
  const validateSettings = deps.validateModelSettings ?? validateModelSettings
  const updateKey = deps.updateProviderKey ?? updateProviderKey
  const bodyConverter = deps.createBodyConverter ?? createBodyConverter
  const fetchRetry = deps.fetchWith429Retry ?? fetchWith429Retry

  const providerInfo = select(
    deps.model,
    deps.zenData,
    deps.authInfo,
    deps.modelInfo,
    deps.ip,
    deps.sessionId,
    deps.trialProviders,
    retry,
    deps.stickyProvider,
    deps.modelTpmLimits,
    { t: deps.t, opts: deps.opts, logger: deps.logger },
  )
  validateSettings(deps.billingSource, deps.authInfo, deps.t)
  updateKey(deps.authInfo, providerInfo)
  deps.logger.metric({
    provider: providerInfo.id,
    "provider.model": providerInfo.model,
  })

  const startTimestamp = Date.now()
  const reqUrl = providerInfo.modifyUrl(providerInfo.api, deps.isStream)
  const reqBody = JSON.stringify(
    providerInfo.modifyBody({
      ...bodyConverter(deps.opts.format, providerInfo.format)(deps.body),
      model: providerInfo.model,
      ...(() => {
        const replacer = (obj: Record<string, any>): Record<string, any> =>
          Object.fromEntries(
            Object.entries(obj).flatMap(([k, v]) => {
              if (Array.isArray(v)) return [[k, v]]
              if (typeof v === "object") return [[k, replacer(v)]]
              if (typeof v === "string") {
                if (v === "$ip") return [[k, deps.ip]]
                if (v === "$workspace")
                  return deps.authInfo?.workspaceID ? [[k, deps.authInfo?.workspaceID]] : []
                if (v === "$session") return deps.sessionId ? [[k, deps.sessionId]] : []
                if (v.startsWith("$header.")) {
                  const headerValue = deps.request.headers.get(v.slice(8))
                  return headerValue ? [[k, headerValue]] : []
                }
              }
              return [[k, v]]
            }),
          )
        return replacer(providerInfo.payloadModifier ?? {})
      })(),
    }),
  )
  deps.logger.debug("REQUEST URL: " + reqUrl)
  deps.logger.debug("REQUEST: " + reqBody.substring(0, 300) + "...")
  const res = await fetchRetry(reqUrl, {
    method: "POST",
    headers: (() => {
      const headers = new Headers(deps.request.headers)
      providerInfo.modifyHeaders(headers, deps.body, providerInfo.apiKey)
      Object.entries(providerInfo.headerMappings ?? {}).forEach(([k, v]) => {
        const mappedValue = headers.get(v as string)
        if (typeof mappedValue === "string") headers.set(k, mappedValue)
      })
      headers.delete("host")
      headers.delete("content-length")
      headers.delete("x-opencode-request")
      headers.delete("x-opencode-session")
      headers.delete("x-opencode-project")
      headers.delete("x-opencode-client")
      return headers
    })(),
    body: reqBody,
  })

  if (res.status !== 200) {
    deps.logger.metric({
      "llm.error.code": res.status,
      "llm.error.message": res.statusText,
    })
  }

  // Try another provider => stop retrying if using fallback provider
  if (
    res.status !== 200 &&
    // ie. 400 error is usually provider error like malformed request
    res.status !== 400 &&
    // ie. openai 404 error: Item with id 'msg_0ead8b004a3b165d0069436a6b6834819896da85b63b196a3f' not found.
    res.status !== 404 &&
    // ie. cannot change codex model providers mid-session
    deps.modelInfo.stickyProvider !== "strict" &&
    deps.modelInfo.fallbackProvider &&
    providerInfo.id !== deps.modelInfo.fallbackProvider
  ) {
    return executeRetriableRequest(deps, {
      excludeProviders: [...retry.excludeProviders, providerInfo.id],
      retryCount: retry.retryCount + 1,
    })
  }

  return { providerInfo, reqBody, res, startTimestamp }
}
