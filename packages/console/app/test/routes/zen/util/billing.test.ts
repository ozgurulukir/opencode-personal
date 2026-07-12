import { afterAll, describe, expect, mock, test } from "bun:test"

// Mock SST-triggering modules so billing.ts can import without SST.
mock.module("@opencode-ai/console-core/black.js", () => ({
  BlackData: {
    getLimits: () => ({ fixedLimit: 1000, rollingLimit: 2000, rollingWindow: 5 }),
  },
}))
mock.module("@opencode-ai/console-core/lite.js", () => ({
  LiteData: {
    getLimits: () => ({
      weeklyLimit: 500,
      monthlyLimit: 2000,
      rollingLimit: 300,
      rollingWindow: 5,
    }),
  },
}))
mock.module("@opencode-ai/console-core/subscription.js", () => ({
  Subscription: {
    analyzeWeeklyUsage: () => ({ status: "ok", resetInSec: 0 }),
    analyzeRollingUsage: () => ({ status: "ok", resetInSec: 0 }),
    analyzeMonthlyUsage: () => ({ status: "ok", resetInSec: 0 }),
  },
}))

afterAll(() => {
  mock.restore()
})

const { validateBilling } = await import("../../../../src/routes/zen/util/billing")
const { BlackUsageLimitError, GoUsageLimitError, CreditsError, MonthlyLimitError, UserLimitError } =
  await import("../../../../src/routes/zen/util/error")

function createAuthInfo(overrides: any = {}) {
  return {
    apiKeyId: "key-1",
    workspaceID: "ws-1",
    billing: {
      balance: 10000,
      paymentMethodID: "pm-1",
      monthlyLimit: 100,
      monthlyUsage: 0,
      timeMonthlyUsageUpdated: new Date(),
      reloadTrigger: 500,
      subscription: { plan: "20", useBalance: false },
      lite: { useBalance: false },
    },
    user: {
      id: "user-1",
      monthlyLimit: 100,
      monthlyUsage: 0,
      timeMonthlyUsageUpdated: new Date(),
    },
    black: {
      id: "sub-1",
      rollingUsage: 0,
      fixedUsage: 0,
      timeRollingUpdated: new Date(),
      timeFixedUpdated: new Date(),
    },
    lite: null,
    provider: null,
    isFree: false,
    isDisabled: false,
    ...overrides,
  }
}

const deps = {
  t: (key: string, params?: Record<string, string | number>) => key,
  modelList: "full" as const,
}

describe("validateBilling", () => {
  test("returns anonymous when no authInfo", () => {
    expect(validateBilling(undefined, { allowAnonymous: true }, deps)).toBe("anonymous")
  })

  test("returns byok when provider credentials exist", () => {
    expect(validateBilling(createAuthInfo({ provider: { credentials: "key" } }), {}, deps)).toBe("byok")
  })

  test("returns free when isFree", () => {
    expect(validateBilling(createAuthInfo({ isFree: true }), {}, deps)).toBe("free")
  })

  test("returns free when allowAnonymous and not byok/free", () => {
    expect(validateBilling(createAuthInfo({ provider: null, isFree: false }), { allowAnonymous: true }, deps)).toBe(
      "free",
    )
  })

  test("returns subscription when subscription exists and no limits exceeded", () => {
    expect(validateBilling(createAuthInfo(), {}, deps)).toBe("subscription")
  })

  test("throws BlackUsageLimitError when fixed limit exceeded and useBalance false", () => {
    mock.module("@opencode-ai/console-core/subscription.js", () => ({
      Subscription: {
        analyzeWeeklyUsage: () => ({ status: "rate-limited", resetInSec: 3600 }),
        analyzeRollingUsage: () => ({ status: "ok", resetInSec: 0 }),
        analyzeMonthlyUsage: () => ({ status: "ok", resetInSec: 0 }),
      },
    }))
    expect(() =>
      validateBilling(
        createAuthInfo({
          black: { fixedUsage: 2000, timeFixedUpdated: new Date(), rollingUsage: 0, timeRollingUpdated: new Date() },
        }),
        {},
        deps,
      ),
    ).toThrow(BlackUsageLimitError)
    mock.module("@opencode-ai/console-core/subscription.js", () => ({
      Subscription: {
        analyzeWeeklyUsage: () => ({ status: "ok", resetInSec: 0 }),
        analyzeRollingUsage: () => ({ status: "ok", resetInSec: 0 }),
        analyzeMonthlyUsage: () => ({ status: "ok", resetInSec: 0 }),
      },
    }))
  })

  test("falls through to balance when fixed limit exceeded and useBalance true", () => {
    mock.module("@opencode-ai/console-core/subscription.js", () => ({
      Subscription: {
        analyzeWeeklyUsage: () => ({ status: "rate-limited", resetInSec: 3600 }),
        analyzeRollingUsage: () => ({ status: "ok", resetInSec: 0 }),
        analyzeMonthlyUsage: () => ({ status: "ok", resetInSec: 0 }),
      },
    }))
    const authInfo = createAuthInfo({
      billing: { ...createAuthInfo().billing, subscription: { plan: "20", useBalance: true } },
      black: { fixedUsage: 2000, timeFixedUpdated: new Date(), rollingUsage: 0, timeRollingUpdated: new Date() },
    })
    expect(validateBilling(authInfo, {}, deps)).toBe("balance")
    mock.module("@opencode-ai/console-core/subscription.js", () => ({
      Subscription: {
        analyzeWeeklyUsage: () => ({ status: "ok", resetInSec: 0 }),
        analyzeRollingUsage: () => ({ status: "ok", resetInSec: 0 }),
        analyzeMonthlyUsage: () => ({ status: "ok", resetInSec: 0 }),
      },
    }))
  })

  test("returns lite when lite exists and no limits exceeded", () => {
    const authInfo = createAuthInfo({
      billing: { ...createAuthInfo().billing, subscription: null, lite: { useBalance: false } },
      black: null,
      lite: {
        id: "lite-1",
        timeCreated: new Date(),
        weeklyUsage: 0,
        timeWeeklyUpdated: new Date(),
        monthlyUsage: 0,
        timeMonthlyUpdated: new Date(),
        rollingUsage: 0,
        timeRollingUpdated: new Date(),
      },
    })
    expect(validateBilling(authInfo, { modelList: "lite" } as any, { ...deps, modelList: "lite" })).toBe("lite")
  })

  test("throws CreditsError when no payment method and balance <= 0", () => {
    const authInfo = createAuthInfo({
      billing: { ...createAuthInfo().billing, subscription: null, lite: null, paymentMethodID: null, balance: 0 },
      black: null,
    })
    expect(() => validateBilling(authInfo, {}, deps)).toThrow(CreditsError)
  })

  test("throws CreditsError when balance <= 0", () => {
    const authInfo = createAuthInfo({
      billing: { ...createAuthInfo().billing, subscription: null, lite: null, balance: 0 },
      black: null,
    })
    expect(() => validateBilling(authInfo, {}, deps)).toThrow(CreditsError)
  })

  test("returns balance when all checks pass", () => {
    const authInfo = createAuthInfo({
      billing: { ...createAuthInfo().billing, subscription: null, lite: null },
      black: null,
    })
    expect(validateBilling(authInfo, {}, deps)).toBe("balance")
  })
})
