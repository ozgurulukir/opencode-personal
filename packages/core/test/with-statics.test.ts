import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { withStatics } from "../src/schema"

describe("withStatics", () => {
  test("attaches static methods to Effect Schema via .pipe()", () => {
    const baseSchema = Schema.Struct({
      id: Schema.String,
      value: Schema.Number,
    })

    const ExtendedSchema = baseSchema.pipe(
      withStatics((schema) => ({
        createDefault: () => Schema.decodeSync(schema)({ id: "default", value: 0 }),
        isSchema: Schema.isSchema(schema),
      })),
    )

    expect(ExtendedSchema.isSchema).toBe(true)
    expect(ExtendedSchema.createDefault()).toEqual({ id: "default", value: 0 })

    const decoded = Schema.decodeSync(ExtendedSchema)({ id: "123", value: 42 })
    expect(decoded).toEqual({ id: "123", value: 42 })
  })

  test("allows chaining multiple withStatics calls via .pipe()", () => {
    const baseSchema = Schema.Struct({
      count: Schema.Number,
    })

    const ExtendedSchema = baseSchema
      .pipe(
        withStatics((schema) => ({
          makeZero: () => Schema.decodeSync(schema)({ count: 0 }),
        })),
      )
      .pipe(
        withStatics((schema) => ({
          makeTen: () => Schema.decodeSync(schema)({ count: 10 }),
        })),
      )

    expect(ExtendedSchema.makeZero()).toEqual({ count: 0 })
    expect(ExtendedSchema.makeTen()).toEqual({ count: 10 })
  })

  test("attaches custom static properties and methods via .pipe()", () => {
    const CustomSchema = Schema.String.pipe(
      withStatics((schema) => ({
        label: "custom-string-schema",
        parseOption: (input: unknown) => Schema.decodeUnknownOption(schema)(input),
      })),
    )

    expect(CustomSchema.label).toBe("custom-string-schema")
    expect(Option.isSome(CustomSchema.parseOption("hello"))).toBe(true)
    expect(Option.getOrNull(CustomSchema.parseOption("hello"))).toBe("hello")
  })
})
