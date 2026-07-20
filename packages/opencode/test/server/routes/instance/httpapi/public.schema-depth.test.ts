import { describe, expect, test } from "bun:test"
import { stripOptionalNull } from "../../../../../src/server/routes/instance/httpapi/public"

type OpenApiSchema = {
  $ref?: string
  additionalProperties?: OpenApiSchema | boolean
  allOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  description?: string
  enum?: Array<string | boolean>
  items?: OpenApiSchema
  maximum?: number
  minimum?: number
  minLength?: number
  oneOf?: OpenApiSchema[]
  pattern?: string
  prefixItems?: OpenApiSchema[]
  properties?: Record<string, OpenApiSchema>
  required?: string[]
  type?: string
}

describe("stripOptionalNull depth protection", () => {
  describe("deep nesting protection", () => {
    test("handles deeply nested allOf without stack overflow", () => {
      let schema: OpenApiSchema = { type: "string" }
      for (let i = 0; i < 150; i++) {
        schema = { allOf: [schema] }
      }

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(typeof result).toBe("object")
    })

    test("handles deeply nested anyOf without stack overflow", () => {
      let schema: OpenApiSchema = { type: "string" }
      for (let i = 0; i < 150; i++) {
        schema = { anyOf: [schema, { type: "null" }] }
      }

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(typeof result).toBe("object")
    })

    test("handles deeply nested properties without stack overflow", () => {
      let inner: OpenApiSchema = { type: "string" }
      for (let i = 0; i < 150; i++) {
        inner = { properties: { nested: inner } }
      }
      const schema: OpenApiSchema = { type: "object", properties: { deep: inner } }

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(typeof result).toBe("object")
    })

    test("handles deeply nested items without stack overflow", () => {
      let inner: OpenApiSchema = { type: "string" }
      for (let i = 0; i < 150; i++) {
        inner = { items: inner }
      }
      const schema: OpenApiSchema = { type: "array", items: inner }

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(typeof result).toBe("object")
    })

    test("handles deeply nested additionalProperties without stack overflow", () => {
      let inner: OpenApiSchema = { type: "string" }
      for (let i = 0; i < 150; i++) {
        inner = { additionalProperties: inner }
      }
      const schema: OpenApiSchema = { type: "object", additionalProperties: inner }

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(typeof result).toBe("object")
    })
  })

  describe("circular reference protection", () => {
    test("handles self-referencing allOf without infinite loop", () => {
      const schema: OpenApiSchema = { type: "object" }
      schema.allOf = [schema]

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(typeof result).toBe("object")
    })

    test("handles self-referencing anyOf without infinite loop", () => {
      const schema: OpenApiSchema = { type: "object" }
      schema.anyOf = [schema, { type: "null" }]

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(typeof result).toBe("object")
    })

    test("handles self-referencing properties without infinite loop", () => {
      const schema: OpenApiSchema = { type: "object" }
      schema.properties = { self: schema }

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(typeof result).toBe("object")
    })

    test("handles self-referencing items without infinite loop", () => {
      const schema: OpenApiSchema = { type: "array" }
      schema.items = schema

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(typeof result).toBe("object")
    })

    test("handles mutual circular reference without infinite loop", () => {
      const a: OpenApiSchema = { type: "object" }
      const b: OpenApiSchema = { type: "object" }
      a.properties = { b }
      b.properties = { a }

      const result = stripOptionalNull(a)
      expect(result).toBeDefined()
      expect(typeof result).toBe("object")
    })
  })

  describe("wide schema handling", () => {
    test("handles schema with 1000+ properties", () => {
      const properties: Record<string, OpenApiSchema> = {}
      for (let i = 0; i < 1000; i++) {
        properties[`prop${i}`] = { type: "string" }
      }
      const schema: OpenApiSchema = { type: "object", properties }

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(result.type).toBe("object")
      expect(Object.keys(result.properties ?? {})).toHaveLength(1000)
    })

    test("handles schema with 1000+ anyOf options", () => {
      const anyOf: OpenApiSchema[] = []
      for (let i = 0; i < 1000; i++) {
        anyOf.push({ type: "string" })
      }
      const schema: OpenApiSchema = { anyOf }

      const result = stripOptionalNull(schema)
      expect(result).toBeDefined()
      expect(result.anyOf).toHaveLength(1000)
    })
  })

  describe("core functionality preservation", () => {
    test("strips null from simple optional schema", () => {
      const schema: OpenApiSchema = { anyOf: [{ type: "string" }, { type: "null" }] }
      const result = stripOptionalNull(schema)
      expect(result).toEqual({ type: "string" })
    })

    test("strips null from nested optional schema", () => {
      const schema: OpenApiSchema = {
        type: "object",
        properties: {
          name: { anyOf: [{ type: "string" }, { type: "null" }] },
          age: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
      }
      const result = stripOptionalNull(schema)
      expect(result.properties?.name).toEqual({ type: "string" })
      expect(result.properties?.age).toEqual({ type: "number" })
    })

    test("preserves non-null anyOf", () => {
      const schema: OpenApiSchema = { anyOf: [{ type: "string" }, { type: "number" }] }
      const result = stripOptionalNull(schema)
      expect(result.anyOf).toHaveLength(2)
    })

    test("handles empty schema", () => {
      const schema: OpenApiSchema = {}
      const result = stripOptionalNull(schema)
      expect(result).toEqual({})
    })

    test("handles schema with only type", () => {
      const schema: OpenApiSchema = { type: "string" }
      const result = stripOptionalNull(schema)
      expect(result).toEqual({ type: "string" })
    })

    test("handles allOf with single constraint", () => {
      const schema: OpenApiSchema = { allOf: [{ type: "string" }] }
      const result = stripOptionalNull(schema)
      expect(result).toEqual({ type: "string" })
    })

    test("handles allOf with multiple constraints", () => {
      const schema: OpenApiSchema = { allOf: [{ type: "string" }, { minLength: 1 }] }
      const result = stripOptionalNull(schema)
      // When schema.type is not set, allOf is preserved as-is
      expect(result.allOf).toHaveLength(2)
      expect(result.allOf![0].type).toBe("string")
      expect(result.allOf![1].minLength).toBe(1)
    })

    test("handles items schema", () => {
      const schema: OpenApiSchema = {
        type: "array",
        items: { anyOf: [{ type: "string" }, { type: "null" }] },
      }
      const result = stripOptionalNull(schema)
      expect(result.items).toEqual({ type: "string" })
    })

    test("handles additionalProperties schema", () => {
      const schema: OpenApiSchema = {
        type: "object",
        additionalProperties: { anyOf: [{ type: "string" }, { type: "null" }] },
      }
      const result = stripOptionalNull(schema)
      expect(result.additionalProperties).toEqual({ type: "string" })
    })

    test("handles prefixItems with items", () => {
      const schema: OpenApiSchema = {
        type: "array",
        prefixItems: [{ type: "string" }],
        items: { type: "string" },
      }
      const result = stripOptionalNull(schema)
      // prefixItems should be deleted when items is also present
      expect(result.prefixItems).toBeUndefined()
      expect(result.items).toEqual({ type: "string" })
    })
  })
})
