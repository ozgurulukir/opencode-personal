import { describe, expect, test } from "bun:test"
import { Info } from "@/config/skills"

describe("ConfigSkills Schema", () => {
  test("parses valid paths and urls", () => {
    const valid = {
      paths: ["/some/path", "../another/path"],
      urls: ["https://example.com/skills"],
    }
    const result = Info.zod.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.paths).toEqual(valid.paths)
      expect(result.data.urls).toEqual(valid.urls)
    }
  })

  test("accepts empty or missing properties", () => {
    const result = Info.zod.safeParse({})
    expect(result.success).toBe(true)
  })

  test("rejects invalid path elements", () => {
    const invalid = {
      paths: [123],
    }
    const result = Info.zod.safeParse(invalid)
    expect(result.success).toBe(false)
  })
})
