import { ModelError } from "./error"

export function validateModelSettings(
  billingSource: string,
  authInfo: any,
  t: (key: any, params?: Record<string, string | number>) => string,
) {
  if (billingSource === "lite") return
  if (billingSource === "anonymous") return
  if (authInfo?.isDisabled) throw new ModelError(t("zen.api.error.modelDisabled"))
}

export function updateProviderKey(authInfo: any, providerInfo: { apiKey?: string }) {
  if (!authInfo?.provider?.credentials) return
  providerInfo.apiKey = authInfo.provider.credentials
}
