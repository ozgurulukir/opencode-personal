import { describe, expect, test } from "bun:test"
import { clean, heading, list, partState, record, same, summaryDiff, unwrap } from "./session-turn-utils"
import type { Part, SnapshotFileDiff } from "@opencode-ai/sdk/v2"

describe("session-turn-utils", () => {
  describe("record", () => {
    test("returns true for plain objects", () => {
      expect(record({})).toBe(true)
      expect(record({ a: 1 })).toBe(true)
    })

    test("returns false for non-objects", () => {
      expect(record(null)).toBe(false)
      expect(record(undefined)).toBe(false)
      expect(record("string")).toBe(false)
      expect(record(42)).toBe(false)
      expect(record([1, 2])).toBe(false)
    })
  })

  describe("unwrap", () => {
    test("returns original message when no JSON found", () => {
      expect(unwrap("Error: something went wrong")).toBe("Error: something went wrong")
    })

    test("extracts error.type: error.message from JSON", () => {
      const msg = JSON.stringify({ error: { type: "AuthError", message: "Invalid token" } })
      expect(unwrap(`Error: ${msg}`)).toBe("AuthError: Invalid token")
    })

    test("extracts nested JSON error message", () => {
      const inner = JSON.stringify({ error: { type: "RateLimit", message: "Too many requests" } })
      const outer = JSON.stringify(inner)
      expect(unwrap(`Error: ${outer}`)).toBe("RateLimit: Too many requests")
    })

    test("extracts error.message from JSON", () => {
      const msg = JSON.stringify({ error: { message: "Something failed" } })
      expect(unwrap(msg)).toBe("Something failed")
    })

    test("extracts error.code from JSON when no message", () => {
      const msg = JSON.stringify({ error: { code: "E001" } })
      expect(unwrap(msg)).toBe("E001")
    })

    test("extracts top-level message from JSON", () => {
      const msg = JSON.stringify({ message: "Top level message" })
      expect(unwrap(msg)).toBe("Top level message")
    })

    test("extracts top-level error string from JSON", () => {
      const msg = JSON.stringify({ error: "Error string" })
      expect(unwrap(msg)).toBe("Error string")
    })

    test("returns original message when JSON is not an object", () => {
      expect(unwrap("plain text")).toBe("plain text")
    })

    test("extracts JSON from braces in text", () => {
      const msg = `some text ${JSON.stringify({ error: { message: "Found in braces" } })}`
      expect(unwrap(msg)).toBe("Found in braces")
    })

    test("returns original when no JSON found in braces", () => {
      expect(unwrap("some text without json")).toBe("some text without json")
    })
  })

  describe("same", () => {
    test("returns true for identical arrays", () => {
      const arr = [1, 2, 3]
      expect(same(arr, arr)).toBe(true)
    })

    test("returns true for equal arrays", () => {
      expect(same([1, 2, 3], [1, 2, 3])).toBe(true)
    })

    test("returns false for different length arrays", () => {
      expect(same([1, 2], [1, 2, 3])).toBe(false)
    })

    test("returns false for different content", () => {
      expect(same([1, 2, 3], [1, 2, 4])).toBe(false)
    })
  })

  describe("list", () => {
    test("returns the array when value is an array", () => {
      expect(list([1, 2], [])).toEqual([1, 2])
    })

    test("returns fallback when value is undefined", () => {
      expect(list(undefined, [1])).toEqual([1])
    })

    test("returns fallback when value is null", () => {
      expect(list(null, [1])).toEqual([1])
    })
  })

  describe("summaryDiff", () => {
    test("returns true when diff has a file string", () => {
      expect(summaryDiff({ file: "src/index.ts", additions: 1, deletions: 0 } as SnapshotFileDiff)).toBe(true)
    })

    test("returns false when diff has no file property", () => {
      expect(summaryDiff({ additions: 1, deletions: 0 } as unknown as SnapshotFileDiff)).toBe(false)
    })
  })

  describe("partState", () => {
    test("returns 'visible' for tool parts not in hidden set", () => {
      const part = { type: "tool", tool: "read", state: { status: "completed" } } as unknown as Part
      expect(partState(part, true)).toBe("visible")
    })

    test("returns undefined for hidden tool (todowrite)", () => {
      const part = { type: "tool", tool: "todowrite", state: { status: "completed" } } as unknown as Part
      expect(partState(part, true)).toBeUndefined()
    })

    test("returns undefined for pending question tool", () => {
      const part = { type: "tool", tool: "question", state: { status: "pending" } } as unknown as Part
      expect(partState(part, true)).toBeUndefined()
    })

    test("returns undefined for running question tool", () => {
      const part = { type: "tool", tool: "question", state: { status: "running" } } as unknown as Part
      expect(partState(part, true)).toBeUndefined()
    })

    test("returns 'visible' for completed question tool", () => {
      const part = { type: "tool", tool: "question", state: { status: "completed" } } as unknown as Part
      expect(partState(part, true)).toBe("visible")
    })

    test("returns 'visible' for non-empty text parts", () => {
      const part = { type: "text", text: "hello" } as unknown as Part
      expect(partState(part, true)).toBe("visible")
    })

    test("returns undefined for empty text parts", () => {
      const part = { type: "text", text: "   " } as unknown as Part
      expect(partState(part, true)).toBeUndefined()
    })

    test("returns 'visible' for reasoning with text when showReasoningSummaries is true", () => {
      const part = { type: "reasoning", text: "thinking..." } as unknown as Part
      expect(partState(part, true)).toBe("visible")
    })

    test("returns undefined for reasoning with text when showReasoningSummaries is false", () => {
      const part = { type: "reasoning", text: "thinking..." } as unknown as Part
      expect(partState(part, false)).toBeUndefined()
    })

    test("returns undefined for reasoning without text", () => {
      const part = { type: "reasoning" } as unknown as Part
      expect(partState(part, true)).toBeUndefined()
    })

    test("returns 'visible' for parts in PART_MAPPING", () => {
      const part = { type: "file" } as unknown as Part
      expect(partState(part, true)).toBe("visible")
    })

    test("returns undefined for unknown part types", () => {
      const part = { type: "unknown" } as unknown as Part
      expect(partState(part, true)).toBeUndefined()
    })
  })

  describe("clean", () => {
    test("removes backtick code markers", () => {
      expect(clean("`code`")).toBe("code")
    })

    test("removes markdown links", () => {
      expect(clean("[text](url)")).toBe("text")
    })

    test("removes bold/italic markers", () => {
      expect(clean("**bold** *italic* ~strike~")).toBe("bold italic strike")
    })

    test("trims whitespace", () => {
      expect(clean("  hello  ")).toBe("hello")
    })
  })

  describe("heading", () => {
    test("extracts HTML heading", () => {
      expect(heading("<h1>Title</h1>")).toBe("Title")
    })

    test("extracts ATX heading", () => {
      expect(heading("# Hello World")).toBe("Hello World")
    })

    test("extracts ATX heading with closing hashes", () => {
      expect(heading("## Section Title ##")).toBe("Section Title")
    })

    test("extracts setext heading", () => {
      expect(heading("Section Title\n=========")).toBe("Section Title")
    })

    test("extracts strong text as heading fallback", () => {
      expect(heading("**Important**")).toBe("Important")
    })

    test("returns undefined for plain text without heading", () => {
      expect(heading("Just some text")).toBeUndefined()
    })

    test("returns undefined for empty string", () => {
      expect(heading("")).toBeUndefined()
    })
  })
})
