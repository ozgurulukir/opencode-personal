import type { ZenData } from "@opencode-ai/console-core/model.js"
import type { authenticate } from "./auth"
import type { validateBilling } from "./billing"
import type { createDataDumper } from "./dataDumper"
import type { createRateLimiter as createIpRateLimiter } from "./ipRateLimiter"
import type { createRateLimiter as createKeyRateLimiter } from "./keyRateLimiter"
import type { validateModel } from "./model"
import type { createModelTpmLimiter } from "./modelTpmLimiter"
import type { createStickyTracker } from "./stickyProviderTracker"
import type { createTrialLimiter } from "./trialLimiter"
import type { Key } from "~/i18n"

export type SetupDeps = {
  model: string
  ip: string
  sessionId: string
  requestId: string
  projectId: string
  zenApiKey: string | undefined
  modelList: "lite" | "full"
  format: ZenData.Format
  request: Request
  ADMIN_WORKSPACES: string[]
  t: (key: Key, params?: Record<string, string | number>) => string
  Database: { use: (fn: (tx: any) => Promise<any>) => Promise<any> }
  logger: {
    metric: (values: Record<string, any>) => void
  }
  ZenData: { list: typeof ZenData.list }
  validateModel: typeof validateModel
  createDataDumper: typeof createDataDumper
  createTrialLimiter: typeof createTrialLimiter
  createIpRateLimiter: typeof createIpRateLimiter
  createKeyRateLimiter: typeof createKeyRateLimiter
  createStickyTracker: typeof createStickyTracker
  authenticate: typeof authenticate
  validateBilling: typeof validateBilling
  createModelTpmLimiter: typeof createModelTpmLimiter
}

export async function setupRequest(deps: SetupDeps) {
  const zenData = deps.ZenData.list(deps.modelList)
  const modelInfo = deps.validateModel(zenData, deps.model, { format: deps.format, t: deps.t })
  const dataDumper = deps.createDataDumper(deps.sessionId, deps.requestId, deps.projectId)
  const trialLimiter = deps.createTrialLimiter(modelInfo.trialProvider, deps.ip)
  const trialProviders = await trialLimiter?.check()
  const rateLimiter = modelInfo.allowAnonymous
    ? deps.createIpRateLimiter(modelInfo.id, modelInfo.rateLimit, deps.ip, deps.request)
    : deps.createKeyRateLimiter(modelInfo.id, modelInfo.rateLimit, deps.zenApiKey, deps.request)
  await rateLimiter?.check()
  const stickyTracker = deps.createStickyTracker(modelInfo.stickyProvider, deps.sessionId)
  const stickyProvider = await stickyTracker?.get()
  const authInfo = await deps.authenticate(modelInfo, deps.zenApiKey, {
    t: deps.t,
    Database: deps.Database,
    ADMIN_WORKSPACES: deps.ADMIN_WORKSPACES,
  })
  const billingSource = deps.validateBilling(authInfo, modelInfo, { t: deps.t, modelList: deps.modelList })
  deps.logger.metric({ source: billingSource })
  const modelTpmLimiter = deps.createModelTpmLimiter(modelInfo.providers)
  const modelTpmLimits = await modelTpmLimiter?.check()

  return {
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
  }
}
