import { describe, expect, test } from "bun:test"
import { SearchInfo } from "@/config/search"

describe("SearchInfo Schema", () => {
  test("parses valid embedding config with local provider", () => {
    const valid = {
      embedding: {
        provider: "local",
        model: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
      },
    }
    const result = SearchInfo.zod.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.embedding?.provider).toBe("local")
      expect(result.data.embedding?.model).toBe("Xenova/all-MiniLM-L6-v2")
      expect(result.data.embedding?.dimension).toBe(384)
    }
  })

  test("parses valid embedding config with openai provider", () => {
    const valid = {
      embedding: {
        provider: "openai",
        model: "text-embedding-3-small",
        dimension: 1536,
        openaiApiKey: "sk-proj-12345",
      },
    }
    const result = SearchInfo.zod.safeParse(valid)
    expect(result.success).toBe(true)
  })

  test("rejects invalid provider", () => {
    const invalid = {
      embedding: {
        provider: "other-provider",
      },
    }
    const result = SearchInfo.zod.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("rejects negative dimensions", () => {
    const invalid = {
      embedding: {
        provider: "local",
        dimension: -10,
      },
    }
    const result = SearchInfo.zod.safeParse(invalid)
    expect(result.success).toBe(false)
  })
})
