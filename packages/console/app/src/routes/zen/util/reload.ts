import { and, eq, isNull, lt, or, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { BillingTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { centsToMicroCents } from "@opencode-ai/console-core/util/price.js"
import { Billing } from "@opencode-ai/console-core/billing.js"
import { Actor } from "@opencode-ai/console-core/actor.js"

export async function reload(
  billingSource: string,
  authInfo: any,
  costInfo: { totalCostInCent: number },
  Database: { use: (fn: (tx: any) => Promise<any>) => Promise<any> },
) {
  if (billingSource !== "balance") return

  const reloadTrigger = centsToMicroCents((authInfo.billing.reloadTrigger ?? Billing.RELOAD_TRIGGER) * 100)
  if (authInfo.billing.balance - costInfo.totalCostInCent >= reloadTrigger) return
  if (authInfo.billing.timeReloadLockedTill && authInfo.billing.timeReloadLockedTill > new Date()) return

  const lock = await Database.use((tx) =>
    tx
      .update(BillingTable)
      .set({
        timeReloadLockedTill: sql`now() + interval 1 minute`,
      })
      .where(
        and(
          eq(BillingTable.workspaceID, authInfo.workspaceID),
          eq(BillingTable.reload, true),
          lt(BillingTable.balance, reloadTrigger),
          or(isNull(BillingTable.timeReloadLockedTill), lt(BillingTable.timeReloadLockedTill, sql`now()`)),
        ),
      ),
  )
  if (lock.rowsAffected === 0) return

  await Actor.provide("system", { workspaceID: authInfo.workspaceID }, async () => {
    await Billing.reload()
  })
}
