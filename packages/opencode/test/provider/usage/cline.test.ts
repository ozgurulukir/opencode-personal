import { afterEach, describe, expect, spyOn, test } from "bun:test"
import {
  clineUsageProvider,
  parseCurrentUser,
  parseUserPlan,
  parsePlanUsageLimits,
} from "../../../src/provider/usage/cline"
import type { UsageCredential } from "../../../src/provider/usage/types"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

function stubFetch(handler: (url: string) => Response): void {
  const handle = (input: Parameters<typeof fetch>[0]): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    return Promise.resolve(handler(url))
  }
  // `typeof fetch` includes Bun's `preconnect` method; preserve it from the real fetch.
  globalThis.fetch = Object.assign(handle, { preconnect: realFetch.preconnect.bind(realFetch) })
}

const apiKeyCredential: UsageCredential = { type: "api_key", apiKey: "test-cline-key" }

describe("clineUsageProvider.supports", () => {
  test("accepts an API key credential with a key", () => {
    expect(clineUsageProvider.supports({ type: "api_key", apiKey: "key" })).toBe(true)
  })

  test("rejects an OAuth credential", () => {
    expect(clineUsageProvider.supports({ type: "oauth", accessToken: "token" })).toBe(false)
  })

  test("rejects an API key credential without a key", () => {
    expect(clineUsageProvider.supports({ type: "api_key" })).toBe(false)
  })
})

describe("parseCurrentUser", () => {
  test("maps the documented users/me shape to id, email and accountId", () => {
    expect(parseCurrentUser({ id: "user_1", email: "user@example.com", name: "User", active_account_id: "acct_1" })).toEqual(
      { id: "user_1", email: "user@example.com", accountId: "acct_1" },
    )
  })

  test("omits optional fields that are absent", () => {
    expect(parseCurrentUser({ id: "user_1", name: "User" })).toEqual({ id: "user_1" })
  })

  test("unwraps the live { data, success } envelope captured from api.cline.bot", () => {
    expect(
      parseCurrentUser({
        data: {
          id: "usr-01KBDY3A27G7J6AN85Y1ZVHE51",
          email: "user@example.com",
          displayName: "Ozgur",
          organizations: [],
        },
        success: true,
      }),
    ).toEqual({ id: "usr-01KBDY3A27G7J6AN85Y1ZVHE51", email: "user@example.com" })
  })

  test("returns null when the id is missing", () => {
    expect(parseCurrentUser({ email: "user@example.com", active_account_id: "acct_1" })).toBeNull()
  })

  test("returns null when the id is empty", () => {
    expect(parseCurrentUser({ id: "" })).toBeNull()
  })

  test("returns null for non-object input", () => {
    expect(parseCurrentUser("not-an-object")).toBeNull()
    expect(parseCurrentUser(null)).toBeNull()
    expect(parseCurrentUser(42)).toBeNull()
  })
})

describe("clineUsageProvider.fetchUsage degradation", () => {
  test("returns null when /users/me is rejected", async () => {
    stubFetch(() => new Response(null, { status: 401 }))
    expect(await clineUsageProvider.fetchUsage(apiKeyCredential)).toBeNull()
  })

  test("returns null when /users/me does not resolve a user id", async () => {
    stubFetch(() => jsonResponse({ email: "user@example.com" }))
    expect(await clineUsageProvider.fetchUsage(apiKeyCredential)).toBeNull()
  })

  test("resolves the user id from /users/me before fetching balance", async () => {
    const calls: string[] = []
    stubFetch((url) => {
      calls.push(url)
      if (url.endsWith("/api/v1/users/me")) return jsonResponse({ id: "user_42", email: "user@example.com" })
      return jsonResponse({ balance: 12.5 })
    })

    await clineUsageProvider.fetchUsage(apiKeyCredential)

    expect(calls[0]).toBe("https://api.cline.bot/api/v1/users/me")
    expect(calls[1]).toBe("https://api.cline.bot/api/v1/users/user_42/balance")
  })

  test("returns null when the balance endpoint is rejected", async () => {
    stubFetch((url) =>
      url.endsWith("/api/v1/users/me")
        ? jsonResponse({ id: "user_1", email: "user@example.com" })
        : new Response(null, { status: 500 }),
    )
    expect(await clineUsageProvider.fetchUsage(apiKeyCredential)).toBeNull()
  })

  test("returns null when the balance payload does not match the implemented contract", async () => {
    stubFetch((url) =>
      url.endsWith("/api/v1/users/me")
        ? jsonResponse({ id: "user_1", email: "user@example.com", active_account_id: "acct_1" })
        : jsonResponse({ unmapped: "shape" }),
    )
    expect(await clineUsageProvider.fetchUsage(apiKeyCredential)).toBeNull()
  })

  test("returns null when the balance payload is not an object", async () => {
    stubFetch((url) => (url.endsWith("/api/v1/users/me") ? jsonResponse({ id: "user_1" }) : jsonResponse(null)))
    expect(await clineUsageProvider.fetchUsage(apiKeyCredential)).toBeNull()
  })
})

