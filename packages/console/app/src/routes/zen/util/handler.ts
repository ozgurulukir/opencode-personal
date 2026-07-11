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
import { validateModel } from "./model"
import { reload } from "./reload"
import { trackUsage } from "./usage"
import { parseRequest } from "./request"
import { handleNonStreamingResponse, createStreamingResponse } from "./response"
import { mapErrorToResponse } from "./error-mapping"
import { executeRetriableRequest } from "./retry"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { ZenData } from "@opencode-ai/console-core/model.js"
import { Subscription } from "@opencode-ai/console-core/subscription.js"
import { BlackData } from "@opencode-ai/console-core/black.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { ModelTable } from "@opencode-ai/console-core/schema/model.sql.js"
import { ProviderTable } from "@opencode-ai/console-core/schema/provider.sql.js"
import { logger } from "./logger"
import { createStreamPartConverter } from "./provider/provider"
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

    const { providerInfo, reqBody, res, startTimestamp } = await executeRetriableRequest({
      model,
      zenData,
      authInfo,
      modelInfo,
      ip,
      sessionId,
      trialProviders,
      stickyProvider,
      modelTpmLimits,
      body,
      isStream,
      billingSource,
      request: input.request,
      opts,
      t,
      logger,
    })

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
  } catch (error) {
    return mapErrorToResponse(error, logger)
  }
}
