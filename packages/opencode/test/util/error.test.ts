import { describe, expect, test } from "bun:test"
import * as Log from "@opencode-ai/core/util/log"
import { errorData, errorFormat, errorMessage, safeCatch } from "../../src/util/error"

describe("util.error", () => {
  test("formats native Error instances", () => {
    const err = new Error("boom")
    expect(errorMessage(err)).toBe("boom")
    expect(errorFormat(err)).toContain("boom")

    const data = errorData(err)
    expect(data.type).toBe("Error")
    expect(data.message).toBe("boom")
    expect(String(data.formatted)).toContain("boom")
  })

  test("extracts message from record-like values", () => {
    const err = { message: "bad input", code: "E_BAD" }
    expect(errorMessage(err)).toBe("bad input")

    const data = errorData(err)
    expect(data.message).toBe("bad input")
    expect(data.code).toBe("E_BAD")
  })

  test("never returns bare {} for opaque object errors", () => {
    // Plain empty object — what the SDK threw before we wrapped it.
    expect(errorFormat({})).not.toBe("{}")
    expect(errorFormat({})).toContain("no message")

    // Object with only non-enumerable own properties (JSON.stringify drops them).
    class OpaqueError {}
    const opaque = new OpaqueError()
    Object.defineProperty(opaque, "secret", { value: "hidden", enumerable: false })
    expect(errorFormat(opaque)).not.toBe("{}")
    expect(errorFormat(opaque)).toContain("OpaqueError")
  })

  test("handles opaque throwables with custom toString", () => {
    const err = {
      toString() {
        return "ResolveMessage: Cannot resolve module"
      },
    }

    expect(errorMessage(err)).toBe("ResolveMessage: Cannot resolve module")

    const data = errorData(err)
    expect(data.message).toBe("ResolveMessage: Cannot resolve module")
    expect(String(data.formatted)).toContain("ResolveMessage")
  })

  test("safeCatch logs error with context and calls fallback", () => {
    const logged: Array<{ message: unknown; extra: Record<string, any> | undefined }> = []
    const originalError = Log.Default.error.bind(Log.Default)
    Log.Default.error = (message?: any, extra?: Record<string, any>) => {
      logged.push({ message, extra })
    }

    let fallbackCalled = false
    safeCatch("test-context", new Error("catch me"), () => {
      fallbackCalled = true
    })

    Log.Default.error = originalError
    expect(fallbackCalled).toBeTrue()
    expect(logged.length).toBe(1)
    expect(logged[0].message).toBe("[test-context]")
    const loggedError = logged[0].extra?.error
    expect(loggedError).toBeInstanceOf(Error)
    expect(loggedError instanceof Error ? loggedError.message : "").toBe("catch me")
  })

  test("safeCatch works without fallback", () => {
    const logged: Array<{ message: unknown; extra: Record<string, any> | undefined }> = []
    const originalError = Log.Default.error.bind(Log.Default)
    Log.Default.error = (message?: any, extra?: Record<string, any>) => {
      logged.push({ message, extra })
    }

    safeCatch("no-fallback", { code: "E_FAIL" })

    Log.Default.error = originalError
    expect(logged.length).toBe(1)
    expect(logged[0].message).toBe("[no-fallback]")
    expect(logged[0].extra?.error).toEqual({ code: "E_FAIL" })
  })
})
