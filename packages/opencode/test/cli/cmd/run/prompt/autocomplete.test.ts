import { describe, expect, test } from "bun:test"
import {
  clamp,
  extractLineRange,
  removeLineRange,
  slashHead,
  slashQuery,
} from "@/cli/cmd/run/prompt/autocomplete"

describe("clamp", () => {
  test("clamps below minimum", () => {
    expect(clamp(0, 1, 6)).toBe(1)
  })

  test("clamps above maximum", () => {
    expect(clamp(10, 1, 6)).toBe(6)
  })

  test("passes through within range", () => {
    expect(clamp(3, 1, 6)).toBe(3)
  })

  test("handles boundary values", () => {
    expect(clamp(1, 1, 6)).toBe(1)
    expect(clamp(6, 1, 6)).toBe(6)
  })
})

describe("removeLineRange", () => {
  test("returns input unchanged when no hash", () => {
    expect(removeLineRange("hello world")).toBe("hello world")
  })

  test("strips line range suffix", () => {
    expect(removeLineRange("src/index.ts#42")).toBe("src/index.ts")
  })

  test("strips line range with end", () => {
    expect(removeLineRange("src/index.ts#42-100")).toBe("src/index.ts")
  })

  test("strips only the last hash segment", () => {
    expect(removeLineRange("foo#bar#baz")).toBe("foo#bar")
  })
})

describe("extractLineRange", () => {
  test("returns base only when no hash", () => {
    expect(extractLineRange("hello")).toEqual({ base: "hello" })
  })

  test("returns base only when hash has no line match", () => {
    expect(extractLineRange("file.txt#abc")).toEqual({ base: "file.txt" })
  })

  test("extracts single line number", () => {
    expect(extractLineRange("file.txt#42")).toEqual({ base: "file.txt", line: { start: 42 } })
  })

  test("extracts line range", () => {
    expect(extractLineRange("file.txt#42-100")).toEqual({ base: "file.txt", line: { start: 42, end: 100 } })
  })

  test("ignores invalid range where start >= end", () => {
    expect(extractLineRange("file.txt#100-42")).toEqual({ base: "file.txt", line: { start: 100 } })
  })

  test("handles open-ended range", () => {
    expect(extractLineRange("file.txt#42-")).toEqual({ base: "file.txt", line: { start: 42 } })
  })
})

describe("slashHead", () => {
  test("returns undefined for non-slash text", () => {
    expect(slashHead("hello")).toBeUndefined()
  })

  test("parses slash command with no arguments", () => {
    expect(slashHead("/exit")).toEqual({ name: "exit", arguments: "", end: 5 })
  })

  test("parses slash command with space separator", () => {
    expect(slashHead("/new my session")).toEqual({ name: "new", arguments: "my session", end: 4 })
  })

  test("parses slash command with tab separator", () => {
    expect(slashHead("/new\tmy session")).toEqual({ name: "new", arguments: "my session", end: 4 })
  })

  test("parses slash command with newline separator", () => {
    expect(slashHead("/new\nmy session")).toEqual({ name: "new", arguments: "my session", end: 4 })
  })

  test("handles single character command", () => {
    expect(slashHead("/a")).toEqual({ name: "a", arguments: "", end: 2 })
  })

  test("handles just slash", () => {
    expect(slashHead("/")).toEqual({ name: "", arguments: "", end: 1 })
  })
})

describe("slashQuery", () => {
  test("returns undefined for non-slash text", () => {
    expect(slashQuery("hello", 5)).toBeUndefined()
  })

  test("returns query when cursor is at end of slash head", () => {
    expect(slashQuery("/exit", 5)).toBe("exit")
  })

  test("returns undefined when cursor is past the slash head", () => {
    expect(slashQuery("/exit something", 5)).toBe("exit")
  })

  test("returns query when cursor is at end of partial slash command", () => {
    expect(slashQuery("/ex", 3)).toBe("ex")
  })

  test("returns query for partial slash command", () => {
    expect(slashQuery("/ex", 3)).toBe("ex")
  })
})
