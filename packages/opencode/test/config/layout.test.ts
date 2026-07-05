import { describe, expect, test } from "bun:test"
import { Layout } from "@/config/layout"

describe("Layout Config Schema", () => {
  test("accepts valid layouts", () => {
    expect(Layout.zod.safeParse("auto").success).toBe(true)
    expect(Layout.zod.safeParse("stretch").success).toBe(true)
  })

  test("rejects invalid layouts", () => {
    expect(Layout.zod.safeParse("grid").success).toBe(false)
    expect(Layout.zod.safeParse("flex").success).toBe(false)
    expect(Layout.zod.safeParse("123").success).toBe(false)
  })
})
