import { describe, expect, test } from "bun:test"
import {
  formatToolInput,
  resolveToolFiletype,
} from "@/cli/cmd/tui/routes/session/tool-helpers.shared"

describe("tool-helpers.shared", () => {
  test("formatToolInput formats primitive values into bracketed string", () => {
    expect(formatToolInput({ a: "foo", b: 42, c: true })).toBe("[a=foo, b=42, c=true]")
    expect(formatToolInput({})).toBe("")
    expect(formatToolInput({ complex: { nested: 1 } })).toBe("")
    expect(formatToolInput({ a: "foo", b: 42 }, ["b"])).toBe("[a=foo]")
  })

  test("resolveToolFiletype maps extensions to language strings", () => {
    expect(resolveToolFiletype(undefined)).toBe("none")
    expect(resolveToolFiletype("")).toBe("none")
    expect(resolveToolFiletype("foo.ts")).toBe("typescript")
    expect(resolveToolFiletype("foo.tsx")).toBe("typescript")
    expect(resolveToolFiletype("foo.js")).toBe("typescript")
    expect(resolveToolFiletype("foo.jsx")).toBe("typescript")
    expect(resolveToolFiletype("foo.py")).toBe("python")
  })
})
