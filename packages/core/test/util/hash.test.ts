import { describe, expect, test } from "bun:test"
import { Hash } from "@opencode-ai/core/util/hash"

describe("Hash.fast", () => {
  test("produces consistent sha1 hex for same input", () => {
    expect(Hash.fast("hello")).toBe(Hash.fast("hello"))
  })

  test("returns 40-char hex string", () => {
    const result = Hash.fast("hello")
    expect(result).toHaveLength(40)
    expect(/^[0-9a-f]+$/.test(result)).toBe(true)
  })

  test("handles buffer input", () => {
    const result = Hash.fast(Buffer.from("hello"))
    expect(result).toHaveLength(40)
    expect(/^[0-9a-f]+$/.test(result)).toBe(true)
  })

  test("known sha1 value", () => {
    // sha1("hello") standard output verified against node crypto
    expect(Hash.fast("hello")).toBe("aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d")
  })

  test("different inputs produce different hashes", () => {
    expect(Hash.fast("hello")).not.toBe(Hash.fast("world"))
  })

  test("produces consistent output", () => {
    const expected = Hash.fast("hello")
    expect(expected).toMatch(/^[0-9a-f]{40}$/)
  })
})
