import { describe, expect, test } from "bun:test"
import { bad, mb, ms, pruneAndFindMax, session, time } from "./debug-bar"

describe("ms", () => {
  test("returns undefined for undefined input", () => {
    expect(ms(undefined)).toBeUndefined()
  })

  test("returns undefined for NaN input", () => {
    expect(ms(Number.NaN)).toBeUndefined()
  })

  test("formats numbers with default 0 decimal places", () => {
    expect(ms(0)).toBe("0ms")
    expect(ms(123)).toBe("123ms")
    expect(ms(123.456)).toBe("123ms")
    expect(ms(-10.5)).toBe("-11ms")
  })

  test("formats numbers with specified decimal places", () => {
    expect(ms(123.456, 1)).toBe("123.5ms")
    expect(ms(123.456, 2)).toBe("123.46ms")
    expect(ms(0, 2)).toBe("0.00ms")
  })
})

describe("time", () => {
  test("returns undefined for undefined input", () => {
    expect(time(undefined)).toBeUndefined()
  })

  test("returns undefined for NaN input", () => {
    expect(time(Number.NaN)).toBeUndefined()
  })

  test("rounds and formats numbers to integer string", () => {
    expect(time(0)).toBe("0")
    expect(time(12.3)).toBe("12")
    expect(time(12.7)).toBe("13")
  })
})

describe("mb", () => {
  test("returns undefined for undefined input", () => {
    expect(mb(undefined)).toBeUndefined()
  })

  test("returns undefined for NaN input", () => {
    expect(mb(Number.NaN)).toBeUndefined()
  })

  test("formats bytes into MB with 1 decimal place when < 1024MB", () => {
    expect(mb(0)).toBe("0.0MB")
    expect(mb(1024 * 1024)).toBe("1.0MB")
    expect(mb(1.5 * 1024 * 1024)).toBe("1.5MB")
  })

  test("formats bytes into MB with 0 decimal places when >= 1024MB", () => {
    expect(mb(1024 * 1024 * 1024)).toBe("1024MB")
    expect(mb(1024 * 1024 * 2048)).toBe("2048MB")
  })
})

describe("bad", () => {
  test("returns false for undefined or NaN", () => {
    expect(bad(undefined, 100)).toBe(false)
    expect(bad(Number.NaN, 100)).toBe(false)
  })

  test("evaluates high thresholds when low flag is false", () => {
    expect(bad(100, 100)).toBe(false)
    expect(bad(101, 100)).toBe(true)
    expect(bad(99, 100)).toBe(false)
  })

  test("evaluates low thresholds when low flag is true", () => {
    expect(bad(50, 50, true)).toBe(false)
    expect(bad(49, 50, true)).toBe(true)
    expect(bad(51, 50, true)).toBe(false)
  })
})

describe("session", () => {
  test("checks if route path includes /session", () => {
    expect(session("/session/123")).toBe(true)
    expect(session("/project/session")).toBe(true)
    expect(session("/settings")).toBe(false)
  })
})

describe("pruneAndFindMax", () => {
  test("prunes stale entries older than span and finds max delay and duration", () => {
    const seen = new Map([
      [1, { at: 4000, delay: 10, dur: 20 }],
      [2, { at: 6000, delay: 100, dur: 150 }],
      [3, { at: 8000, delay: 50, dur: 300 }],
    ])

    const result = pruneAndFindMax(seen, 10000, 5000)

    expect(result).toEqual({ delay: 100, inp: 300 })
    expect(seen.has(1)).toBe(false)
    expect(seen.has(2)).toBe(true)
    expect(seen.has(3)).toBe(true)
  })
})
