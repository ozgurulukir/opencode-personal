import type { APIEvent } from "@solidjs/start/server"
import { Database } from "@opencode-ai/console-core/drizzle/index.js"
import { ZenData } from "@opencode-ai/console-core/model.js"
import { i18n, type Key } from "~/i18n"
import { localeFromRequest } from "~/lib/language"
import { logger } from "./logger"
import { parseRequest } from "./request"
import { handleNonStreamingResponse, createStreamingResponse } from "./response"
import { createStreamPartConverter } from "./provider/provider"
import { mapErrorToResponse } from "./error-mapping"
import { executeRetriableRequest } from "./retry"
import { setupRequest } from "./setup"
import { reload } from "./reload"
import { trackUsage } from "./usage"
import { authenticate } from "./auth"
import { validateBilling } from "./billing"
import { validateModel } from "./model"
import { createDataDumper } from "./dataDumper"
import { createRateLimiter as createIpRateLimiter } from "./ipRateLimiter"
import { createRateLimiter as createKeyRateLimiter } from "./keyRateLimiter"
import { createStickyTracker } from "./stickyProviderTracker"
import { createTrialLimiter } from "./trialLimiter"
import { createModelTpmLimiter } from "./modelTpmLimiter"

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
    const {
      zenData,
      modelInfo,
      dataDumper,
      trialLimiter,
      trialProviders,
      rateLimiter,
      stickyTracker,
      stickyProvider,
      authInfo,
      billingSource,
      modelTpmLimiter,
      modelTpmLimits,
    } = await setupRequest({
      model,
      ip,
      sessionId,
      requestId,
      projectId,
      zenApiKey,
      modelList: opts.modelList,
      format: opts.format,
      request: input.request,
      ADMIN_WORKSPACES,
      t,
      Database,
      logger,
      ZenData,
      validateModel,
      createDataDumper,
      createTrialLimiter,
      createIpRateLimiter,
      createKeyRateLimiter,
      createStickyTracker,
      authenticate,
      validateBilling,
      createModelTpmLimiter,
    })

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
