import { describe, expect, it } from "bun:test"
import {
  createCommentMetadata,
  readCommentMetadata,
  formatCommentNote,
  parseCommentNote,
  type PromptComment,
} from "./comment-note"

describe("comment-note utils", () => {
  const dummySelection = { startLine: 1, startChar: 0, endLine: 5, endChar: 10 }

  describe("createCommentMetadata", () => {
    it("wraps input correctly", () => {
      const input: PromptComment = {
        path: "src/index.ts",
        comment: "This is a comment",
        selection: dummySelection,
        preview: "const x = 1",
        origin: "review",
      }
      const output = createCommentMetadata(input)
      expect(output).toEqual({
        opencodeComment: {
          path: "src/index.ts",
          comment: "This is a comment",
          selection: dummySelection,
          preview: "const x = 1",
          origin: "review",
        },
      })
    })

    it("wraps minimal input correctly", () => {
      const input: PromptComment = {
        path: "src/index.ts",
        comment: "This is a comment",
      }
      const output = createCommentMetadata(input)
      expect(output).toEqual({
        opencodeComment: {
          path: "src/index.ts",
          comment: "This is a comment",
          selection: undefined,
          preview: undefined,
          origin: undefined,
        },
      })
    })
  })

  describe("readCommentMetadata", () => {
    it("returns undefined for non-objects or null", () => {
      expect(readCommentMetadata(null)).toBeUndefined()
      expect(readCommentMetadata("string")).toBeUndefined()
      expect(readCommentMetadata(123)).toBeUndefined()
    })

    it("returns undefined if opencodeComment is missing or not an object", () => {
      expect(readCommentMetadata({})).toBeUndefined()
      expect(readCommentMetadata({ opencodeComment: "string" })).toBeUndefined()
      expect(readCommentMetadata({ opencodeComment: null })).toBeUndefined()
    })

    it("returns undefined if path or comment is missing/invalid type", () => {
      expect(readCommentMetadata({ opencodeComment: { path: "a" } })).toBeUndefined()
      expect(readCommentMetadata({ opencodeComment: { comment: "a" } })).toBeUndefined()
      expect(readCommentMetadata({ opencodeComment: { path: 1, comment: "a" } })).toBeUndefined()
    })

    it("parses valid full metadata correctly", () => {
      const value = {
        opencodeComment: {
          path: "src/main.ts",
          comment: "Refactor this",
          selection: dummySelection,
          preview: "foo bar",
          origin: "file",
        },
      }
      expect(readCommentMetadata(value)).toEqual({
        path: "src/main.ts",
        comment: "Refactor this",
        selection: dummySelection,
        preview: "foo bar",
        origin: "file",
      })
    })

    it("parses partial metadata without optional fields", () => {
      const value = {
        opencodeComment: {
          path: "src/main.ts",
          comment: "Refactor this",
        },
      }
      expect(readCommentMetadata(value)).toEqual({
        path: "src/main.ts",
        comment: "Refactor this",
        selection: undefined,
        preview: undefined,
        origin: undefined,
      })
    })

    it("ignores selection if it contains non-finite numbers or invalid shapes", () => {
      const value1 = {
        opencodeComment: {
          path: "p",
          comment: "c",
          selection: { startLine: "foo" }, // invalid
        },
      }
      expect(readCommentMetadata(value1)?.selection).toBeUndefined()

      const value2 = {
        opencodeComment: {
          path: "p",
          comment: "c",
          selection: "string", // invalid
        },
      }
      expect(readCommentMetadata(value2)?.selection).toBeUndefined()
    })

    it("ignores preview and origin if wrong type", () => {
      const value = {
        opencodeComment: {
          path: "p",
          comment: "c",
          preview: 123,
          origin: "invalid-origin",
        },
      }
      const parsed = readCommentMetadata(value)
      expect(parsed?.preview).toBeUndefined()
      expect(parsed?.origin).toBeUndefined()
    })
  })

  describe("formatCommentNote", () => {
    it("formats with no selection as 'this file'", () => {
      expect(
        formatCommentNote({
          path: "src/index.ts",
          comment: "Check it out",
        }),
      ).toBe("The user made the following comment regarding this file of src/index.ts: Check it out")
    })

    it("formats single line selection as 'line X'", () => {
      expect(
        formatCommentNote({
          path: "src/index.ts",
          comment: "Check it out",
          selection: { startLine: 10, startChar: 0, endLine: 10, endChar: 5 },
        }),
      ).toBe("The user made the following comment regarding line 10 of src/index.ts: Check it out")
    })

    it("formats multi-line selection as 'lines X through Y'", () => {
      expect(
        formatCommentNote({
          path: "src/index.ts",
          comment: "Check it out",
          selection: { startLine: 5, startChar: 0, endLine: 10, endChar: 5 },
        }),
      ).toBe("The user made the following comment regarding lines 5 through 10 of src/index.ts: Check it out")
    })

    it("handles inverted start/end lines properly", () => {
      expect(
        formatCommentNote({
          path: "src/index.ts",
          comment: "Check it out",
          selection: { startLine: 10, startChar: 0, endLine: 5, endChar: 5 },
        }),
      ).toBe("The user made the following comment regarding lines 5 through 10 of src/index.ts: Check it out")
    })
  })

  describe("parseCommentNote", () => {
    it("parses 'this file' string correctly", () => {
      const text = "The user made the following comment regarding this file of src/index.ts: Check it out"
      expect(parseCommentNote(text)).toEqual({
        path: "src/index.ts",
        comment: "Check it out",
        selection: undefined,
      })
    })

    it("parses 'line X' string correctly", () => {
      const text = "The user made the following comment regarding line 10 of src/index.ts: Check it out"
      expect(parseCommentNote(text)).toEqual({
        path: "src/index.ts",
        comment: "Check it out",
        selection: {
          startLine: 10,
          startChar: 0,
          endLine: 10,
          endChar: 0,
        },
      })
    })

    it("parses 'lines X through Y' string correctly", () => {
      const text =
        "The user made the following comment regarding lines 5 through 10 of src/index.ts: Check it out\nNew line here"
      expect(parseCommentNote(text)).toEqual({
        path: "src/index.ts",
        comment: "Check it out\nNew line here",
        selection: {
          startLine: 5,
          startChar: 0,
          endLine: 10,
          endChar: 0,
        },
      })
    })

    it("returns undefined for invalid text", () => {
      expect(parseCommentNote("This is not a matching string at all")).toBeUndefined()
    })
  })
})
