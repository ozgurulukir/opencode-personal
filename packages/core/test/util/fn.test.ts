import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { fn } from "@opencode-ai/core/util/fn"

describe("fn", () => {
  test("parses input through schema before calling cb", () => {
    const schema = z.object({ name: z.string(), count: z.number() })
    const result = fn(schema, (input) => input.name.toUpperCase())

    expect(result({ name: "alice", count: 1 })).toBe("ALICE")
  })

  test("throws zod error on invalid input", () => {
    const schema = z.object({ name: z.string() })
    const result = fn(schema, (input) => input.name)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => result({ name: 123 } as any)).toThrow()
  })

  test("force bypasses schema parsing", () => {
    const schema = z.object({ name: z.string() })
    const captured: unknown[] = []
    const result = fn(schema, (input) => {
      captured.push(input)
      return "ok"
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result.force({ name: 123 } as any)
    expect(captured[0]).toEqual({ name: 123 })
  })

  test("exposes schema", () => {
    const schema = z.object({ name: z.string() })
    const result = fn(schema, () => "ok")

    expect(result.schema).toBe(schema)
  })
})
