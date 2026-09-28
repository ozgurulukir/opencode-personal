import { afterEach, describe, expect, test } from "bun:test"
import { clineUsageProvider, parseCurrentUser } from "../../../src/provider/usage/cline"
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
