import { describe, expect, test } from "bun:test"
import { wrapClientError } from "../../../sdk/js/src/error-interceptor"

const response = (status: number) => new Response(null, { status })
const request = () => new Request("https://localhost/session", { method: "POST" })

describe("sdk.error-interceptor", () => {
  test("passes the error through when throwOnError is not set", () => {
    const body = { name: "NotFoundError" }
    expect(wrapClientError(body, response(404), request(), undefined)).toBe(body)
    expect(wrapClientError(body, response(404), request(), {})).toBe(body)
  })

  test("passes real Error instances through unchanged", () => {
    const error = new Error("already an error")
    expect(wrapClientError(error, response(500), request(), { throwOnError: true })).toBe(error)
  })

  test("wraps a NamedError-shaped body using data.message", () => {
    const body = { name: "NotFoundError", data: { message: "Session not found" } }
    const wrapped = wrapClientError(body, response(404), request(), { throwOnError: true })
    expect(wrapped).toBeInstanceOf(Error)
    expect((wrapped as Error).message).toBe("Session not found")
    expect((wrapped as { cause: { body: unknown; status: number } }).cause).toEqual({
      body,
      status: 404,
    })
  })

  test("falls back to message then name then the request description", () => {
    const byMessage = wrapClientError({ message: "boom" }, response(500), request(), { throwOnError: true }) as Error
    expect(byMessage.message).toBe("boom")
    const byName = wrapClientError({ name: "ProviderError" }, response(500), request(), { throwOnError: true }) as Error
    expect(byName.message).toBe("ProviderError")
    const byDescription = wrapClientError({ other: 1 }, response(503), request(), { throwOnError: true }) as Error
    expect(byDescription.message).toBe("POST https://localhost/session → 503")
  })

  test("wraps a plain string error", () => {
    const wrapped = wrapClientError("plain text", response(500), request(), { throwOnError: true }) as Error
    expect(wrapped.message).toBe("plain text")
  })

  test("describes an empty body and a missing response", () => {
    const empty = wrapClientError({}, response(500), request(), { throwOnError: true }) as Error
    expect(empty.message).toBe("opencode server POST https://localhost/session → 500: (empty response body)")
    const network = wrapClientError(undefined, undefined, request(), { throwOnError: true }) as Error
    expect(network.message).toBe("opencode server POST https://localhost/session: network error (no response)")
  })
})
