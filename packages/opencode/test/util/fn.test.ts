import { afterEach, describe, expect, test, spyOn, mock } from "bun:test"
import { z } from "zod"
import * as Log from "@opencode-ai/core/util/log"
import { fn } from "../../src/util/fn"

afterEach(() => mock.restore())

describe("util.fn", () => {
  test("parses input through schema before calling callback", () => {
    const schema = z.object({ name: z.string(), count: z.number() })
    const wrapper = fn(schema, (input) => `${input.name}: ${input.count}`)

    const result = wrapper({ name: "alice", count: 5 })
    expect(result).toBe("alice: 5")
  })

  test("passes transformed/coerced parsed output to callback", () => {
    const schema = z.object({
      age: z.coerce.number(),
      code: z.string().transform((val) => val.toUpperCase()),
    })
    let capturedInput: unknown
    const wrapper = fn(schema, (input) => {
      capturedInput = input
      return input.code
    })

    // Pass string "42" for age which coerce transforms to number 42
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const result = wrapper({ age: "42", code: "hello" } as unknown as { age: number; code: string })
    expect(result).toBe("HELLO")
    expect(capturedInput).toEqual({ age: 42, code: "HELLO" })
  })

  test("logs error and rethrows when validation fails with ZodError", () => {
    const logSpy = spyOn(Log.create({ service: "fn" }), "error").mockImplementation(() => {})

    const schema = z.object({ email: z.string().email() })
    const wrapper = fn(schema, (input) => input.email)

    expect(() => wrapper({ email: "not-an-email" })).toThrow(z.ZodError)

    expect(logSpy).toHaveBeenCalledWith("schema validation failure", { issues: expect.stringContaining("email") })

    logSpy.mockRestore()
  })

  test("logs error and rethrows non-Zod errors thrown during schema parse", () => {
    const logSpy = spyOn(Log.create({ service: "fn" }), "error").mockImplementation(() => {})

    const customError = new Error("Custom parsing failure")
    const schema = z.string().transform<string>(() => {
      throw customError
    })
    const wrapper = fn(schema, (input) => input)

    expect(() => wrapper("test")).toThrow("Custom parsing failure")
    expect(logSpy).toHaveBeenCalledWith("schema validation failure", { issues: String(customError) })

    logSpy.mockRestore()
  })

  test("force bypasses schema validation", () => {
    const schema = z.object({ count: z.number() })
    let receivedInput: unknown = null
    const wrapper = fn(schema, (input) => {
      receivedInput = input
      return "forced"
    })

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const result = wrapper.force({ count: "invalid-number" } as unknown as { count: number })
    expect(result).toBe("forced")
    expect(receivedInput).toEqual({ count: "invalid-number" })
  })

  test("exposes the underlying schema property", () => {
    const schema = z.object({ id: z.string() })
    const wrapper = fn(schema, (input) => input.id)

    expect(wrapper.schema).toBe(schema)
  })
})
