import { describe, expect, test, spyOn } from "bun:test"
import { Slug } from "@opencode-ai/core/util/slug"

describe("Slug", () => {
  describe("create", () => {
    test("generates a string in the format adjective-noun", () => {
      const slug = Slug.create()
      expect(typeof slug).toBe("string")
      expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
    })

    test("picks the first adjective and noun when getRandomValues returns 0", () => {
      const randomSpy = spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint32Array) {
          array.fill(0)
        }
        return array
      })

      expect(Slug.create()).toBe("brave-cabin")

      randomSpy.mockRestore()
    })

    test("picks specific adjective and noun indices based on getRandomValues", () => {
      let callCount = 0
      const randomSpy = spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
        callCount++
        // ADJECTIVES length = 29, NOUNS length = 31
        // 28 % 29 = 28 ("witty")
        // 30 % 31 = 30 ("wolf")
        if (array instanceof Uint32Array) {
          array[0] = callCount === 1 ? 28 : 30
        }
        return array
      })

      expect(Slug.create()).toBe("witty-wolf")

      randomSpy.mockRestore()
    })

    test("generates different slugs across multiple calls", () => {
      const slugs = new Set(Array.from({ length: 10 }, () => Slug.create()))
      expect(slugs.size).toBeGreaterThan(1)
    })
  })
})
