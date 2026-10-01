import { afterEach, describe, expect, test } from "bun:test"
import { openaiUsageProvider, parseOpenAIUsage } from "../../../src/provider/usage/openai"
import type { UsageCredential } from "../../../src/provider/usage/types"

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Response): void {
  const handle = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> =>
    Promise.resolve(handler(input, init))
  globalThis.fetch = Object.assign(handle, { preconnect: realFetch.preconnect.bind(realFetch) })
}

const oauthCredential: UsageCredential = { type: "oauth", accessToken: "test-token", accountId: "acct_123" }

const usagePayload = {
  plan_type: "plus",
  account_id: "acct_payload",
  rate_limit: {
    primary_window: { used_percent: 27, limit_window_seconds: 18_000, reset_at: 1_789_290_342 },
    secondary_window: { used_percent: 4, limit_window_seconds: 604_800, reset_at: 1_789_900_742 },
  },
  additional_rate_limits: [
    {
      limit_name: "GPT-5.3-Codex-Spark",
      metered_feature: "codex_bengalfox",
      rate_limit: { primary_window: { used_percent: 0, limit_window_seconds: 18_000, reset_at: 1_789_290_342 } },
    },
  ],
  rate_limit_reset_credits: { available_count: 2 },
}

describe("openaiUsageProvider.supports", () => {
  test("accepts an OAuth credential with an access token", () => {
    expect(openaiUsageProvider.supports(oauthCredential)).toBe(true)
  })

  test("rejects API-key credentials", () => {
    expect(openaiUsageProvider.supports({ type: "api_key", apiKey: "test-key" })).toBe(false)
  })

  test("rejects OAuth credentials without an access token", () => {
    expect(openaiUsageProvider.supports({ type: "oauth" })).toBe(false)
  })
})

describe("parseOpenAIUsage", () => {
  test("maps ChatGPT subscription windows and metadata", () => {
    const report = parseOpenAIUsage(usagePayload, oauthCredential)

    expect(report).not.toBeNull()
    expect(report!.provider).toBe("openai")
    expect(report!.metadata).toEqual({ accountId: "acct_123", planType: "plus", resetCredits: 2 })
    expect(report!.limits.map((limit) => limit.id)).toEqual([
      "openai:primary",
      "openai:secondary",
      "openai:GPT-5.3-Codex-Spark:primary",
    ])
    expect(report!.limits[0]).toMatchObject({
      label: "5 Hour Limit",
      scope: { provider: "openai", windowId: "openai:primary" },
      window: { label: "5 Hour", durationMs: 18_000_000, resetsAt: 1_789_290_342_000 },
      amount: { used: 27, limit: 100, remaining: 73, usedFraction: 0.27, unit: "percent" },
      status: "ok",
    })
    expect(report!.limits[1].window?.label).toBe("7 Day")
    expect(report!.limits[2].scope.tier).toBe("GPT-5.3-Codex-Spark")
  })

  test("clamps invalid percentages and ignores malformed windows", () => {
    const report = parseOpenAIUsage(
      {
        rate_limit: {
          primary_window: { used_percent: 125 },
          secondary_window: { used_percent: "not-a-number" },
        },
        additional_rate_limits: [{ limit_name: "broken", rate_limit: { primary_window: null } }],
      },
      { type: "oauth", accessToken: "test-token" },
    )

    expect(report?.limits).toHaveLength(1)
    expect(report?.limits[0].amount).toMatchObject({ used: 100, remaining: 0, usedFraction: 1 })
    expect(report?.limits[0].status).toBe("exhausted")
  })

  test("returns null when no quota windows are present", () => {
    expect(
      parseOpenAIUsage({ plan_type: "plus", rate_limit_reset_credits: { available_count: 1 } }, oauthCredential),
    ).toBeNull()
    expect(parseOpenAIUsage(null, oauthCredential)).toBeNull()
  })
})

describe("openaiUsageProvider.fetchUsage", () => {
  test("calls the ChatGPT usage endpoint with OAuth headers", async () => {
    let requestUrl = ""
    let requestInit: RequestInit | undefined
    stubFetch((input, init) => {
      requestUrl = String(input)
      requestInit = init
      return jsonResponse(usagePayload)
    })

    const report = await openaiUsageProvider.fetchUsage(oauthCredential)

    expect(requestUrl).toBe("https://chatgpt.com/backend-api/wham/usage")
    expect(requestInit?.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer test-token",
      "ChatGPT-Account-Id": "acct_123",
    })
    expect(report?.limits).toHaveLength(3)
  })

  test("returns null for a rejected request", async () => {
    stubFetch(() => jsonResponse({ error: "unauthorized" }, 401))
    expect(await openaiUsageProvider.fetchUsage(oauthCredential)).toBeNull()
  })
})
