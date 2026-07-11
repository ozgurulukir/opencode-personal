import type { APIEvent } from "@solidjs/start/server"
import { and, Database, eq, isNull, lt, or, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { BillingTable, LiteTable, SubscriptionTable, UsageTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { getMonthlyBounds, getWeekBounds } from "@opencode-ai/console-core/util/date.js"
import { Identifier } from "@opencode-ai/console-core/identifier.js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { validateBilling, type BillingSource } from "./billing"
import { authenticate } from "./auth"
import { selectProvider } from "./provider-selector"
import { validateModel } from "./model"
import { fetchWith429Retry } from "./http"
import { reload } from "./reload"
import { trackUsage } from "./usage"
import { validateModelSettings, updateProviderKey } from "./validation"
import { parseRequest } from "./request"
import { handleNonStreamingResponse, createStreamingResponse } from "./response"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { ZenData } from "@opencode-ai/console-core/model.js"
import { Subscription } from "@opencode-ai/console-core/subscription.js"
import { BlackData } from "@opencode-ai/console-core/black.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { ModelTable } from "@opencode-ai/console-core/schema/model.sql.js"
import { ProviderTable } from "@opencode-ai/console-core/schema/provider.sql.js"
import { logger } from "./logger"
import {
  AuthError,
  CreditsError,
  MonthlyLimitError,
  UserLimitError,
  ModelError,
  RateLimitError,
  FreeUsageLimitError,
  GoUsageLimitError,
  BlackUsageLimitError,
} from "./error"
import { createBodyConverter, createStreamPartConverter } from "./provider/provider"
import { anthropicHelper } from "./provider/anthropic"
import { googleHelper } from "./provider/google"
import { openaiHelper } from "./provider/openai"
import { oaCompatHelper } from "./provider/openai-compatible"
import { createRateLimiter as createIpRateLimiter } from "./ipRateLimiter"
import { createRateLimiter as createKeyRateLimiter } from "./keyRateLimiter"
import { createDataDumper } from "./dataDumper"
import { createTrialLimiter } from "./trialLimiter"
import { createStickyTracker } from "./stickyProviderTracker"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { Resource } from "@opencode-ai/console-resource"
import { i18n, type Key } from "~/i18n"
import { localeFromRequest } from "~/lib/language"
import { createModelTpmLimiter } from "./modelTpmLimiter"

type ZenData = Awaited<ReturnType<typeof ZenData.list>>
type RetryOptions = {
  excludeProviders: string[]
  retryCount: number
}

function resolve(text: string, params?: Record<string, string | number>) {
  if (!params) return text
  return text.replace(/\{\{(\w+)\}\}/g, (raw, key) => {
    const value = params[key]
    if (value === undefined || value === null) return raw
    return String(value)
  })
}

export async function handler(
  input: APIEvent,
  opts: {
    format: ZenData.Format
    modelList: "lite" | "full"
    parseApiKey: (headers: Headers) => string | undefined
    parseModel: (url: string, body: any) => string
    parseVariant: (url: string, body: any) => string | undefined
    parseIsStream: (url: string, body: any) => boolean
  },
) {
  type AuthInfo = Awaited<ReturnType<typeof authenticate>>
  type ModelInfo = Awaited<ReturnType<typeof validateModel>>
  type ProviderInfo = Awaited<ReturnType<typeof selectProvider>>

  const MAX_FAILOVER_RETRIES = 3
  const MAX_429_RETRIES = 3
  const dict = i18n(localeFromRequest(input.request))
  const t = (key: Key, params?: Record<string, string | number>) => resolve(dict[key], params)
  const ADMIN_WORKSPACES = [
    "wrk_01K46JDFR0E75SG2Q8K172KF3Y", // anomaly
    "wrk_01K6W1A3VE0KMNVSCQT43BG2SX", // benchmark
    "wrk_01KKZDKDWCS1VTJF8QTX62DD50", // contributors
  ]

  try {
    const req = await parseRequest(input, opts)
    const body = req.body
    const model = req.model
    const isStream = req.isStream
    const ip = req.ip
    const zenApiKey = req.zenApiKey
    const sessionId = req.sessionId
    const requestId = req.requestId
    const projectId = req.projectId
    const zenData = ZenData.list(opts.modelList)
    const modelInfo = validateModel(zenData, model, { format: opts.format, t })
    const dataDumper = createDataDumper(sessionId, requestId, projectId)
    const trialLimiter = createTrialLimiter(modelInfo.trialProvider, ip)
    const trialProviders = await trialLimiter?.check()
    const rateLimiter = modelInfo.allowAnonymous
      ? createIpRateLimiter(modelInfo.id, modelInfo.rateLimit, ip, input.request)
      : createKeyRateLimiter(modelInfo.id, modelInfo.rateLimit, zenApiKey, input.request)
    await rateLimiter?.check()
    const stickyTracker = createStickyTracker(modelInfo.stickyProvider, sessionId)
    const stickyProvider = await stickyTracker?.get()
    const authInfo = await authenticate(modelInfo, zenApiKey, { t, Database, ADMIN_WORKSPACES })
    const billingSource = validateBilling(authInfo as any, modelInfo, { t, modelList: opts.modelList })
    logger.metric({ source: billingSource })
    const modelTpmLimiter = createModelTpmLimiter(modelInfo.providers)
    const modelTpmLimits = await modelTpmLimiter?.check()

    const retriableRequest = async (retry: RetryOptions = { excludeProviders: [], retryCount: 0 }) => {
      const providerInfo = selectProvider(
        model,
        zenData,
        authInfo,
        modelInfo,
        ip,
        sessionId,
        trialProviders,
        retry,
        stickyProvider,
        modelTpmLimits,
        { t, opts, logger },
      )
      validateModelSettings(billingSource, authInfo, t)
      updateProviderKey(authInfo, providerInfo)
      logger.metric({
        provider: providerInfo.id,
        "provider.model": providerInfo.model,
      })

      const startTimestamp = Date.now()
      const reqUrl = providerInfo.modifyUrl(providerInfo.api, isStream)
      const reqBody = JSON.stringify(
        providerInfo.modifyBody({
          ...createBodyConverter(opts.format, providerInfo.format)(body),
          model: providerInfo.model,
          ...(() => {
            const replacer = (obj: Record<string, any>): Record<string, any> =>
              Object.fromEntries(
                Object.entries(obj).flatMap(([k, v]) => {
                  if (Array.isArray(v)) return [[k, v]]
                  if (typeof v === "object") return [[k, replacer(v)]]
                  if (typeof v === "string") {
                    if (v === "$ip") return [[k, ip]]
                    if (v === "$workspace") return authInfo?.workspaceID ? [[k, authInfo?.workspaceID]] : []
                    if (v === "$session") return sessionId ? [[k, sessionId]] : []
                    if (v.startsWith("$header.")) {
                      const headerValue = input.request.headers.get(v.slice(8))
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
      logger.debug("REQUEST URL: " + reqUrl)
      logger.debug("REQUEST: " + reqBody.substring(0, 300) + "...")
      const res = await fetchWith429Retry(reqUrl, {
        method: "POST",
        headers: (() => {
          const headers = new Headers(input.request.headers)
          providerInfo.modifyHeaders(headers, body, providerInfo.apiKey)
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
        logger.metric({
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
        modelInfo.stickyProvider !== "strict" &&
        modelInfo.fallbackProvider &&
        providerInfo.id !== modelInfo.fallbackProvider
      ) {
        return retriableRequest({
          excludeProviders: [...retry.excludeProviders, providerInfo.id],
          retryCount: retry.retryCount + 1,
        })
      }

      return { providerInfo, reqBody, res, startTimestamp }
    }

    const { providerInfo, reqBody, res, startTimestamp } = await retriableRequest()

    // Store model request
    dataDumper?.provideModel(providerInfo.storeModel)
    dataDumper?.provideRequest(reqBody)

    // Store sticky provider
    await stickyTracker?.set(providerInfo.id)

    const responseDeps = {
      providerInfo,
      modelInfo,
      billingSource,
      authInfo,
      sessionId,
      format: opts.format,
      rateLimiter,
      trialLimiter,
      modelTpmLimiter,
      dataDumper,
      Database,
      logger,
      trackUsage,
      reload,
    }

    if (!isStream || [400, 404, 429].includes(res.status)) {
      return handleNonStreamingResponse(res, responseDeps)
    }

    const streamConverter = createStreamPartConverter(providerInfo.format, opts.format)
    return createStreamingResponse(res, startTimestamp, streamConverter, responseDeps)
  } catch (error: any) {
    logger.metric({
      "error.type": error.constructor.name,
      "error.message": error.message,
      "error.cause": error.cause?.toString(),
    })
    if (error.message.startsWith("Failed query")) {
      try {
        logger.metric({
          "error.cause2": JSON.stringify(error.cause),
        })
      } catch {}
    }

    // Note: both top level "type" and "error.type" fields are used by the @ai-sdk/anthropic client to render the error message.
    if (
      error instanceof AuthError ||
      error instanceof CreditsError ||
      error instanceof MonthlyLimitError ||
      error instanceof UserLimitError ||
      error instanceof ModelError
    )
      return new Response(
        JSON.stringify({
          type: "error",
          error: { type: error.constructor.name, message: error.message },
        }),
        { status: 401 },
      )

    if (
      error instanceof RateLimitError ||
      error instanceof FreeUsageLimitError ||
      error instanceof GoUsageLimitError ||
      error instanceof BlackUsageLimitError
    ) {
      const headers = new Headers()
      if (error.retryAfter) {
        headers.set("retry-after", String(error.retryAfter))
      }
      return new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: error.constructor.name,
            message: error.message,
          },
          metadata:
            error instanceof GoUsageLimitError
              ? {
                  workspace: error.workspace,
                  limitName: error.limitName,
                }
              : {},
        }),
        { status: 429, headers },
      )
    }

    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "error",
          message: "Internal server error",
        },
      }),
      { status: 500 },
    )
  }
}
