import { and, eq, isNull, lt, or, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable, SubscriptionTable, UsageTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { LiteTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { Identifier } from "@opencode-ai/console-core/identifier.js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import { BlackData } from "@opencode-ai/console-core/black.js"
import { LiteData } from "@opencode-ai/console-core/lite.js"
import { Subscription } from "@opencode-ai/console-core/subscription.js"
import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { getMonthlyBounds, getWeekBounds } from "@opencode-ai/console-core/util/date.js"
import type { AuthInfo } from "./auth"

export async function trackUsage(
  sessionId: string,
  billingSource: string,
  authInfo: AuthInfo | undefined,
  modelInfo: { id: string },
  providerInfo: { id: string },
  usageInfo: {
    inputTokens: number
    outputTokens: number
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWrite5mTokens?: number
    cacheWrite1hTokens?: number
  },
  costInfo: {
    totalCostInCent: number
    inputCost: number
    outputCost: number
    cacheReadCost?: number
    cacheWrite5mCost?: number
    cacheWrite1hCost?: number
  },
  Database: { use: (fn: (tx: any) => Promise<any>) => Promise<any> },
  logger: { metric: (obj: Record<string, unknown>) => void },
) {
  const { inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWrite5mTokens, cacheWrite1hTokens } =
    usageInfo
  const { totalCostInCent, inputCost, outputCost, cacheReadCost, cacheWrite5mCost, cacheWrite1hCost } = costInfo

  logger.metric({
    "tokens.input": inputTokens,
    "tokens.output": outputTokens,
    "tokens.reasoning": reasoningTokens,
    "tokens.cache_read": cacheReadTokens,
    "tokens.cache_write_5m": cacheWrite5mTokens,
    "tokens.cache_write_1h": cacheWrite1hTokens,
    "cost.input.microcents": centsToMicroCents(inputCost),
    "cost.output.microcents": centsToMicroCents(outputCost),
    "cost.cache_read.microcents": cacheReadCost ? centsToMicroCents(cacheReadCost) : undefined,
    "cost.cache_write.microcents": cacheWrite5mCost ? centsToMicroCents(cacheWrite5mCost) : undefined,
    "cost.total.microcents": centsToMicroCents(totalCostInCent),
    "cost.input": Math.round(inputCost),
    "cost.output": Math.round(outputCost),
    "cost.cache_read": cacheReadCost ? Math.round(cacheReadCost) : undefined,
    "cost.cache_write_5m": cacheWrite5mCost ? Math.round(cacheWrite5mCost) : undefined,
    "cost.cache_write_1h": cacheWrite1hCost ? Math.round(cacheWrite1hCost) : undefined,
    "cost.total": Math.round(totalCostInCent),
  })

  if (billingSource === "anonymous") return

  const info = authInfo!
  const cost = centsToMicroCents(totalCostInCent)
  await Database.use((db) =>
    Promise.all([
      db.insert(UsageTable).values({
        workspaceID: info.workspaceID,
        id: Identifier.create("usage"),
        model: modelInfo.id,
        provider: providerInfo.id,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cacheReadTokens,
        cacheWrite5mTokens,
        cacheWrite1hTokens,
        cost,
        keyID: info.apiKeyId,
        sessionID: sessionId.substring(0, 30),
        enrichment: (() => {
          if (billingSource === "subscription") return { plan: "sub" }
          if (billingSource === "byok") return { plan: "byok" }
          if (billingSource === "lite") return { plan: "lite" }
          return undefined
        })(),
      }),
      db
        .update(KeyTable)
        .set({ timeUsed: sql`now()` })
        .where(and(eq(KeyTable.workspaceID, info.workspaceID), eq(KeyTable.id, info.apiKeyId))),
      ...(() => {
        if (billingSource === "subscription") {
          const plan = info.billing.subscription!.plan as "20" | "100" | "200"
          const black = BlackData.getLimits({ plan })
          const week = getWeekBounds(new Date())
          const rollingWindowSeconds = black.rollingWindow * 3600
          return [
            db
              .update(SubscriptionTable)
              .set({
                fixedUsage: sql`
              CASE
                WHEN ${SubscriptionTable.timeFixedUpdated} >= ${week.start} THEN ${SubscriptionTable.fixedUsage} + ${cost}
                ELSE ${cost}
              END
            `,
                timeFixedUpdated: sql`now()`,
                rollingUsage: sql`
              CASE
                WHEN UNIX_TIMESTAMP(${SubscriptionTable.timeRollingUpdated}) >= UNIX_TIMESTAMP(now()) - ${rollingWindowSeconds} THEN ${SubscriptionTable.rollingUsage} + ${cost}
                ELSE ${cost}
              END
            `,
                timeRollingUpdated: sql`
              CASE
                WHEN UNIX_TIMESTAMP(${SubscriptionTable.timeRollingUpdated}) >= UNIX_TIMESTAMP(now()) - ${rollingWindowSeconds} THEN ${SubscriptionTable.timeRollingUpdated}
                ELSE now()
              END
            `,
              })
              .where(
                and(
                  eq(SubscriptionTable.workspaceID, info.workspaceID),
                  eq(SubscriptionTable.userID, info.user.id),
                ),
              ),
          ]
        }
        if (billingSource === "lite") {
          const lite = LiteData.getLimits()
          const week = getWeekBounds(new Date())
          const month = getMonthlyBounds(new Date(), info.lite!.timeCreated!)
          const rollingWindowSeconds = lite.rollingWindow * 3600
          return [
            db
              .update(LiteTable)
              .set({
                monthlyUsage: sql`
              CASE
                WHEN ${LiteTable.timeMonthlyUpdated} >= ${month.start} THEN ${LiteTable.monthlyUsage} + ${cost}
                ELSE ${cost}
              END
            `,
                timeMonthlyUpdated: sql`now()`,
                weeklyUsage: sql`
              CASE
                WHEN ${LiteTable.timeWeeklyUpdated} >= ${week.start} THEN ${LiteTable.weeklyUsage} + ${cost}
                ELSE ${cost}
              END
            `,
                timeWeeklyUpdated: sql`now()`,
                rollingUsage: sql`
              CASE
                WHEN UNIX_TIMESTAMP(${LiteTable.timeRollingUpdated}) >= UNIX_TIMESTAMP(now()) - ${rollingWindowSeconds} THEN ${LiteTable.rollingUsage} + ${cost}
                ELSE ${cost}
              END
            `,
                timeRollingUpdated: sql`
              CASE
                WHEN UNIX_TIMESTAMP(${LiteTable.timeRollingUpdated}) >= UNIX_TIMESTAMP(now()) - ${rollingWindowSeconds} THEN ${LiteTable.timeRollingUpdated}
                ELSE now()
              END
            `,
              })
              .where(and(eq(LiteTable.workspaceID, info.workspaceID), eq(LiteTable.userID, info.user.id))),
          ]
        }

        return [
          db
            .update(BillingTable)
            .set({
              balance:
                billingSource === "free" || billingSource === "byok"
                  ? sql`${BillingTable.balance} - ${0}`
                  : sql`${BillingTable.balance} - ${cost}`,
              monthlyUsage: sql`
            CASE
              WHEN MONTH(${BillingTable.timeMonthlyUsageUpdated}) = MONTH(now()) AND YEAR(${BillingTable.timeMonthlyUsageUpdated}) = YEAR(now()) THEN ${BillingTable.monthlyUsage} + ${cost}
              ELSE ${cost}
            END
          `,
              timeMonthlyUsageUpdated: sql`now()`,
            })
            .where(eq(BillingTable.workspaceID, info.workspaceID)),
          db
            .update(UserTable)
            .set({
              monthlyUsage: sql`
            CASE
              WHEN MONTH(${UserTable.timeMonthlyUsageUpdated}) = MONTH(now()) AND YEAR(${UserTable.timeMonthlyUsageUpdated}) = YEAR(now()) THEN ${UserTable.monthlyUsage} + ${cost}
              ELSE ${cost}
            END
          `,
              timeMonthlyUsageUpdated: sql`now()`,
            })
            .where(and(eq(UserTable.workspaceID, info.workspaceID), eq(UserTable.id, info.user.id))),
        ]
      })(),
    ]),
  )

  return { costInMicroCents: cost }
}
