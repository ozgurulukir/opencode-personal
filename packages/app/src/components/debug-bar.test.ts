import { describe, expect, test } from "bun:test"
import { bad, mb, ms, pruneAndFindMax, session, time } from "./debug-bar"

describe("debug-bar utilities", () => {
  describe("mb", () => {
    test("returns undefined for undefined or NaN", () => {
      expect(mb(undefined)).toBeUndefined()
      expect(mb(NaN)).toBeUndefined()
    })

    test("formats megabytes with 1 decimal place when under 1024 MB", () => {
      expect(mb(0)).toBe("0.0MB")
      expect(mb(1024 * 1024)).toBe("1.0MB")
      expect(mb(1.5 * 1024 * 1024)).toBe("1.5MB")
      expect(mb(500 * 1024 * 1024)).toBe("500.0MB")
    })

    test("formats megabytes with 0 decimal places when 1024 MB or greater", () => {
      expect(mb(1024 * 1024 * 1024)).toBe("1024MB")
      expect(mb(2048 * 1024 * 1024)).toBe("2048MB")
    })
  })

  describe("ms", () => {
    test("returns undefined for undefined or NaN", () => {
      expect(ms(undefined)).toBeUndefined()
      expect(ms(NaN)).toBeUndefined()
    })

    test("formats milliseconds with default 0 decimal places", () => {
      expect(ms(0)).toBe("0ms")
      expect(ms(12.34)).toBe("12ms")
      expect(ms(12.56)).toBe("13ms")
    })

    test("formats milliseconds with specified decimal places", () => {
      expect(ms(12.345, 2)).toBe("12.35ms")
      expect(ms(10.1, 1)).toBe("10.1ms")
    })
  })

  describe("time", () => {
    test("returns undefined for undefined or NaN", () => {
      expect(time(undefined)).toBeUndefined()
      expect(time(NaN)).toBeUndefined()
    })

    test("rounds number to nearest integer string", () => {
      expect(time(0)).toBe("0")
      expect(time(12.4)).toBe("12")
      expect(time(12.6)).toBe("13")
    })
  })

  describe("bad", () => {
    test("returns false for undefined or NaN", () => {
      expect(bad(undefined, 50)).toBe(false)
      expect(bad(NaN, 50)).toBe(false)
    })

    test("checks if value exceeds limit when low is false", () => {
      expect(bad(51, 50)).toBe(true)
      expect(bad(50, 50)).toBe(false)
      expect(bad(49, 50)).toBe(false)
    })

    test("checks if value is below limit when low is true", () => {
      expect(bad(49, 50, true)).toBe(true)
      expect(bad(50, 50, true)).toBe(false)
      expect(bad(51, 50, true)).toBe(false)
    })
  })

  describe("session", () => {
    test("returns true if path includes /session", () => {
      expect(session("/project/123/session/456")).toBe(true)
      expect(session("/session")).toBe(true)
    })

    test("returns false if path does not include /session", () => {
      expect(session("/project/123")).toBe(false)
      expect(session("/settings")).toBe(false)
    })
  })

  describe("pruneAndFindMax", () => {
    test("prunes stale entries older than span and calculates max delay and inp", () => {
      const seen = new Map([
        [1, { at: 1000, delay: 10, dur: 20 }],
        [2, { at: 5000, delay: 30, dur: 40 }],
        [3, { at: 5500, delay: 15, dur: 50 }],
      ])

      const result = pruneAndFindMax(seen, 7000, 5000)

      // Entry 1 (at: 1000) is older than 7000 - 5000 = 2000, so it should be pruned.
      expect(seen.has(1)).toBe(false)
      expect(seen.has(2)).toBe(true)
      expect(seen.has(3)).toBe(true)

      // Max delay among remaining (2 and 3) is 30
      // Max dur (inp) among remaining (2 and 3) is 50
      expect(result).toEqual({ delay: 30, inp: 50 })
    })

    test("returns 0 for delay and inp if all entries are pruned or map is empty", () => {
      const seen = new Map([[1, { at: 1000, delay: 10, dur: 20 }]])

      const result = pruneAndFindMax(seen, 7000, 5000)

      expect(seen.size).toBe(0)
      expect(result).toEqual({ delay: 0, inp: 0 })
    })
  })
})
