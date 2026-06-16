import { describe, expect, test } from "bun:test"
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
    const logs: Array<[string, unknown]> = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      logs.push(args as [string, unknown])
    }

    let fallbackCalled = false
    safeCatch("test-context", new Error("catch me"), () => {
      fallbackCalled = true
    })

    console.error = original
    expect(logs.length).toBe(1)
    expect(logs[0][0]).toBe("[test-context]")
    expect(logs[0][1]).toBeInstanceOf(Error)
    expect((logs[0][1] as Error).message).toBe("catch me")
    expect(fallbackCalled).toBeTrue()
  })

  test("safeCatch works without fallback", () => {
    const logs: unknown[] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      logs.push(args)
    }

    safeCatch("no-fallback", { code: "E_FAIL" })

    console.error = original
    expect(logs.length).toBe(1)
    expect(logs[0]).toEqual(["[no-fallback]", { code: "E_FAIL" }])
  })
})
