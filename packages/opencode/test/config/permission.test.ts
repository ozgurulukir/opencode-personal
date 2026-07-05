import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Info } from "@/config/permission"

describe("Permission Config Schema Normalization", () => {
  test("normalizes shorthand action string to wildcard object", () => {
    const decoded = Schema.decodeSync(Info)("allow")
    expect(decoded).toEqual({ "*": "allow" })
  })

  test("normalizes shorthand action string 'deny'", () => {
    const decoded = Schema.decodeSync(Info)("deny")
    expect(decoded).toEqual({ "*": "deny" })
  })

  test("preserves detailed key permissions object", () => {
    const raw = {
      read: "allow" as const,
      edit: "deny" as const,
      bash: "ask" as const,
    }
    const decoded = Schema.decodeSync(Info)(raw)
    expect(decoded).toEqual(raw)
  })

  test("rejects invalid actions", () => {
    expect(() => Schema.decodeSync(Info)("invalid-action" as any)).toThrow()
    expect(() => Schema.decodeSync(Info)({ read: "invalid-action" as any } as any)).toThrow()
  })
})
