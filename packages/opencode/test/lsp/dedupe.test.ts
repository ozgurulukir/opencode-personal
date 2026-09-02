import { describe, expect, test } from "bun:test"
import { diagnosticMessageKey } from "@/lsp/client"

describe("diagnosticMessageKey", () => {
  test("returns string messages as-is", () => {
    expect(diagnosticMessageKey("cannot find name 'foo'")).toBe("cannot find name 'foo'")
    expect(diagnosticMessageKey("")).toBe("")
  })

  test("keys MarkupContent objects by value", () => {
    expect(diagnosticMessageKey({ kind: "markdown", value: "**bold** rule" })).toBe("**bold** rule")
    expect(diagnosticMessageKey({ kind: "plain", value: "plain text" })).toBe("plain text")
  })

  test("merges the same value regardless of kind", () => {
    expect(diagnosticMessageKey({ kind: "plain", value: "x" })).toBe(diagnosticMessageKey({ kind: "markdown", value: "x" }))
  })

  test("keeps content-based discrimination for other objects", () => {
    expect(diagnosticMessageKey({ foo: 1 })).toBe("foo:1,")
    expect(diagnosticMessageKey({ foo: 1 })).not.toBe(diagnosticMessageKey({ foo: 2 }))
  })

  test("stringifies null", () => {
    expect(diagnosticMessageKey(null)).toBe("null")
  })
})