describe("parseUserPlan", () => {
  test("extracts plan metadata from the captured /users/me/plan envelope", () => {
    expect(
      parseUserPlan({
        data: {
          plan: {
            name: "Cline Pass (Monthly)[Internal]",
            displayName: "Cline Pass (Monthly)",
            type: "individual",
            interval: "Monthly",
            isActive: true,
          },
          currentPeriodStart: "2026-09-12T20:07:47Z",
          currentPeriodEnd: "2026-10-12T20:07:47Z",
          cancelAt: "2026-10-12T20:07:47Z",
          canceledAt: "2026-09-14T10:10:39Z",
        },
        success: true,
      }),
    ).toEqual({
      displayName: "Cline Pass (Monthly)",
      interval: "Monthly",
      periodEnd: Date.parse("2026-10-12T20:07:47Z"),
      canceled: true,
    })
  })

  test("reports canceled as false when canceledAt is absent", () => {
    expect(
      parseUserPlan({
        data: {
          plan: { displayName: "Cline Pass (Monthly)", interval: "Monthly" },
          currentPeriodEnd: "2026-10-12T20:07:47Z",
        },
        success: true,
      }),
    ).toEqual({
      displayName: "Cline Pass (Monthly)",
      interval: "Monthly",
      periodEnd: Date.parse("2026-10-12T20:07:47Z"),
      canceled: false,
    })
  })

  test("returns null when the data envelope is missing", () => {
    expect(parseUserPlan({ plan: { displayName: "Cline Pass (Monthly)" }, success: true })).toBeNull()
  })

  test("returns null when the payload carries no plan name, interval or period end", () => {
    expect(parseUserPlan({ data: { subscriptionId: "sub_1" }, success: true })).toBeNull()
  })

  test("returns null for non-object input", () => {
    expect(parseUserPlan("not-an-object")).toBeNull()
    expect(parseUserPlan(null)).toBeNull()
    expect(parseUserPlan(42)).toBeNull()
  })
})

describe("parsePlanUsageLimits", () => {
  const capturedEnvelope = {
    data: {
      limits: [
        { type: "five_hour", percentUsed: 7, resetsAt: "2026-09-29T09:09:00.361942941Z" },
        { type: "weekly", percentUsed: 86, resetsAt: "2026-09-29T08:53:18.363835999Z" },
        { type: "monthly", percentUsed: 91, resetsAt: "2026-10-13T07:24:39.36560156Z" },
      ],
    },
    success: true,
  }

  test("extracts the three known windows in dashboard order with epoch resets", () => {
    expect(parsePlanUsageLimits(capturedEnvelope)).toEqual([
      { type: "five_hour", percentUsed: 7, resetsAt: Date.parse("2026-09-29T09:09:00.361942941Z") },
      { type: "weekly", percentUsed: 86, resetsAt: Date.parse("2026-09-29T08:53:18.363835999Z") },
      { type: "monthly", percentUsed: 91, resetsAt: Date.parse("2026-10-13T07:24:39.36560156Z") },
    ])
  })

  test("sorts the windows into dashboard order regardless of input order", () => {
    expect(
      parsePlanUsageLimits({
        data: {
          limits: [
            { type: "monthly", percentUsed: 1 },
            { type: "five_hour", percentUsed: 2 },
            { type: "weekly", percentUsed: 3 },
          ],
        },
      }).map((limit) => limit.type),
    ).toEqual(["five_hour", "weekly", "monthly"])
  })

  test("drops unknown window types", () => {
    expect(
      parsePlanUsageLimits({
        data: {
          limits: [
            { type: "daily", percentUsed: 50, resetsAt: "2026-09-29T09:09:00Z" },
            { type: "weekly", percentUsed: 10 },
          ],
        },
      }),
    ).toEqual([{ type: "weekly", percentUsed: 10 }])
  })

  test("drops prototype-chain type keys that are not own keys of the limit-type map", () => {
    expect(
      parsePlanUsageLimits({
        data: {
          limits: [
            { type: "toString", percentUsed: 50 },
            { type: "__proto__", percentUsed: 60 },
            { type: "constructor", percentUsed: 70 },
            { type: "five_hour", percentUsed: 7 },
            { type: "weekly", percentUsed: 86 },
            { type: "monthly", percentUsed: 91 },
          ],
        },
        success: true,
      }),
    ).toEqual([
      { type: "five_hour", percentUsed: 7 },
      { type: "weekly", percentUsed: 86 },
      { type: "monthly", percentUsed: 91 },
    ])
  })

  test("clamps percentUsed to 0..100 and defaults missing or non-numeric values to 0", () => {
    expect(
      parsePlanUsageLimits({
        data: {
          limits: [
            { type: "five_hour", percentUsed: 150 },
            { type: "weekly", percentUsed: -5 },
            { type: "monthly", percentUsed: "91" },
          ],
        },
      }).map((limit) => limit.percentUsed),
    ).toEqual([100, 0, 0])
  })

  test("omits resetsAt when it is missing or not a parseable date", () => {
    expect(
      parsePlanUsageLimits({
        data: { limits: [{ type: "five_hour", percentUsed: 10, resetsAt: "not-a-date" }] },
      }),
    ).toEqual([{ type: "five_hour", percentUsed: 10 }])
  })

  test("returns [] for a missing envelope or non-object input", () => {
    expect(parsePlanUsageLimits({ limits: [{ type: "weekly", percentUsed: 1 }] })).toEqual([])
    expect(parsePlanUsageLimits({ data: {} })).toEqual([])
    expect(parsePlanUsageLimits("not-an-object")).toEqual([])
    expect(parsePlanUsageLimits(null)).toEqual([])
    expect(parsePlanUsageLimits(42)).toEqual([])
  })
})

