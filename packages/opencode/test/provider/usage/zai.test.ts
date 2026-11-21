import { afterAll, describe, expect, test } from "bun:test"
import { zaiUsageProvider } from "../../../src/provider/usage/zai"
import type { UsageCredential } from "../../../src/provider/usage/types"

const credential: UsageCredential = { type: "api_key", apiKey: "zai-key-123" }

const originalFetch = globalThis.fetch

const lastHeaders: Record<string, string>[] = []
// Bun's fetch type carries a `preconnect` member — attach it so the mock is
// assignable to `typeof globalThis.fetch`.
const fetchMock = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    lastHeaders.push((init?.headers ?? {}) as Record<string, string>)
    if (String(input).includes("/api/monitor/usage/quota/limit")) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            limits: [
              { type: "TOKENS_LIMIT", currentValue: 10, usage: 100, remaining: 90, nextResetTime: Date.now() + 1000 },
            ],
          },
        }),
        { status: 200 },
      )
    }
    // model-usage endpoint: best-effort breakdown
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  },
  { preconnect: () => {} },
) as typeof globalThis.fetch

afterAll(() => {
  globalThis.fetch = originalFetch
})

describe("provider/usage/zai", () => {
  test("authorization header carries the Bearer scheme (locked wire format)", async () => {
    globalThis.fetch = fetchMock
    const report = await zaiUsageProvider.fetchUsage(credential)
    expect(report).not.toBeNull()
    expect(lastHeaders[0]?.Authorization).toBe("Bearer zai-key-123")
    expect(lastHeaders[1]?.Authorization).toBe("Bearer zai-key-123")
  })

  test("parses quota limits into a usage report", async () => {
    globalThis.fetch = fetchMock
    const report = await zaiUsageProvider.fetchUsage(credential)
    expect(report?.provider).toBe("zai")
    expect(report?.limits).toHaveLength(1)
    expect(report?.limits[0]).toMatchObject({ id: "zai:tokens", label: "ZAI Token Quota" })
  })

  test("returns null without an apiKey", async () => {
    globalThis.fetch = fetchMock
    const before = lastHeaders.length
    const report = await zaiUsageProvider.fetchUsage({ type: "api_key" })
    expect(report).toBeNull()
    expect(lastHeaders.length).toBe(before)
  })
})
