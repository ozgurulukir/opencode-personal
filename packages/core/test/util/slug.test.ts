import { describe, expect, test, spyOn } from "bun:test"
import { Slug } from "@opencode-ai/core/util/slug"

describe("Slug", () => {
  describe("create", () => {
    test("generates a string in the format adjective-noun", () => {
      const slug = Slug.create()
      expect(typeof slug).toBe("string")
      expect(slug).toMatch(/^[a-z]+-[a-z]+$/)
    })

    test("picks the first adjective and noun when Math.random is 0", () => {
      const randomSpy = spyOn(Math, "random").mockReturnValue(0)

      expect(Slug.create()).toBe("brave-cabin")

      randomSpy.mockRestore()
    })

    test("picks the last adjective and noun when Math.random is close to 1", () => {
      // 0.999 will floor to length - 1
      const randomSpy = spyOn(Math, "random").mockReturnValue(0.999)

      expect(Slug.create()).toBe("witty-wolf")

      randomSpy.mockRestore()
    })

    test("generates different slugs across multiple calls", () => {
      const slugs = new Set(Array.from({ length: 10 }, () => Slug.create()))
      expect(slugs.size).toBeGreaterThan(1)
    })
  })
})
