import { describe, expect, test } from "bun:test"
import { Info } from "@/config/attachment"

describe("Attachment Config Schema", () => {
  test("parses valid image configuration", () => {
    const valid = {
      image: {
        auto_resize: true,
        max_width: 1920,
        max_height: 1080,
        max_base64_bytes: 1048576,
      },
    }
    const result = Info.zod.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.image?.auto_resize).toBe(true)
      expect(result.data.image?.max_width).toBe(1920)
      expect(result.data.image?.max_height).toBe(1080)
      expect(result.data.image?.max_base64_bytes).toBe(1048576)
    }
  })

  test("rejects zero or negative dimensions (PositiveInt constraint)", () => {
    const invalidZero = {
      image: {
        max_width: 0,
      },
    }
    const invalidNegative = {
      image: {
        max_height: -10,
      },
    }
    expect(Info.zod.safeParse(invalidZero).success).toBe(false)
    expect(Info.zod.safeParse(invalidNegative).success).toBe(false)
  })

  test("rejects non-boolean auto_resize", () => {
    const invalid = {
      image: {
        auto_resize: "yes",
      },
    }
    expect(Info.zod.safeParse(invalid).success).toBe(false)
  })
})
