import { describe, expect, test } from "bun:test"
import { Info } from "@/config/reference"

describe("Reference Config Schema", () => {
  test("parses string entry reference", () => {
    const valid = {
      docs: "v1.0.0",
    }
    const result = Info.zod.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.docs).toBe("v1.0.0")
    }
  })

  test("parses Git reference entry", () => {
    const valid = {
      sdk: {
        repository: "opencode-ai/sdk-js",
        branch: "main",
      },
    }
    const result = Info.zod.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      const entry = result.data.sdk as any
      expect(entry.repository).toBe("opencode-ai/sdk-js")
      expect(entry.branch).toBe("main")
    }
  })

  test("parses Local reference entry", () => {
    const valid = {
      localRef: {
        path: "~/projects/opencode",
      },
    }
    const result = Info.zod.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      const entry = result.data.localRef as any
      expect(entry.path).toBe("~/projects/opencode")
    }
  })

  test("rejects invalid reference properties", () => {
    const invalid = {
      badRef: {
        invalidKey: "does-not-exist",
      },
    }
    const result = Info.zod.safeParse(invalid)
    expect(result.success).toBe(false)
  })
})
