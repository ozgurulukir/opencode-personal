import { afterEach, describe, expect, jest, test } from "bun:test"
import {
  parseJwtClaims,
  extractAccountIdFromClaims,
  extractAccountId,
  waitForOAuthCallback,
  startOAuthServer,
  stopOAuthServer,
  OAUTH_PORT,
  type IdTokenClaims,
} from "../../src/plugin/codex"

function createTestJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${header}.${body}.sig`
}

describe("plugin.codex", () => {
  describe("parseJwtClaims", () => {
    test("parses valid JWT with claims", () => {
      const payload = { email: "test@example.com", chatgpt_account_id: "acc-123" }
      const jwt = createTestJwt(payload)
      const claims = parseJwtClaims(jwt)
      expect(claims).toEqual(payload)
    })

    test("returns undefined for JWT with less than 3 parts", () => {
      expect(parseJwtClaims("invalid")).toBeUndefined()
      expect(parseJwtClaims("only.two")).toBeUndefined()
    })

    test("returns undefined for invalid base64", () => {
      expect(parseJwtClaims("a.!!!invalid!!!.b")).toBeUndefined()
    })

    test("returns undefined for invalid JSON payload", () => {
      const header = Buffer.from("{}").toString("base64url")
      const invalidJson = Buffer.from("not json").toString("base64url")
      expect(parseJwtClaims(`${header}.${invalidJson}.sig`)).toBeUndefined()
    })
  })

  describe("extractAccountIdFromClaims", () => {
    test("extracts chatgpt_account_id from root", () => {
      const claims: IdTokenClaims = { chatgpt_account_id: "acc-root" }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts chatgpt_account_id from nested https://api.openai.com/auth", () => {
      const claims: IdTokenClaims = {
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-nested")
    })

    test("prefers root over nested", () => {
      const claims: IdTokenClaims = {
        chatgpt_account_id: "acc-root",
        "https://api.openai.com/auth": { chatgpt_account_id: "acc-nested" },
      }
      expect(extractAccountIdFromClaims(claims)).toBe("acc-root")
    })

    test("extracts from organizations array as fallback", () => {
      const claims: IdTokenClaims = {
        organizations: [{ id: "org-123" }, { id: "org-456" }],
      }
      expect(extractAccountIdFromClaims(claims)).toBe("org-123")
    })

    test("returns undefined when no accountId found", () => {
      const claims: IdTokenClaims = { email: "test@example.com" }
      expect(extractAccountIdFromClaims(claims)).toBeUndefined()
    })
  })

  describe("extractAccountId", () => {
    test("extracts from id_token first", () => {
      const idToken = createTestJwt({ chatgpt_account_id: "from-id-token" })
      const accessToken = createTestJwt({ chatgpt_account_id: "from-access-token" })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-id-token")
    })

    test("falls back to access_token when id_token has no accountId", () => {
      const idToken = createTestJwt({ email: "test@example.com" })
      const accessToken = createTestJwt({
        "https://api.openai.com/auth": { chatgpt_account_id: "from-access" },
      })
      expect(
        extractAccountId({
          id_token: idToken,
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("from-access")
    })

    test("returns undefined when no tokens have accountId", () => {
      const token = createTestJwt({ email: "test@example.com" })
      expect(
        extractAccountId({
          id_token: token,
          access_token: token,
          refresh_token: "rt",
        }),
      ).toBeUndefined()
    })

    test("handles missing id_token", () => {
      const accessToken = createTestJwt({ chatgpt_account_id: "acc-123" })
      expect(
        extractAccountId({
          id_token: "",
          access_token: accessToken,
          refresh_token: "rt",
        }),
      ).toBe("acc-123")
    })
  })
})

describe("waitForOAuthCallback", () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test("times out the current flow when no callback arrives", async () => {
    jest.useFakeTimers()
    const pending = waitForOAuthCallback({ verifier: "v", challenge: "c" }, "state-solo")
    const outcome = pending.then(
      () => "resolved",
      (error: Error) => error.message,
    )

    jest.advanceTimersByTime(5 * 60 * 1000)

    expect(await outcome).toBe("OAuth callback timeout - authorization took too long")
  })

  test("a stale timeout from a superseded flow does not kill the current flow", async () => {
    jest.useFakeTimers()

    const first = waitForOAuthCallback({ verifier: "v1", challenge: "c1" }, "state-1")
    // The superseded flow is abandoned by its caller; ignore its outcome.
    first.catch(() => {})

    // A second authorize() two minutes later overwrites the shared pending
    // flow, but the first flow's five-minute timer is still armed.
    jest.advanceTimersByTime(2 * 60 * 1000)
    const second = waitForOAuthCallback({ verifier: "v2", challenge: "c2" }, "state-2")
    const secondOutcome = second.then(
      () => "resolved",
      (error: Error) => error.message,
    )

    // t=5min: the stale first timer fires. It must be a no-op; the buggy
    // version cleared the second flow's pending state and stopped the server.
    jest.advanceTimersByTime(3 * 60 * 1000)

    // t=7min: the second flow's own timer fires. Because the second flow is
    // still intact it rejects with its genuine timeout instead of hanging.
    jest.advanceTimersByTime(2 * 60 * 1000)
    jest.useRealTimers()

    const hung = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("second OAuth flow hung")), 50))
    expect(await Promise.race([secondOutcome, hung])).toBe("OAuth callback timeout - authorization took too long")
  })
})

describe("startOAuthServer", () => {
  afterEach(() => {
    // A failing assertion mid-test must not leave the listener (or a blocker)
    // bound to the fixed port for the rest of the file.
    stopOAuthServer()
  })

  test("concurrent starts share one callback server and stop remains live", async () => {
    // Defensive: a leftover listener from a crashed prior run would break the
    // fixed-port listen below.
    stopOAuthServer()

    // Two near-simultaneous authorize() calls both reach startOAuthServer.
    // Without the shared in-flight promise, the loser's EADDRINUSE catch
    // cleared the module reference after the winner assigned it, so
    // stopOAuthServer() no-op'd and the listener leaked until restart.
    const [first, second] = await Promise.all([startOAuthServer(), startOAuthServer()])
    expect(second.port).toBe(first.port)
    expect(second.redirectUri).toBe(first.redirectUri)

    // The server is actually listening.
    const probe = await fetch(`http://localhost:${first.port}/nonexistent`)
    expect(probe.status).toBe(404)

    // stopOAuthServer must actually stop it (the clobber bug made it a no-op).
    stopOAuthServer()
    await new Promise((resolve) => setTimeout(resolve, 50))
    let stopped = false
    try {
      await fetch(`http://localhost:${first.port}/nonexistent`)
    } catch {
      stopped = true
    }
    expect(stopped).toBe(true)
  })

  test("a failed listen does not poison the next start", async () => {
    // Occupy the fixed callback port to force our listen to fail; the next
    // start must recover.
    const { createServer } = await import("node:http")
    const blocker = createServer(() => {})
    blocker.on("error", () => {})
    await new Promise<void>((resolve) => blocker.listen(OAUTH_PORT, resolve))

    await expect(startOAuthServer()).rejects.toThrow()
    stopOAuthServer()
    await new Promise<void>((resolve) => blocker.close(() => resolve()))
    await startOAuthServer() // must recover on retry
    stopOAuthServer()
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  })
})