describe("clineUsageProvider.fetchUsage with captured live shapes", () => {
  // Fixtures pinned to real 200 responses captured from api.cline.bot on
  // 2026-09-29 (both wrapped in a { data, success } envelope the docs omit).
  test("maps the captured balance envelope to a micro-USD limit with email metadata", async () => {
    stubFetch((url) =>
      url.endsWith("/api/v1/users/me")
        ? jsonResponse({
            data: { id: "usr-01KBDY3A27G7J6AN85Y1ZVHE51", email: "user@example.com", organizations: [] },
            success: true,
          })
        : jsonResponse({ data: { userId: "usr-01KBDY3A27G7J6AN85Y1ZVHE51", balance: 8442 }, success: true }),
    )

    const report = await clineUsageProvider.fetchUsage(apiKeyCredential)

    expect(report).not.toBeNull()
    expect(report!.provider).toBe("cline-pass")
    expect(report!.limits).toHaveLength(1)
    expect(report!.limits[0].id).toBe("cline-pass:credits")
    expect(report!.limits[0].label).toBe("ClinePass Credits (pay-as-you-go)")
    expect(report!.limits[0].amount.unit).toBe("usd")
    expect(report!.limits[0].amount.remaining).toBe(0.008442)
    expect(report!.limits[0].amount.usedFraction).toBeUndefined()
    expect(report!.limits[0].notes).toBeUndefined()
    expect(report!.metadata?.email).toBe("user@example.com")
  })

  test("returns null when the balance envelope is missing the data wrapper", async () => {
    stubFetch((url) =>
      url.endsWith("/api/v1/users/me")
        ? jsonResponse({ data: { id: "user_1" }, success: true })
        : jsonResponse({ balance: 8442, success: true }),
    )
    expect(await clineUsageProvider.fetchUsage(apiKeyCredential)).toBeNull()
  })

  test("returns null when the balance value is not a finite number", async () => {
    stubFetch((url) =>
      url.endsWith("/api/v1/users/me")
        ? jsonResponse({ data: { id: "user_1" }, success: true })
        : jsonResponse({ data: { userId: "user_1", balance: "8442" }, success: true }),
    )
    expect(await clineUsageProvider.fetchUsage(apiKeyCredential)).toBeNull()
  })

  test("appends the plan limit after the balance limit when /users/me/plan is available", async () => {
    const calls: string[] = []
    stubFetch((url) => {
      calls.push(url)
      if (url.endsWith("/api/v1/users/me")) return jsonResponse({ data: { id: "user_1" }, success: true })
      if (url.endsWith("/api/v1/users/me/plan"))
        return jsonResponse({
          data: {
            plan: { displayName: "Cline Pass (Monthly)", interval: "Monthly", isActive: true },
            currentPeriodEnd: "2026-10-12T20:07:47Z",
            canceledAt: "2026-09-14T10:10:39Z",
          },
          success: true,
        })
      return jsonResponse({ data: { userId: "user_1", balance: 8442 }, success: true })
    })

    const report = await clineUsageProvider.fetchUsage(apiKeyCredential)

    expect(calls).toEqual([
      "https://api.cline.bot/api/v1/users/me",
      "https://api.cline.bot/api/v1/users/user_1/balance",
      "https://api.cline.bot/api/v1/users/me/plan/usage-limits",
      "https://api.cline.bot/api/v1/users/me/plan",
    ])
    expect(report).not.toBeNull()
    expect(report!.limits).toHaveLength(2)
    expect(report!.limits[0].id).toBe("cline-pass:credits")
    expect(report!.limits[1].id).toBe("cline-pass:plan")
    expect(report!.limits[1].label).toBe("Cline Pass (Monthly) — canceled")
    expect(report!.limits[1].scope.tier).toBeUndefined()
    expect(report!.limits[1].window?.id).toBe("period")
    expect(report!.limits[1].window?.label).toBe("until Oct 12")
    expect(report!.limits[1].amount.unit).toBe("unknown")
    expect(report!.limits[1].amount.usedFraction).toBeUndefined()
  })

  test("keeps the balance row when /users/me/plan is rejected", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/v1/users/me")) return jsonResponse({ data: { id: "user_1" }, success: true })
      if (url.endsWith("/api/v1/users/me/plan")) return new Response(null, { status: 500 })
      return jsonResponse({ data: { userId: "user_1", balance: 8442 }, success: true })
    })

    const report = await clineUsageProvider.fetchUsage(apiKeyCredential)

    expect(report).not.toBeNull()
    expect(report!.limits).toHaveLength(1)
    expect(report!.limits[0].id).toBe("cline-pass:credits")
    expect(report!.limits[0].amount.remaining).toBe(0.008442)
  })

  test("keeps the balance row and logs the failure when the /users/me/plan request throws", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})
    try {
      stubFetch((url) => {
        if (url.endsWith("/api/v1/users/me")) return jsonResponse({ data: { id: "user_1" }, success: true })
        if (url.endsWith("/api/v1/users/me/plan")) throw new Error("network down")
        return jsonResponse({ data: { userId: "user_1", balance: 8442 }, success: true })
      })

      const report = await clineUsageProvider.fetchUsage(apiKeyCredential)

      expect(report).not.toBeNull()
      expect(report!.limits).toHaveLength(1)
      expect(report!.limits[0].id).toBe("cline-pass:credits")
      expect(report!.limits[0].amount.remaining).toBe(0.008442)
      expect(errorSpy).toHaveBeenCalledTimes(1)
    } finally {
      errorSpy.mockRestore()
    }
  })
})

