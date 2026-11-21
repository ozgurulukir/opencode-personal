import { describe, expect, test } from "bun:test"
import {
  canMoveHistoryNext,
  canMoveHistoryPrevious,
  editorSelectionLabel,
  expandPastedText,
  isDraftWorthRetaining,
  isPasteUrl,
  normalizePastedText,
  parseSlashCommand,
  promptPlaceholder,
  randomIndex,
  resolvePasteFilepath,
  shouldShowVariant,
} from "../../../../src/cli/cmd/tui/component/prompt/prompt.shared"
import type { PromptInfo } from "../../../../src/cli/cmd/tui/component/prompt/history"

describe("randomIndex", () => {
  test("returns 0 for non-positive counts", () => {
    expect(randomIndex(0)).toBe(0)
    expect(randomIndex(-3)).toBe(0)
  })

  test("stays within bounds", () => {
    for (let i = 0; i < 50; i++) {
      const value = randomIndex(4)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(4)
    }
  })
})

describe("normalizePastedText", () => {
  test("normalizes CRLF before lone CR", () => {
    expect(normalizePastedText("a\r\nb\rc\n")).toBe("a\nb\nc\n")
  })

  test("leaves LF-only text untouched", () => {
    expect(normalizePastedText("a\nb")).toBe("a\nb")
  })
})

describe("resolvePasteFilepath", () => {
  test("strips surrounding quotes", () => {
    expect(resolvePasteFilepath(`"/tmp/a b.txt"`, "linux")).toBe("/tmp/a b.txt")
    expect(resolvePasteFilepath(`'/tmp/x'`, "linux")).toBe("/tmp/x")
  })

  test("decodes file URLs", () => {
    expect(resolvePasteFilepath("file:///tmp/a%20b.txt", "linux")).toBe("/tmp/a b.txt")
  })

  test("unescapes POSIX backslashes", () => {
    expect(resolvePasteFilepath("/tmp/a\\ b.txt", "linux")).toBe("/tmp/a b.txt")
  })

  test("keeps Windows paths verbatim", () => {
    expect(resolvePasteFilepath("C:\\Users\\me\\a.txt", "win32")).toBe("C:\\Users\\me\\a.txt")
  })
})

describe("isPasteUrl", () => {
  test("detects http(s) URLs only", () => {
    expect(isPasteUrl("https://example.com")).toBe(true)
    expect(isPasteUrl("http://example.com")).toBe(true)
    expect(isPasteUrl("ftp://example.com")).toBe(false)
    expect(isPasteUrl("/tmp/file")).toBe(false)
  })
})

describe("expandPastedText", () => {
  const parts: PromptInfo["parts"] = [
    {
      type: "text",
      text: "hello world",
      source: { text: { start: 0, end: 17, value: "[Pasted ~2 lines]" } },
    },
  ]

  test("replaces the virtual placeholder with the real text", () => {
    const text = expandPastedText({
      text: "[Pasted ~2 lines] tail",
      parts,
      extmarks: [{ id: 1, start: 0, end: 17 }],
      extmarkToPartIndex: new Map([[1, 0]]),
    })
    expect(text).toBe("hello world tail")
  })

  test("expands right-to-left so earlier offsets stay valid", () => {
    const twoParts: PromptInfo["parts"] = [
      { type: "text", text: "AAA", source: { text: { start: 0, end: 3, value: "aaa" } } },
      { type: "text", text: "BBB", source: { text: { start: 5, end: 8, value: "bbb" } } },
    ]
    const text = expandPastedText({
      text: "aaaXXbbb",
      parts: twoParts,
      extmarks: [
        { id: 1, start: 0, end: 3 },
        { id: 2, start: 5, end: 8 },
      ],
      extmarkToPartIndex: new Map([
        [1, 0],
        [2, 1],
      ]),
    })
    expect(text).toBe("AAAXXBBB")
  })

  test("ignores file parts and unknown extmarks", () => {
    const text = expandPastedText({
      text: "[Image 1]",
      parts: [{ type: "file", mime: "image/png", url: "data:x", filename: "a.png" }],
      extmarks: [
        { id: 1, start: 0, end: 9 },
        { id: 2, start: 0, end: 9 },
      ],
      extmarkToPartIndex: new Map([[1, 0]]),
    })
    expect(text).toBe("[Image 1]")
  })
})

