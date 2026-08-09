import { describe, expect, test } from "bun:test"
import { decode64 } from "./base64"
import { base64Encode } from "@opencode-ai/core/util/encode"

describe("decode64", () => {
  test("returns undefined when value is undefined", () => {
    expect(decode64(undefined)).toBeUndefined()
  })

  test("decodes valid base64 strings", () => {
    const original = "Hello World! 😊"
    const encoded = base64Encode(original)
    expect(decode64(encoded)).toBe(original)

    // Also test a known base64 string
    expect(decode64("dGVzdA==")).toBe("test")
  })

  test("returns undefined for invalid base64 strings gracefully", () => {
    // These strings are not valid base64, triggering the catch block in decode64
    expect(decode64("invalid base64!!!")).toBeUndefined()
    expect(decode64("  ")).toBeUndefined()
  })
})