describe("clineUsageProvider.fetchUsage with the quota endpoint", () => {
  // Fixtures pinned to the redacted live captures in the plan (2026-09-29).
  const windowLimitsPayload = {
    data: {
      limits: [
        { type: "weekly", percentUsed: 86, resetsAt: "2026-09-29T08:53:18.363835999Z" },
        { type: "five_hour", percentUsed: 7, resetsAt: "2026-09-29T09:09:00.361942941Z" },
        { type: "monthly", percentUsed: 91, resetsAt: "2026-10-13T07:24:39.36560156Z" },
      ],
    },
    success: true,
  }

  const planPayload = {
    data: {
      plan: { displayName: "Cline Pass (Monthly)", interval: "Monthly", isActive: true },
      currentPeriodEnd: "2026-10-12T20:07:47Z",
    },
    success: true,
  }

  test("queries users/me, balance, plan/usage-limits then plan, ordering the window rows between credits and plan", async () => {
    const calls: string[] = []
    stubFetch((url) => {
      calls.push(url)
      if (url.endsWith("/api/v1/users/me")) return jsonResponse({ data: { id: "user_1" }, success: true })
      if (url.endsWith("/api/v1/users/me/plan/usage-limits")) return jsonResponse(windowLimitsPayload)
      if (url.endsWith("/api/v1/users/me/plan")) return jsonResponse(planPayload)
      return jsonResponse({ data: { userId: "user_1", balance: 8442 }, success: true })
    })

    const report = await clineUsageProvider.fetchUsage(apiKeyCredential)

    expect(calls).toEqual([
      "https://api.cline.bot/api/v1/users/me",
      "https://api.cline.bot/api/v1/users/user_1/balance",
      "https://api.cline.bot/api/v1/users/me/plan/usage-limits",
      "https://api.cline.bot/api/v1/users/me/plan",
    ])
    expect(report!.limits.map((limit) => limit.id)).toEqual([
      "cline-pass:credits",
      "cline-pass:limit:five_hour",
      "cline-pass:limit:weekly",
      "cline-pass:limit:monthly",
      "cline-pass:plan",
    ])
  })

  test("maps a window row to a percent amount, an empty-label reset window and a status", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/v1/users/me")) return jsonResponse({ data: { id: "user_1" }, success: true })
      if (url.endsWith("/api/v1/users/me/plan/usage-limits")) return jsonResponse(windowLimitsPayload)
      return jsonResponse({ data: { userId: "user_1", balance: 8442 }, success: true })
    })

    const report = await clineUsageProvider.fetchUsage(apiKeyCredential)
    const fiveHour = report!.limits.find((limit) => limit.id === "cline-pass:limit:five_hour")!

    expect(fiveHour.label).toBe("5-Hour Limit")
    expect(fiveHour.scope).toEqual({ provider: "cline-pass", windowId: "five_hour" })
    expect(fiveHour.window).toEqual({
      id: "five_hour",
      label: "",
      resetsAt: Date.parse("2026-09-29T09:09:00.361942941Z"),
    })
    expect(fiveHour.amount).toEqual({ used: 7, unit: "percent" })
    expect(fiveHour.amount.usedFraction).toBeUndefined()
    expect(fiveHour.status).toBe("ok")

    const monthly = report!.limits.find((limit) => limit.id === "cline-pass:limit:monthly")!
    expect(monthly.amount).toEqual({ used: 91, unit: "percent" })
    expect(monthly.status).toBe("warning")
  })

  test("keeps the credits and plan rows when the quota endpoint returns an error status", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/v1/users/me")) return jsonResponse({ data: { id: "user_1" }, success: true })
      if (url.endsWith("/api/v1/users/me/plan/usage-limits")) return new Response(null, { status: 500 })
      if (url.endsWith("/api/v1/users/me/plan")) return jsonResponse(planPayload)
      return jsonResponse({ data: { userId: "user_1", balance: 8442 }, success: true })
    })

    const report = await clineUsageProvider.fetchUsage(apiKeyCredential)

    expect(report!.limits.map((limit) => limit.id)).toEqual(["cline-pass:credits", "cline-pass:plan"])
  })

  test("keeps the credits and plan rows when the quota endpoint returns 404", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/v1/users/me")) return jsonResponse({ data: { id: "user_1" }, success: true })
      if (url.endsWith("/api/v1/users/me/plan/usage-limits")) return new Response(null, { status: 404 })
      if (url.endsWith("/api/v1/users/me/plan")) return jsonResponse(planPayload)
      return jsonResponse({ data: { userId: "user_1", balance: 8442 }, success: true })
    })

    const report = await clineUsageProvider.fetchUsage(apiKeyCredential)

    expect(report!.limits.map((limit) => limit.id)).toEqual(["cline-pass:credits", "cline-pass:plan"])
  })

  test("keeps the credits and plan rows and logs when the quota request throws", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {})
    try {
      stubFetch((url) => {
        if (url.endsWith("/api/v1/users/me")) return jsonResponse({ data: { id: "user_1" }, success: true })
        if (url.endsWith("/api/v1/users/me/plan/usage-limits")) throw new Error("network down")
        if (url.endsWith("/api/v1/users/me/plan")) return jsonResponse(planPayload)
        return jsonResponse({ data: { userId: "user_1", balance: 8442 }, success: true })
      })

      const report = await clineUsageProvider.fetchUsage(apiKeyCredential)

      expect(report!.limits.map((limit) => limit.id)).toEqual(["cline-pass:credits", "cline-pass:plan"])
      expect(errorSpy).toHaveBeenCalledTimes(1)
    } finally {
      errorSpy.mockRestore()
    }
  })

  test("adds no window rows when the quota endpoint returns an empty limits array", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/v1/users/me")) return jsonResponse({ data: { id: "user_1" }, success: true })
      if (url.endsWith("/api/v1/users/me/plan/usage-limits"))
        return jsonResponse({ data: { limits: [] }, success: true })
      return jsonResponse({ data: { userId: "user_1", balance: 8442 }, success: true })
    })

    const report = await clineUsageProvider.fetchUsage(apiKeyCredential)

    expect(report!.limits.map((limit) => limit.id)).toEqual(["cline-pass:credits"])
  })
})
