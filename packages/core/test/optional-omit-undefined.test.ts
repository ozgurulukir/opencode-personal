import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { optionalOmitUndefined } from "@opencode-ai/core/schema"
import { zod } from "@opencode-ai/core/effect-zod"

describe("schema", () => {
  describe("optionalOmitUndefined", () => {
    const Person = Schema.Struct({
      name: Schema.String,
      age: optionalOmitUndefined(Schema.Number),
    })

    test("decodes object with value present", () => {
      const decoded = Schema.decodeSync(Person)({ name: "Alice", age: 30 })
      expect(decoded).toEqual({ name: "Alice", age: 30 })
    })

    test("decodes object when key is omitted", () => {
      const decoded = Schema.decodeSync(Person)({ name: "Bob" })
      expect(decoded).toEqual({ name: "Bob" })
    })

    test("encodes object with value present", () => {
      const encoded = Schema.encodeSync(Person)({ name: "Alice", age: 30 })
      expect(encoded).toEqual({ name: "Alice", age: 30 })
    })

    test("encodes object when key is omitted", () => {
      const encoded = Schema.encodeSync(Person)({ name: "Bob" })
      expect(encoded).toEqual({ name: "Bob" })
    })

    test("encodes object when key is explicitly undefined by omitting the key", () => {
      const encoded = Schema.encodeSync(Person)({ name: "Charlie", age: undefined })
      expect(encoded).toEqual({ name: "Charlie" })
      expect("age" in encoded).toBe(false)
      expect(JSON.stringify(encoded)).toBe('{"name":"Charlie"}')
    })

    test("preserves Zod schema conversion via ZodOverride annotation", () => {
      const zodSchema = zod(Person)
      expect(zodSchema.safeParse({ name: "Alice", age: 30 }).success).toBe(true)
      expect(zodSchema.safeParse({ name: "Bob" }).success).toBe(true)
      expect(zodSchema.safeParse({ name: "Charlie", age: undefined }).success).toBe(true)
      expect(zodSchema.safeParse({ name: "Dave", age: "invalid" }).success).toBe(false)
    })
  })
})
