import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  Newtype,
  NonNegativeInt,
  PositiveInt,
  optionalOmitUndefined,
  withStatics,
} from "../src/schema"

describe("schema", () => {
  describe("Newtype", () => {
    class UserID extends Newtype<UserID>()("UserID", Schema.String) {
      static create(id: string): UserID {
        return this.make(id)
      }
    }

    class QuestionID extends Newtype<QuestionID>()(
      "QuestionID",
      Schema.String.check(Schema.isStartsWith("que")),
    ) {
      static create(id: string): QuestionID {
        return this.make(id)
      }
    }

    test("make constructs the nominal scalar type from underlying type", () => {
      const id = UserID.make("usr_123")
      expect(id).toBe(UserID.make("usr_123"))

      const questionId = QuestionID.create("que_abc")
      expect(questionId).toBe(QuestionID.create("que_abc"))
    })

    test("acts as a valid schema with Schema.decodeUnknownSync and Schema.encodeSync", () => {
      const decoded = Schema.decodeUnknownSync(UserID)("usr_456")
      expect(decoded).toBe(UserID.make("usr_456"))

      const encoded = Schema.encodeSync(UserID)(decoded)
      expect(encoded).toBe("usr_456")
    })

    test("enforces underlying schema validation checks", () => {
      const valid = Schema.decodeUnknownSync(QuestionID)("que_123")
      expect(valid).toBe(QuestionID.make("que_123"))

      expect(() => Schema.decodeUnknownSync(QuestionID)("invalid_prefix")).toThrow()
    })

    test("works in composite struct schemas", () => {
      const User = Schema.Struct({
        id: UserID,
        name: Schema.String,
      })

      const decoded = Schema.decodeUnknownSync(User)({
        id: "usr_789",
        name: "Alice",
      })

      expect(decoded).toEqual({
        id: UserID.make("usr_789"),
        name: "Alice",
      })
    })
  })

  describe("PositiveInt", () => {
    test("validates integers greater than zero", () => {
      expect(Schema.decodeUnknownSync(PositiveInt)(1)).toBe(1)
      expect(Schema.decodeUnknownSync(PositiveInt)(42)).toBe(42)
    })

    test("rejects zero, negative integers, and floats", () => {
      expect(() => Schema.decodeUnknownSync(PositiveInt)(0)).toThrow()
      expect(() => Schema.decodeUnknownSync(PositiveInt)(-1)).toThrow()
      expect(() => Schema.decodeUnknownSync(PositiveInt)(1.5)).toThrow()
    })
  })

  describe("NonNegativeInt", () => {
    test("validates integers greater than or equal to zero", () => {
      expect(Schema.decodeUnknownSync(NonNegativeInt)(0)).toBe(0)
      expect(Schema.decodeUnknownSync(NonNegativeInt)(100)).toBe(100)
    })

    test("rejects negative integers and floats", () => {
      expect(() => Schema.decodeUnknownSync(NonNegativeInt)(-1)).toThrow()
      expect(() => Schema.decodeUnknownSync(NonNegativeInt)(2.7)).toThrow()
    })
  })

  describe("optionalOmitUndefined", () => {
    const TestSchema = Schema.Struct({
      name: Schema.String,
      bio: optionalOmitUndefined(Schema.String),
    })

    test("decodes object with optional field present or omitted", () => {
      const withBio = Schema.decodeUnknownSync(TestSchema)({ name: "Bob", bio: "Developer" })
      expect(withBio).toEqual({ name: "Bob", bio: "Developer" })

      const withoutBio = Schema.decodeUnknownSync(TestSchema)({ name: "Bob" })
      expect(withoutBio).toEqual({ name: "Bob" })
    })

    test("encodes undefined as omitted key", () => {
      const encoded = Schema.encodeSync(TestSchema)({ name: "Bob", bio: undefined })
      expect(encoded).toEqual({ name: "Bob" })
      expect("bio" in encoded).toBe(false)
    })
  })

  describe("withStatics", () => {
    test("attaches static methods/properties to schema", () => {
      const BaseSchema = Schema.String
      const EnhancedSchema = BaseSchema.pipe(
        withStatics((s) => ({
          defaultName: "Default",
          parseUpper: (val: unknown) => Schema.decodeUnknownSync(s)(val).toUpperCase(),
        })),
      )

      expect(EnhancedSchema.defaultName).toBe("Default")
      expect(EnhancedSchema.parseUpper("hello")).toBe("HELLO")
      expect(Schema.decodeUnknownSync(EnhancedSchema)("test")).toBe("test")
    })
  })
})
