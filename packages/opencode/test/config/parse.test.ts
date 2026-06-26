import { describe, expect, test } from "bun:test"
import { ConfigParse } from "@/config/parse"
import z from "zod"

describe("ConfigParse.jsonc", () => {
  test("parses valid JSONC with comments and trailing commas", () => {
    const input = `{
      // comment
      "a": 1,
      "b": "hello",
    }`
    const result = ConfigParse.jsonc(input, "test.jsonc")
    expect(result).toEqual({ a: 1, b: "hello" })
  })

  test("parses empty object", () => {
    expect(ConfigParse.jsonc("{}", "test.jsonc")).toEqual({})
  })

  test("throws JsonError on invalid JSON", () => {
    expect(() => ConfigParse.jsonc("{ invalid", "bad.jsonc")).toThrow()
  })

  test("throws JsonError with filepath in the error", () => {
    try {
      ConfigParse.jsonc("{ broken }", "my/path.jsonc")
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.data.path).toBe("my/path.jsonc")
    }
  })
})

describe("ConfigParse.schema", () => {
  const schema = z.object({ name: z.string(), count: z.number() })

  test("returns parsed data on valid input", () => {
    const result = ConfigParse.schema(schema, { name: "test", count: 5 }, "source")
    expect(result).toEqual({ name: "test", count: 5 })
  })

  test("throws InvalidError on validation failure", () => {
    expect(() => ConfigParse.schema(schema, { name: 123 }, "source")).toThrow()
  })

  test("throws InvalidError with path and issues", () => {
    try {
      ConfigParse.schema(schema, { name: 123 }, "my/config.json")
      expect(true).toBe(false)
    } catch (err: any) {
      expect(err.data.path).toBe("my/config.json")
      expect(err.data.issues).toBeDefined()
      expect(err.data.issues.length).toBeGreaterThan(0)
    }
  })
})