describe("parseSlashCommand", () => {
  test("returns undefined for non-command input", () => {
    expect(parseSlashCommand("hello")).toBeUndefined()
    expect(parseSlashCommand("")).toBeUndefined()
  })

  test("parses a bare command", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: "" })
  })

  test("preserves arguments and multi-line content", () => {
    expect(parseSlashCommand("/edit one two\nthree\nfour")).toEqual({
      name: "edit",
      args: "one two\nthree\nfour",
    })
  })
})

describe("editorSelectionLabel", () => {
  const range = (startLine: number, endLine: number, sameLineChar?: number) => ({
    selection: {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: sameLineChar ?? 0 },
    },
    text: "",
  })

  test("returns undefined with no ranges", () => {
    expect(editorSelectionLabel(undefined)).toBeUndefined()
    expect(editorSelectionLabel([])).toBeUndefined()
  })

  test("labels a single-line selection", () => {
    expect(editorSelectionLabel([range(3, 3, 5)])).toBe("#3")
  })

  test("labels a multi-line selection and counts extras", () => {
    expect(editorSelectionLabel([range(3, 5), range(8, 9)])).toBe("#3-5 +1")
  })

  test("collapsed selections produce an empty label", () => {
    expect(editorSelectionLabel([range(3, 3)])).toBe("")
  })
})

describe("promptPlaceholder", () => {
  const base = { showPlaceholder: true, ghost: "", shell: [], list: [], index: 0 }

  test("returns undefined when placeholders are disabled", () => {
    expect(promptPlaceholder({ ...base, showPlaceholder: false, mode: "normal" })).toBeUndefined()
  })

  test("shows the ghost suggestion in normal mode", () => {
    expect(promptPlaceholder({ ...base, mode: "normal", ghost: "Do X" })).toBe("Do X  (Tab to accept)")
  })

  test("shows a shell example in shell mode", () => {
    expect(promptPlaceholder({ ...base, mode: "shell", shell: ["ls"], index: 0 })).toBe('Run a command... "ls"')
  })

  test("shows the prompt hint in normal mode", () => {
    expect(promptPlaceholder({ ...base, mode: "normal", list: ["hi"], index: 0 })).toBe('Ask anything... "hi"')
  })

  test("returns undefined when the list is empty", () => {
    expect(promptPlaceholder({ ...base, mode: "normal" })).toBeUndefined()
  })
})

describe("shouldShowVariant", () => {
  test("requires both variants and a current value", () => {
    expect(shouldShowVariant([], "a")).toBe(false)
    expect(shouldShowVariant(["a"], undefined)).toBe(false)
    expect(shouldShowVariant(["a"], "a")).toBe(true)
  })
})

describe("isDraftWorthRetaining", () => {
  test("retains substantial text", () => {
    expect(isDraftWorthRetaining("x".repeat(20), 0, 20)).toBe(true)
  })

  test("drops short text without parts", () => {
    expect(isDraftWorthRetaining("short", 0, 20)).toBe(false)
  })

  test("retains short text when parts exist", () => {
    expect(isDraftWorthRetaining("short", 1, 20)).toBe(true)
  })
})

describe("history boundaries", () => {
  test("previous fires on first row or offset 0", () => {
    expect(canMoveHistoryPrevious(0, 3)).toBe(true)
    expect(canMoveHistoryPrevious(5, 0)).toBe(true)
    expect(canMoveHistoryPrevious(5, 2)).toBe(false)
  })

  test("next fires on last row or end offset", () => {
    expect(canMoveHistoryNext(10, 10, 2, 4)).toBe(true)
    expect(canMoveHistoryNext(3, 10, 3, 4)).toBe(true)
    expect(canMoveHistoryNext(3, 10, 1, 4)).toBe(false)
  })
})
