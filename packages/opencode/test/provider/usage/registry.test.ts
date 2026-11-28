import { afterEach, expect, test } from "bun:test"
import { fetchUsageReports } from "../../../src/provider/usage/registry"

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

test("dispatches injected auth, resolves aliases, and isolates provider failures", async () => {
  const calls: { url: string; authorization: string | null }[] = []
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString()
      calls.push({ url, authorization: new Headers(init?.headers).get("authorization") })
      if (url.includes("anthropic")) throw new Error("unavailable")
      if (url.includes("chatgpt")) return new Response(null, { status: 401 })
      return Response.json({
        success: true,
        data: { limits: [{ type: "TOKENS_LIMIT", currentValue: 25, usage: 100 }] },
      })
    },
    { preconnect: realFetch.preconnect.bind(realFetch) },
  )
  const reports = await fetchUsageReports({
    anthropic: { type: "oauth", access: "claude-token", refresh: "refresh", expires: 0 },
    "zai-coding-plan": { type: "wellknown", key: "zai-key", token: "token" },
    openai: { type: "oauth", access: "openai-token", refresh: "refresh", expires: 0, accountId: "acct" },
    unknown: { type: "api", key: "unused" },
  })
  expect(reports.map((x) => x.provider)).toEqual(["zai"])
  expect(reports[0].limits[0].amount.usedFraction).toBe(0.25)
  // Reports are fetched concurrently, so dispatch order is nondeterministic.
  expect(calls.map((x) => x.authorization).sort()).toEqual([
    "Bearer claude-token",
    "Bearer openai-token",
    "Bearer token",
    "Bearer token",
  ])
})

test("ignores unknown, unsupported, and empty credentials without requesting usage", async () => {
  const calls: unknown[] = []
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      calls.push(input)
      throw new Error("unexpected request")
    },
    { preconnect: realFetch.preconnect.bind(realFetch) },
  )
  expect(await fetchUsageReports({})).toEqual([])
  expect(
    await fetchUsageReports({
      anthropic: { type: "api", key: "unsupported" },
      openai: { type: "oauth", access: "", refresh: "", expires: 0 },
      unknown: { type: "api", key: "unknown" },
    }),
  ).toEqual([])
  expect(calls).toEqual([])
})

test("bounds hanging usage fetches with a per-fetch timeout signal", async () => {
  const observed: AbortSignal[] = []
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      observed.push(init?.signal!)
      // Mimic real fetch semantics: reject only when the signal fires, hang
      // otherwise — a stalled connection the timeout must rescue.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason))
      })
    },
    { preconnect: realFetch.preconnect.bind(realFetch) },
  )
  // Cap the effective timeout at 50ms so the test does not wait the real 10s.
  const realAbortTimeout = AbortSignal.timeout.bind(AbortSignal)
  AbortSignal.timeout = ((ms: number) => realAbortTimeout(Math.min(ms, 50))) as typeof AbortSignal.timeout
  let reports
  try {
    reports = await fetchUsageReports({
      "zai-coding-plan": { type: "wellknown", key: "k", token: "tok" },
      anthropic: { type: "oauth", access: "tok", refresh: "r", expires: 0 },
    })
  } finally {
    AbortSignal.timeout = realAbortTimeout
  }
  expect(observed.length).toBe(2)
  for (const signal of observed) expect(signal).toBeInstanceOf(AbortSignal)
  // Both fetches were cancelled by their timeout signals, so the registry
  // degrades to an empty report list instead of hanging.
  expect(reports).toEqual([])
})
