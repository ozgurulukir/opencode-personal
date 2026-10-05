import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { fn } from "../../src/util/fn"

describe("util.fn", () => {
  test("parses input through schema before calling callback", () => {
    const schema = z.object({ name: z.string(), count: z.number() })
    const result = fn(schema, (input) => input.name.toUpperCase())

    expect(result({ name: "alice", count: 1 })).toBe("ALICE")
  })

  test("throws zod error on invalid input", () => {
    const schema = z.object({ name: z.string() })
    const result = fn(schema, (input) => input.name)

    // oxlint-disable-next-line no-unsafe-type-assertion
    expect(() => result({ name: 123 } as unknown as { name: string })).toThrow(z.ZodError)
  })

  test("force bypasses schema parsing", () => {
    const schema = z.object({ name: z.string() })
    const captured: unknown[] = []
    const result = fn(schema, (input) => {
      captured.push(input)
      return "ok"
    })
    // oxlint-disable-next-line no-unsafe-type-assertion
    result.force({ name: 123 } as unknown as { name: string })
    expect(captured[0]).toEqual({ name: 123 })
  })

  test("exposes schema", () => {
    const schema = z.object({ name: z.string() })
    const result = fn(schema, () => "ok")

    expect(result.schema).toBe(schema)
  })
})
