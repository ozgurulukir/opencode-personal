import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { clineUsageProvider, parseCurrentUser, parseUserPlan } from "../../../src/provider/usage/cline"
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

describe("clineUsageProvider.fetchUsage with captured live shapes", () => {
  // Fixtures pinned to real 200 responses captured from api.cline.bot on
  // 2026-09-29 (both wrapped in a { data, success } envelope the docs omit).
  test("maps the captured balance envelope to a micro-USD limit with email metadata and a dashboard note", async () => {
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
    expect(report!.limits[0].notes).toEqual([
      "Subscription windows (5h/weekly/monthly) are not exposed by the Cline API — check app.cline.bot/dashboard/subscription",
    ])
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
