import { describe, expect, test } from "bun:test"
import z from "zod"
import { NamedError } from "@opencode-ai/core/util/error"

const TestError = NamedError.create(
  "TestError",
  z.object({
    code: z.number(),
    detail: z.string(),
  }),
)

describe("NamedError.create", () => {
  test("sets name on class and instance", () => {
    expect(TestError.name).toBe("TestError")
    const err = new TestError({ code: 1, detail: "oops" })
    expect(err.name).toBe("TestError")
  })

  test("stores data on instance", () => {
    const data = { code: 404, detail: "not found" }
    const err = new TestError(data)
    expect(err.data).toEqual(data)
  })

  test("is an instance of Error", () => {
    const err = new TestError({ code: 1, detail: "x" })
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(NamedError)
  })

  test("toObject returns name and data", () => {
    const data = { code: 500, detail: "internal" }
    const err = new TestError(data)
    expect(err.toObject()).toEqual({ name: "TestError", data })
  })

  test("schema validates matching data", () => {
    const result = TestError.Schema.safeParse({ name: "TestError", data: { code: 1, detail: "x" } })
    expect(result.success).toBe(true)
  })

  test("schema rejects mismatched name", () => {
    const result = TestError.Schema.safeParse({ name: "WrongName", data: { code: 1, detail: "x" } })
    expect(result.success).toBe(false)
  })

  test("isInstance returns true for matching error", () => {
    const err = new TestError({ code: 1, detail: "x" })
    expect(TestError.isInstance(err)).toBe(true)
  })

  test("isInstance returns false for non-matching object", () => {
    expect(TestError.isInstance(new Error("other"))).toBe(false)
    expect(TestError.isInstance({ name: "Other" })).toBe(false)
  })

  test("isInstance returns false for null", () => {
    expect(TestError.isInstance(null)).toBe(false)
  })

  test("hasName discriminates by name string", () => {
    const err = new TestError({ code: 1, detail: "x" })
    expect(NamedError.hasName(err, "TestError")).toBe(true)
    expect(NamedError.hasName(err, "OtherError")).toBe(false)
    expect(NamedError.hasName(null, "TestError")).toBe(false)
  })

  test("supports ErrorOptions cause", () => {
    const cause = new Error("root")
    const err = new TestError({ code: 1, detail: "x" }, { cause })
    expect(err.cause).toBe(cause)
  })
})
