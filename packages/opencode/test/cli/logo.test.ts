import { describe, expect, test } from "bun:test"
import { go, logo, marks } from "../../src/cli/logo"

describe("cli.logo", () => {
  describe("go", () => {
    test("has left and right sides with matching row counts", () => {
      expect(Array.isArray(go.left)).toBe(true)
      expect(Array.isArray(go.right)).toBe(true)
      expect(go.left.length).toBe(4)
      expect(go.right.length).toBe(4)
      expect(go.left.length).toBe(go.right.length)
    })

    test("has consistent row widths on left and right sides", () => {
      const leftWidths = go.left.map((row) => row.length)
      const rightWidths = go.right.map((row) => row.length)

      expect(new Set(leftWidths).size).toBe(1)
      expect(new Set(rightWidths).size).toBe(1)
      expect(leftWidths[0]).toBe(4)
      expect(rightWidths[0]).toBe(4)
    })

    test("matches the expected go logo structure", () => {
      expect(go).toEqual({
        left: ["    ", "█▀▀▀", "█_^█", "▀▀▀▀"],
        right: ["    ", "█▀▀█", "█__█", "▀▀▀▀"],
      })
    })
  })

  describe("logo", () => {
    test("has left and right sides with matching row counts", () => {
      expect(Array.isArray(logo.left)).toBe(true)
      expect(Array.isArray(logo.right)).toBe(true)
      expect(logo.left.length).toBe(4)
      expect(logo.right.length).toBe(4)
      expect(logo.left.length).toBe(logo.right.length)
    })

    test("has consistent row widths on left and right sides", () => {
      const leftWidths = logo.left.map((row) => row.length)
      const rightWidths = logo.right.map((row) => row.length)

      expect(new Set(leftWidths).size).toBe(1)
      expect(new Set(rightWidths).size).toBe(1)
      expect(leftWidths[0]).toBe(19)
      expect(rightWidths[0]).toBe(19)
    })

    test("matches the expected full logo structure", () => {
      expect(logo).toEqual({
        left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],
        right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],
      })
    })
  })

  describe("marks", () => {
    test("defines the expected mark character set", () => {
      expect(marks).toBe("_^~,")
    })

    test("contains all special markup characters used in logo and go glyphs", () => {
      const specialChars = new Set<string>()

      for (const row of [...logo.left, ...logo.right, ...go.left, ...go.right]) {
        for (const char of row) {
          if (["_", "^", "~", ","].includes(char)) {
            specialChars.add(char)
          }
        }
      }

      for (const char of specialChars) {
        expect(marks.includes(char)).toBe(true)
      }
    })
  })
})
