import { describe, expect, test } from "bun:test"
import { fetchWith429Retry } from "../../../../src/routes/zen/util/http"

describe("fetchWith429Retry", () => {
  test("retries on 429 then succeeds", async () => {
    let count = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      count++
      if (count <= 2) return new Response("rate limited", { status: 429 })
      return new Response("ok", { status: 200 })
    }) as unknown as typeof fetch

    const start = Date.now()
    const result = await fetchWith429Retry("https://example.com", {}, 3)
    const elapsed = Date.now() - start
    globalThis.fetch = originalFetch

    expect(result.status).toBe(200)
    expect(count).toBe(3)
    expect(elapsed).toBeGreaterThanOrEqual(500)
  })

  test("returns 429 response after exhausting retries", async () => {
    let count = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      count++
      return new Response("rate limited", { status: 429 })
    }) as unknown as typeof fetch

    const result = await fetchWith429Retry("https://example.com", {}, 1)
    globalThis.fetch = originalFetch

    expect(result.status).toBe(429)
    expect(count).toBeGreaterThanOrEqual(2)
  })
})
