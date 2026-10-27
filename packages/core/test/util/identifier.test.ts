import { describe, expect, test } from "bun:test"
import { Identifier } from "@opencode-ai/core/util/identifier"

describe("Identifier", () => {
  test("generates 28-character IDs", () => {
    expect(Identifier.ascending().length).toBe(28)
    expect(Identifier.descending().length).toBe(28)
  })

  test("ascending IDs sort lexicographically for increasing timestamps", () => {
    const a = Identifier.create(false, 1_700_000_000_000)
    const b = Identifier.create(false, 1_800_000_000_000)
    const c = Identifier.create(false, 1_900_000_000_000)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  test("descending IDs sort inversely for increasing timestamps", () => {
    const a = Identifier.create(true, 1_700_000_000_000)
    const b = Identifier.create(true, 1_800_000_000_000)
    const c = Identifier.create(true, 1_900_000_000_000)
    expect(a > b).toBe(true)
    expect(b > c).toBe(true)
  })

  test("ascending IDs are monotonic within same timestamp", () => {
    const ts = 1_700_000_000_000
    const a = Identifier.create(false, ts)
    const b = Identifier.create(false, ts)
    const c = Identifier.create(false, ts)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  test("descending IDs are monotonic within same timestamp", () => {
    const ts = 1_700_000_000_000
    const a = Identifier.create(true, ts)
    const b = Identifier.create(true, ts)
    const c = Identifier.create(true, ts)
    expect(a > b).toBe(true)
    expect(b > c).toBe(true)
  })

  test("ascending and descending produce different prefixes for same timestamp", () => {
    const ts = 1_700_000_000_000
    const asc = Identifier.create(false, ts)
    const desc = Identifier.create(true, ts)
    expect(asc.slice(0, 14)).not.toBe(desc.slice(0, 14))
  })

  test("IDs contain only hex prefix and base62 suffix", () => {
    const id = Identifier.ascending()
    const hexPrefix = id.slice(0, 14)
    const base62Suffix = id.slice(14)
    expect(hexPrefix).toMatch(/^[0-9a-f]{14}$/)
    expect(base62Suffix).toMatch(/^[0-9A-Za-z]{14}$/)
  })

  test("generates unique IDs across rapid calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => Identifier.ascending()))
    expect(ids.size).toBe(100)
  })

  test("generates uniform base62 characters without out-of-range values", () => {
    const chars = new Set<string>()
    for (let i = 0; i < 500; i++) {
      const id = Identifier.ascending()
      const suffix = id.slice(14)
      for (const ch of suffix) {
        chars.add(ch)
      }
    }
    // Across 500 * 14 = 7000 characters, virtually all 62 characters should appear
    expect(chars.size).toBeGreaterThanOrEqual(60)
  })
})
