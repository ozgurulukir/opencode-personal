import { describe, expect, test } from "bun:test"
import { validateModelSettings, updateProviderKey } from "../../../../src/routes/zen/util/validation"
import type { AuthInfo } from "../../../../src/routes/zen/util/auth"

describe("validateModelSettings", () => {
  test("returns early for lite billing", () => {
    expect(validateModelSettings("lite", {} as AuthInfo, () => "error")).toBeUndefined()
  })

  test("returns early for anonymous", () => {
    expect(validateModelSettings("anonymous", {} as AuthInfo, () => "error")).toBeUndefined()
  })

  test("throws when model is disabled", () => {
    expect(() =>
      validateModelSettings("subscription", { isDisabled: true } as AuthInfo, (key) => {
        if (key === "zen.api.error.modelDisabled") throw new Error("disabled")
        return key
      }),
    ).toThrow("disabled")
  })

  test("returns without throwing when enabled", () => {
    expect(validateModelSettings("subscription", { isDisabled: false } as AuthInfo, () => "ok")).toBeUndefined()
  })
})

describe("updateProviderKey", () => {
  test("does nothing when no provider credentials", () => {
    const providerInfo = { apiKey: "original" }
    updateProviderKey({} as AuthInfo, providerInfo)
    expect(providerInfo.apiKey).toBe("original")
  })

  test("updates apiKey when credentials exist", () => {
    const providerInfo = { apiKey: "original" }
    updateProviderKey({ provider: { credentials: "new-key" } } as AuthInfo, providerInfo)
    expect(providerInfo.apiKey).toBe("new-key")
  })
})
