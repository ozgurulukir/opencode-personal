import { BlackUsageLimitError, CreditsError, GoUsageLimitError, MonthlyLimitError, UserLimitError } from "./error"
import { BlackData } from "@opencode-ai/console-core/black.js"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { Subscription } from "@opencode-ai/console-core/subscription.js"
import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"

export type BillingSource = "anonymous" | "free" | "byok" | "subscription" | "lite" | "balance"
export type AuthInfo = Record<string, any>

export function validateBilling(
  authInfo: any,
  modelInfo: { allowAnonymous?: boolean },
  deps: {
    t: (key: any, params?: Record<string, string | number>) => string
    modelList: "lite" | "full"
  },
): BillingSource {
  if (!authInfo) return "anonymous"
  if (authInfo.provider?.credentials) return "byok"
  if (authInfo.isFree) return "free"
  if (modelInfo.allowAnonymous) return "free"

  const formatRetryTime = (seconds: number) => {
    const days = Math.floor(seconds / 86400)
    if (days >= 1) return `${days} day${days > 1 ? "s" : ""}`
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.ceil((seconds % 3600) / 60)
    if (hours >= 1) return `${hours}hr ${minutes}min`
    return `${minutes}min`
  }

  if (authInfo.billing?.subscription && authInfo.black) {
    try {
      const sub = authInfo.black
      const plan = String(authInfo.billing.subscription.plan ?? "20") as "20" | "100" | "200"

      if (sub.fixedUsage && sub.timeFixedUpdated) {
        const blackData = BlackData.getLimits({ plan })
        const result = Subscription.analyzeWeeklyUsage({
          limit: blackData.fixedLimit,
          usage: sub.fixedUsage,
          timeUpdated: sub.timeFixedUpdated,
        })
        if (result.status === "rate-limited")
          throw new BlackUsageLimitError(
            deps.t("zen.api.error.subscriptionQuotaExceeded", {
              retryIn: formatRetryTime(result.resetInSec),
            }),
            result.resetInSec,
          )
      }

      if (sub.rollingUsage && sub.timeRollingUpdated) {
        const blackData = BlackData.getLimits({ plan })
        const result = Subscription.analyzeRollingUsage({
          limit: blackData.rollingLimit,
          window: blackData.rollingWindow,
          usage: sub.rollingUsage,
          timeUpdated: sub.timeRollingUpdated,
        })
        if (result.status === "rate-limited")
          throw new BlackUsageLimitError(
            deps.t("zen.api.error.subscriptionQuotaExceeded", {
              retryIn: formatRetryTime(result.resetInSec),
            }),
            result.resetInSec,
          )
      }

      return "subscription"
    } catch (e) {
      if (!authInfo.billing.subscription.useBalance) throw e
    }
  }

  if (deps.modelList === "lite" && authInfo.billing?.lite && authInfo.lite) {
    try {
      const consoleGoUrl = `https://opencode.ai/workspace/${authInfo.workspaceID}/go`
      const sub = authInfo.lite
      const liteData = LiteData.getLimits()

      if (sub.weeklyUsage && sub.timeWeeklyUpdated) {
        const result = Subscription.analyzeWeeklyUsage({
          limit: liteData.weeklyLimit,
          usage: sub.weeklyUsage,
          timeUpdated: sub.timeWeeklyUpdated,
        })
        if (result.status === "rate-limited")
          throw new GoUsageLimitError(
            deps.t("zen.api.error.goSubscriptionWeeklyLimitExceeded", {
              retryIn: formatRetryTime(result.resetInSec),
              consoleGoUrl,
            }),
            authInfo.workspaceID,
            "weekly",
            result.resetInSec,
          )
      }

      if (sub.monthlyUsage && sub.timeMonthlyUpdated && sub.timeCreated) {
        const result = Subscription.analyzeMonthlyUsage({
          limit: liteData.monthlyLimit,
          usage: sub.monthlyUsage,
          timeUpdated: sub.timeMonthlyUpdated,
          timeSubscribed: sub.timeCreated,
        })
        if (result.status === "rate-limited")
          throw new GoUsageLimitError(
            deps.t("zen.api.error.goSubscriptionMonthlyLimitExceeded", {
              retryIn: formatRetryTime(result.resetInSec),
              consoleGoUrl,
            }),
            authInfo.workspaceID,
            "monthly",
            result.resetInSec,
          )
      }

      if (sub.rollingUsage && sub.timeRollingUpdated) {
        const result = Subscription.analyzeRollingUsage({
          limit: liteData.rollingLimit,
          window: liteData.rollingWindow,
          usage: sub.rollingUsage,
          timeUpdated: sub.timeRollingUpdated,
        })
        if (result.status === "rate-limited")
          throw new GoUsageLimitError(
            deps.t("zen.api.error.goSubscriptionRollingLimitExceeded", {
              retryIn: formatRetryTime(result.resetInSec),
              consoleGoUrl,
            }),
            authInfo.workspaceID,
            "5 hour",
            result.resetInSec,
          )
      }

      return "lite"
    } catch (e) {
      if (!authInfo.billing.lite.useBalance) throw e
    }
  }

  const billing = authInfo.billing
  const billingUrl = `https://opencode.ai/workspace/${authInfo.workspaceID}/billing`
  const membersUrl = `https://opencode.ai/workspace/${authInfo.workspaceID}/members`
  if (!billing.paymentMethodID && billing.balance <= 0)
    throw new CreditsError(deps.t("zen.api.error.noPaymentMethod", { billingUrl }))
  if (billing.balance <= 0) throw new CreditsError(deps.t("zen.api.error.insufficientBalance", { billingUrl }))

  const now = new Date()
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth()
  if (
    billing.monthlyLimit &&
    billing.monthlyUsage &&
    billing.timeMonthlyUsageUpdated &&
    billing.monthlyUsage >= centsToMicroCents(billing.monthlyLimit * 100) &&
    currentYear === billing.timeMonthlyUsageUpdated.getUTCFullYear() &&
    currentMonth === billing.timeMonthlyUsageUpdated.getUTCMonth()
  )
    throw new MonthlyLimitError(
      deps.t("zen.api.error.workspaceMonthlyLimitReached", {
        amount: billing.monthlyLimit,
        billingUrl,
      }),
    )

  if (
    authInfo.user.monthlyLimit &&
    authInfo.user.monthlyUsage &&
    authInfo.user.timeMonthlyUsageUpdated &&
    authInfo.user.monthlyUsage >= centsToMicroCents(authInfo.user.monthlyLimit * 100) &&
    currentYear === authInfo.user.timeMonthlyUsageUpdated.getUTCFullYear() &&
    currentMonth === authInfo.user.timeMonthlyUsageUpdated.getUTCMonth()
  )
    throw new UserLimitError(
      deps.t("zen.api.error.userMonthlyLimitReached", {
        amount: authInfo.user.monthlyLimit,
        membersUrl,
      }),
    )

  return "balance"
}
