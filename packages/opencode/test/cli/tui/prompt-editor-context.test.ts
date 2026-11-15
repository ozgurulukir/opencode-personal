import { describe, expect, test } from "bun:test"
import {
  formatEditorContext,
  formatEditorFileLabel,
  getEditorRangeLabel,
  hasEditorRangeSelection,
} from "@/cli/cmd/tui/component/prompt/editor-context"
import type { EditorSelection } from "@/cli/cmd/tui/context/editor"

describe("editor-context", () => {
  test("hasEditorRangeSelection detects line and character differences", () => {
    expect(
      hasEditorRangeSelection({
        text: "",
        selection: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
      }),
    ).toBe(false)

    expect(
      hasEditorRangeSelection({
        text: "hello",
        selection: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 5 },
        },
      }),
    ).toBe(true)

    expect(
      hasEditorRangeSelection({
        text: "multi\nline",
        selection: {
          start: { line: 1, character: 0 },
          end: { line: 2, character: 0 },
        },
      }),
    ).toBe(true)
  })

  test("getEditorRangeLabel returns single-line and multi-line hashes", () => {
    expect(
      getEditorRangeLabel({
        text: "hello",
        selection: {
          start: { line: 10, character: 0 },
          end: { line: 10, character: 5 },
        },
      }),
    ).toBe("#10")

    expect(
      getEditorRangeLabel({
        text: "hello",
        selection: {
          start: { line: 10, character: 0 },
          end: { line: 15, character: 5 },
        },
      }),
    ).toBe("#10-15")

    expect(
      getEditorRangeLabel({
        text: "",
        selection: {
          start: { line: 10, character: 0 },
          end: { line: 10, character: 0 },
        },
      }),
    ).toBeUndefined()
  })

  test("formatEditorContext formats file opened reminder when no selection", () => {
    const selection: EditorSelection = {
      filePath: "/path/to/file.ts",
      ranges: [
        {
          text: "",
          selection: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 0 },
          },
        },
      ],
    }

    expect(formatEditorContext(selection)).toBe(
      '<system-reminder>Note: The user opened the file "/path/to/file.ts". This may or may not be relevant to the current task.</system-reminder>\n',
    )
  })

  test("formatEditorContext formats selections when ranges are non-empty", () => {
    const selection: EditorSelection = {
      filePath: "/path/to/file.ts",
      ranges: [
        {
          text: "const x = 1",
          selection: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 11 },
          },
        },
      ],
    }

    expect(formatEditorContext(selection)).toContain(
      'Note: The user selected #5 from "/path/to/file.ts". ```const x = 1```',
    )
  })

  test("formatEditorFileLabel handles index files by including parent dir", () => {
    expect(formatEditorFileLabel("/src/app/index.ts", " #5")).toBe("app/index.ts #5")
    expect(formatEditorFileLabel("/src/app/main.ts", undefined)).toBe("main.ts")
    expect(formatEditorFileLabel(undefined, undefined)).toBeUndefined()
  })
})
