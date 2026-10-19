import { afterEach, expect, test } from "bun:test"
import { claudeUsageProvider } from "../../../src/provider/usage/claude"
import { zaiUsageProvider } from "../../../src/provider/usage/zai"
import { resolveUsedFraction } from "../../../src/provider/usage/types"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("Claude clamps percent amounts and omits buckets without utilization", async () => {
  globalThis.fetch = Object.assign(
    async () =>
      Response.json({
        five_hour: { utilization: -20 },
        seven_day: { utilization: 120 },
        seven_day_opus: { resets_at: "2026-10-07" },
      }),
    { preconnect: realFetch.preconnect.bind(realFetch) },
  )
  const report = await claudeUsageProvider.fetchUsage({
    type: "oauth",
    accessToken: "test",
    accountId: "acct",
    email: "test",
  })
  expect(report?.limits.map((x) => x.amount)).toEqual([
    { used: 0, limit: 100, remaining: 100, usedFraction: 0, remainingFraction: 1, unit: "percent" },
    { used: 100, limit: 100, remaining: 0, usedFraction: 1, remainingFraction: 0, unit: "percent" },
  ])
})

test("ZAI preserves amounts, prioritizes percentage, and only caps the upper ratio", async () => {
  globalThis.fetch = Object.assign(
    async () =>
      Response.json({
        success: true,
        data: {
          limits: [
            { type: "TOKENS_LIMIT", currentValue: 80, usage: 100, remaining: 20, percentage: 25 },
            { type: "TIME_LIMIT", currentValue: -10, usage: 100 },
            { type: "TIME_LIMIT", currentValue: 200, usage: 100 },
            { type: "TIME_LIMIT", currentValue: 10, usage: 0 },
          ],
        },
      }),
    { preconnect: realFetch.preconnect.bind(realFetch) },
  )
  const report = await zaiUsageProvider.fetchUsage({ type: "api_key", apiKey: "test" })
  expect(report?.limits.map((x) => x.amount.usedFraction)).toEqual([0.25, -0.1, 1, undefined])
  expect(report?.limits[0].amount).toMatchObject({ used: 80, remaining: 20, remainingFraction: 0.75 })
})

test("display fraction preserves explicit, ratio, percent, then remaining precedence", () => {
  const limit = {
    id: "test",
    label: "Test",
    scope: { provider: "test" },
    amount: { unit: "percent" as const, used: 200, limit: 100, remainingFraction: 0.5 },
  }
  expect(resolveUsedFraction(limit)).toBe(2)
  expect(resolveUsedFraction({ ...limit, amount: { ...limit.amount, usedFraction: 0 } })).toBe(0)
  expect(resolveUsedFraction({ ...limit, amount: { unit: "unknown", remainingFraction: 2 } })).toBe(0)
})
