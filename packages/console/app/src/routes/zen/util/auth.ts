import { and, eq, isNull, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { KeyTable } from "@opencode-ai/console-core/schema/key.sql.js"
import { BillingTable, SubscriptionTable, LiteTable } from "@opencode-ai/console-core/schema/billing.sql.js"
import { UserTable } from "@opencode-ai/console-core/schema/user.sql.js"
import { ModelTable } from "@opencode-ai/console-core/schema/model.sql.js"
import { ProviderTable } from "@opencode-ai/console-core/schema/provider.sql.js"
import { WorkspaceTable } from "@opencode-ai/console-core/schema/workspace.sql.js"
import { Resource } from "@opencode-ai/console-resource"
import { AuthError } from "./error"

export interface AuthInfo {
  apiKeyId: string
  workspaceID: string
  billing: {
    balance: number
    paymentMethodID?: string | null
    monthlyLimit?: number | null
    monthlyUsage?: number | null
    timeMonthlyUsageUpdated?: Date | null
    reloadTrigger?: number | null
    timeReloadLockedTill?: Date | null
    subscription?: { plan: string; useBalance?: boolean } | null
    lite?: { useBalance: boolean } | null
  }
  user: {
    id: string
    monthlyLimit?: number | null
    monthlyUsage?: number | null
    timeMonthlyUsageUpdated?: Date | null
  }
  black?: {
    id: string
    rollingUsage?: number | null
    fixedUsage?: number | null
    timeRollingUpdated?: Date | null
    timeFixedUpdated?: Date | null
  } | null
  lite?: {
    id: string
    timeCreated?: Date | null
    rollingUsage?: number | null
    weeklyUsage?: number | null
    monthlyUsage?: number | null
    timeRollingUpdated?: Date | null
    timeWeeklyUpdated?: Date | null
    timeMonthlyUpdated?: Date | null
  } | null
  provider?: { credentials: string } | null
  isFree: boolean
  isDisabled: boolean
}

export async function authenticate(
  modelInfo: { id: string; allowAnonymous?: boolean; byokProvider?: string },
  zenApiKey: string | undefined,
  deps: {
    t: (key: any, params?: Record<string, string | number>) => string
    Database: { use: (fn: (tx: any) => Promise<any>) => Promise<any> }
    ADMIN_WORKSPACES: string[]
  },
): Promise<AuthInfo | undefined> {
  if (!zenApiKey) {
    if (modelInfo.allowAnonymous) return
    throw new AuthError(deps.t("zen.api.error.missingApiKey"))
  }

  const data = await deps.Database.use((tx: any) =>
    tx
      .select({
        apiKey: KeyTable.id,
        workspaceID: WorkspaceTable.id,
        billing: {
          balance: BillingTable.balance,
          paymentMethodID: BillingTable.paymentMethodID,
          monthlyLimit: BillingTable.monthlyLimit,
          monthlyUsage: BillingTable.monthlyUsage,
          timeMonthlyUsageUpdated: BillingTable.timeMonthlyUsageUpdated,
          reloadTrigger: BillingTable.reloadTrigger,
          timeReloadLockedTill: BillingTable.timeReloadLockedTill,
          subscription: BillingTable.subscription,
          lite: BillingTable.lite,
        },
        user: {
          id: UserTable.id,
          monthlyLimit: UserTable.monthlyLimit,
          monthlyUsage: UserTable.monthlyUsage,
          timeMonthlyUsageUpdated: UserTable.timeMonthlyUsageUpdated,
        },
        black: {
          id: SubscriptionTable.id,
          rollingUsage: SubscriptionTable.rollingUsage,
          fixedUsage: SubscriptionTable.fixedUsage,
          timeRollingUpdated: SubscriptionTable.timeRollingUpdated,
          timeFixedUpdated: SubscriptionTable.timeFixedUpdated,
        },
        lite: {
          id: LiteTable.id,
          timeCreated: LiteTable.timeCreated,
          rollingUsage: LiteTable.rollingUsage,
          weeklyUsage: LiteTable.weeklyUsage,
          monthlyUsage: LiteTable.monthlyUsage,
          timeRollingUpdated: LiteTable.timeRollingUpdated,
          timeWeeklyUpdated: LiteTable.timeWeeklyUpdated,
          timeMonthlyUpdated: LiteTable.timeMonthlyUpdated,
        },
        provider: {
          credentials: ProviderTable.credentials,
        },
        timeDisabled: ModelTable.timeCreated,
      })
      .from(KeyTable)
      .innerJoin(WorkspaceTable, eq(WorkspaceTable.id, KeyTable.workspaceID))
      .innerJoin(BillingTable, eq(BillingTable.workspaceID, KeyTable.workspaceID))
      .innerJoin(
        UserTable,
        and(eq(KeyTable.workspaceID, UserTable.workspaceID), eq(UserTable.id, (UserTable as any).userID)),
      )
      .leftJoin(ModelTable, and(eq(KeyTable.workspaceID, ModelTable.workspaceID), eq(ModelTable.model, modelInfo.id)))
      .leftJoin(
        ProviderTable,
        modelInfo.byokProvider
          ? and(eq(KeyTable.workspaceID, ProviderTable.workspaceID), eq(ProviderTable.provider, modelInfo.byokProvider))
          : sql`false`,
      )
      .leftJoin(
        SubscriptionTable,
        and(
          eq(KeyTable.workspaceID, SubscriptionTable.workspaceID),
          eq(SubscriptionTable.userID, (UserTable as any).userID),
          isNull(SubscriptionTable.timeDeleted),
        ),
      )
      .where(and(eq(KeyTable.key, zenApiKey), isNull(KeyTable.timeDeleted)))
      .then((rows: any[]) => rows[0]),
  )

  if (!data) throw new AuthError(deps.t("zen.api.error.invalidApiKey"))
  if (
    modelInfo.id.startsWith("alpha-") &&
    Resource.App.stage === "production" &&
    !deps.ADMIN_WORKSPACES.includes(data.workspaceID)
  )
    throw new AuthError(deps.t("zen.api.error.modelNotSupported", { model: modelInfo.id }))

  return {
    apiKeyId: data.apiKey,
    workspaceID: data.workspaceID,
    billing: data.billing,
    user: data.user,
    black: data.black,
    lite: data.lite,
    provider: data.provider,
    isFree: deps.ADMIN_WORKSPACES.includes(data.workspaceID),
    isDisabled: !!data.timeDisabled,
  }
}
