import { describe, expect, test } from "bun:test"
import { Identifier } from "@opencode-ai/core/util/identifier"

describe("Identifier", () => {
  test("generates 26-character IDs", () => {
    expect(Identifier.ascending().length).toBe(26)
    expect(Identifier.descending().length).toBe(26)
  })

  test("ascending IDs sort lexicographically for increasing timestamps", () => {
    const a = Identifier.create(false, 1000)
    const b = Identifier.create(false, 2000)
    const c = Identifier.create(false, 3000)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  test("descending IDs sort inversely for increasing timestamps", () => {
    const a = Identifier.create(true, 1000)
    const b = Identifier.create(true, 2000)
    const c = Identifier.create(true, 3000)
    expect(a > b).toBe(true)
    expect(b > c).toBe(true)
  })

  test("ascending IDs are monotonic within same timestamp", () => {
    const ts = 5000
    const a = Identifier.create(false, ts)
    const b = Identifier.create(false, ts)
    const c = Identifier.create(false, ts)
    expect(a < b).toBe(true)
    expect(b < c).toBe(true)
  })

  test("descending IDs are monotonic within same timestamp", () => {
    const ts = 6000
    const a = Identifier.create(true, ts)
    const b = Identifier.create(true, ts)
    const c = Identifier.create(true, ts)
    expect(a > b).toBe(true)
    expect(b > c).toBe(true)
  })

  test("ascending and descending produce different prefixes for same timestamp", () => {
    const ts = 9000
    const asc = Identifier.create(false, ts)
    const desc = Identifier.create(true, ts)
    expect(asc.slice(0, 12)).not.toBe(desc.slice(0, 12))
  })

  test("IDs contain only hex prefix and base62 suffix", () => {
    const id = Identifier.ascending()
    const hexPrefix = id.slice(0, 12)
    const base62Suffix = id.slice(12)
    expect(hexPrefix).toMatch(/^[0-9a-f]{12}$/)
    expect(base62Suffix).toMatch(/^[0-9A-Za-z]{14}$/)
  })

  test("generates unique IDs across rapid calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => Identifier.ascending()))
    expect(ids.size).toBe(100)
  })
})
