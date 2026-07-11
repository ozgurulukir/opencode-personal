import { describe, expect, test } from "bun:test"
import { mapErrorToResponse } from "../../../../src/routes/zen/util/error-mapping"
import {
  AuthError,
  BlackUsageLimitError,
  CreditsError,
  GoUsageLimitError,
  MonthlyLimitError,
  RateLimitError,
  UserLimitError,
  ModelError,
  FreeUsageLimitError,
} from "../../../../src/routes/zen/util/error"

describe("mapErrorToResponse", () => {
  function createLogger() {
    const metrics: Record<string, any>[] = []
    return { metrics, metric: (values: Record<string, any>) => metrics.push(values) }
  }

  test("maps auth-related errors to 401", async () => {
    const logger = createLogger()
    for (const ErrorClass of [AuthError, CreditsError, MonthlyLimitError, UserLimitError, ModelError]) {
      const res = mapErrorToResponse(new ErrorClass("denied"), logger)
      expect(res.status).toBe(401)
      const json = await res.json()
      expect(json.error.message).toBe("denied")
    }
  })

  test("maps rate-limit errors to 429 with retry-after header", async () => {
    const logger = createLogger()
    const res = mapErrorToResponse(new RateLimitError("too fast", 42), logger)
    expect(res.status).toBe(429)
    expect(res.headers.get("retry-after")).toBe("42")
    const json = await res.json()
    expect(json.error.message).toBe("too fast")
  })

  test("maps GoUsageLimitError with workspace metadata", async () => {
    const logger = createLogger()
    const res = mapErrorToResponse(new GoUsageLimitError("weekly limit", "ws-1", "weekly", 300), logger)
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.metadata.workspace).toBe("ws-1")
    expect(json.metadata.limitName).toBe("weekly")
  })

  test("maps FreeUsageLimitError without metadata", async () => {
    const logger = createLogger()
    const res = mapErrorToResponse(new FreeUsageLimitError("free limit"), logger)
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.metadata).toEqual({})
  })

  test("maps unknown errors to 500 internal server error", async () => {
    const logger = createLogger()
    const res = mapErrorToResponse(new Error("boom"), logger)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error.message).toBe("Internal server error")
  })

  test("logs error cause for Failed query errors", () => {
    const logger = createLogger()
    const error = new Error("Failed query: syntax error")
    error.cause = { detail: "missing table" }
    mapErrorToResponse(error, logger)
    expect(logger.metrics.some((m) => m["error.cause2"] === JSON.stringify({ detail: "missing table" }))).toBe(true)
  })
})
