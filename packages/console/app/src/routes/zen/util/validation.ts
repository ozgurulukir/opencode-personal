import { ModelError } from "./error"
import type { AuthInfo } from "./auth"

export function validateModelSettings(
  billingSource: string,
  authInfo: AuthInfo | undefined,
  t: (key: any, params?: Record<string, string | number>) => string,
) {
  if (billingSource === "lite") return
  if (billingSource === "anonymous") return
  if (authInfo?.isDisabled) throw new ModelError(t("zen.api.error.modelDisabled"))
}

export function updateProviderKey(authInfo: AuthInfo | undefined, providerInfo: { apiKey?: string }) {
  if (!authInfo?.provider?.credentials) return
  providerInfo.apiKey = authInfo.provider.credentials
}
