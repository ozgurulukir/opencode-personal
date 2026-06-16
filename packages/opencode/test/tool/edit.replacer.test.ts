import { describe, expect, test } from "bun:test"
import {
  BlockAnchorReplacer,
  ContextAwareReplacer,
  EscapeNormalizedReplacer,
  IndentationFlexibleReplacer,
  LineTrimmedReplacer,
  MultiOccurrenceReplacer,
  SimpleReplacer,
  TrimmedBoundaryReplacer,
  WhitespaceNormalizedReplacer,
  replace,
  trimDiff,
} from "../../src/tool/edit.replacer"

const yields = (replacer: (content: string, find: string) => Generator<string>, content: string, find: string) =>
  Array.from(replacer(content, find))

describe("edit.replacer strategies", () => {
  describe("SimpleReplacer", () => {
    test("yields the search string verbatim", () => {
      expect(yields(SimpleReplacer, "abc foo bar", "foo")).toEqual(["foo"])
    })
  })

  describe("LineTrimmedReplacer", () => {
    test("matches a block ignoring per-line surrounding whitespace", () => {
      const content = "  indented line  \nsecond\nthird"
      expect(yields(LineTrimmedReplacer, content, "indented line")).toEqual(["  indented line  "])
    })

    test("yields nothing when no trimmed line matches", () => {
      expect(yields(LineTrimmedReplacer, "aaa\nbbb", "zzz")).toEqual([])
    })
  })

  describe("BlockAnchorReplacer", () => {
    test("yields nothing for fewer than three search lines", () => {
      expect(yields(BlockAnchorReplacer, "a\nb\nc\nd", "a\nb")).toEqual([])
    })

    test("finds a block by its first and last line anchors", () => {
      const content = "import a\nfunc body here\nexport b\nleftover"
      const out = yields(BlockAnchorReplacer, content, "import a\nMIDDLE\nexport b")
      expect(out).toHaveLength(1)
      expect(out[0]).toBe("import a\nfunc body here\nexport b")
    })
  })

  describe("WhitespaceNormalizedReplacer", () => {
    test("matches a single line ignoring collapsed internal whitespace", () => {
      const out = yields(WhitespaceNormalizedReplacer, "foo    bar", "foo bar")
      expect(out).toContain("foo    bar")
    })
  })

  describe("IndentationFlexibleReplacer", () => {
    test("matches content despite differing indentation", () => {
      const content = "\t\tdeep line\n\t\tdeep line two"
      const out = yields(IndentationFlexibleReplacer, content, "deep line\ndeep line two")
      expect(out).toContain("\t\tdeep line\n\t\tdeep line two")
    })
  })

  describe("EscapeNormalizedReplacer", () => {
    test("unescapes common escape sequences before matching", () => {
      const content = "line one\nline two"
      // find uses literal backslash-n; replacer unescapes to a real newline
      expect(yields(EscapeNormalizedReplacer, content, "line one\\nline two")).toContain("line one\nline two")
    })
  })

  describe("MultiOccurrenceReplacer", () => {
    test("yields the search string once per occurrence", () => {
      expect(yields(MultiOccurrenceReplacer, "x x x", "x")).toEqual(["x", "x", "x"])
    })
  })

  describe("TrimmedBoundaryReplacer", () => {
    test("yields the trimmed search when content has no surrounding whitespace", () => {
      expect(yields(TrimmedBoundaryReplacer, "keep me", "  keep me  ")).toContain("keep me")
    })

    test("yields nothing when the search is already trimmed", () => {
      expect(yields(TrimmedBoundaryReplacer, "keep me", "keep me")).toEqual([])
    })
  })

  describe("ContextAwareReplacer", () => {
    test("yields nothing for fewer than three search lines", () => {
      expect(yields(ContextAwareReplacer, "a\nb\nc", "a\nb")).toEqual([])
    })

    test("finds a block bounded by matching context anchors with similar middle", () => {
      const content = "def start()\n  do thing\ndef end()\nmore"
      const out = yields(ContextAwareReplacer, content, "def start()\n  do thing\ndef end()")
      expect(out).toContain("def start()\n  do thing\ndef end()")
    })
  })
})

describe("edit.replacer replace", () => {
  test("replaces a unique exact match", () => {
    expect(replace("foo bar baz", "bar", "QUX")).toBe("foo QUX baz")
  })

  test("replaceAll replaces every occurrence", () => {
    expect(replace("a a a", "a", "b", true)).toBe("b b b")
  })

  test("throws when oldString is absent", () => {
    expect(() => replace("hello world", "missing", "x")).toThrow(/Could not find oldString/)
  })

  test("throws on an ambiguous (multiple) match", () => {
    // Two identical standalone "dup" tokens with no unique context -> ambiguous
    expect(() => replace("dup\ndup", "dup", "x")).toThrow(/multiple matches/)
  })

  test("throws when oldString equals newString", () => {
    expect(() => replace("foo", "foo", "foo")).toThrow(/identical/)
  })
})

describe("edit.replacer trimDiff", () => {
  test("strips the common leading whitespace from added/removed lines", () => {
    const diff = ["+++ file", "--- file", "+    alpha", "+    beta"].join("\n")
    const out = trimDiff(diff).split("\n")
    expect(out.find((l) => l.startsWith("+") && l.includes("alpha"))).toBe("+alpha")
  })

  test("returns the input unchanged when there is no common indentation", () => {
    const diff = "+a\n-b"
    expect(trimDiff(diff)).toBe("+a\n-b")
  })
})
