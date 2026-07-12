import { and, eq, isNull, lt, or, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Actor } from "@opencode-ai/console-core/actor.js"
import type { AuthInfo } from "./auth"

export async function reload(
  billingSource: string,
  authInfo: AuthInfo | undefined,
  costInfo: { totalCostInCent: number },
  Database: { use: (fn: (tx: any) => Promise<any>) => Promise<any> },
) {
  if (billingSource !== "balance") return

  const info = authInfo!
  const reloadTrigger = centsToMicroCents((info.billing.reloadTrigger ?? Billing.RELOAD_TRIGGER) * 100)
  if (info.billing.balance - costInfo.totalCostInCent >= reloadTrigger) return
  if (info.billing.timeReloadLockedTill && info.billing.timeReloadLockedTill > new Date()) return

  const lock = await Database.use((tx) =>
    tx
      .update(BillingTable)
      .set({
        timeReloadLockedTill: sql`now() + interval 1 minute`,
      })
      .where(
        and(
          eq(BillingTable.workspaceID, info.workspaceID),
          eq(BillingTable.reload, true),
          lt(BillingTable.balance, reloadTrigger),
          or(isNull(BillingTable.timeReloadLockedTill), lt(BillingTable.timeReloadLockedTill, sql`now()`)),
        ),
      ),
  )
  if (lock.rowsAffected === 0) return

  await Actor.provide("system", { workspaceID: info.workspaceID }, async () => {
    await Billing.reload()
  })
}
