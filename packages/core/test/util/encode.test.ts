import { describe, expect, test } from "bun:test"
import { base64Encode, base64Decode, checksum, sampledChecksum } from "@opencode-ai/core/util/encode"

describe("base64Encode", () => {
  test("encodes simple string", () => {
    expect(base64Encode("hello")).toBe("aGVsbG8")
  })

  test("produces url-safe output", () => {
    expect(base64Encode("+")).not.toContain("+")
    expect(base64Encode("/")).not.toContain("/")
  })
})

describe("base64Decode", () => {
  test("decodes roundtrip", () => {
    const original = "hello world"
    expect(base64Decode(base64Encode(original))).toBe(original)
  })

  test("decodes unicode", () => {
    const original = "日本語"
    expect(base64Decode(base64Encode(original))).toBe(original)
  })
})

describe("checksum", () => {
  test("returns undefined for empty string", () => {
    expect(checksum("")).toBeUndefined()
  })

  test("returns consistent value", () => {
    expect(checksum("hello")).toBe(checksum("hello"))
  })

  test("returns 36-base string", () => {
    const result = checksum("test")
    expect(typeof result).toBe("string")
    expect(result!.length).toBeGreaterThan(0)
  })
})

describe("sampledChecksum", () => {
  test("returns undefined for empty string", () => {
    expect(sampledChecksum("")).toBeUndefined()
  })

  test("falls back to checksum for short content", () => {
    const short = "x".repeat(100)
    expect(sampledChecksum(short)).toBe(checksum(short))
  })

  test("returns sampled format for long content", () => {
    const long = "x".repeat(600_000)
    const result = sampledChecksum(long)
    expect(result).toBeDefined()
    expect((result as string).startsWith(`${long.length}:`)).toBe(true)
  })
})
