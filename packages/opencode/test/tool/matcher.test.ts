import { describe, test, expect } from "bun:test"
import { normalizeUnicode, Comparators, findPattern, findPatternBackward } from "../../src/tool/matcher"

describe("normalizeUnicode", () => {
  test("converts smart quotes to ASCII", () => {
    expect(normalizeUnicode("\u201Chello\u201D")).toBe('"hello"')
    expect(normalizeUnicode("\u2018hello\u2019")).toBe("'hello'")
  })

  test("converts em-dash and en-dash to hyphen", () => {
    expect(normalizeUnicode("foo\u2014bar")).toBe("foo-bar")
    expect(normalizeUnicode("foo\u2013bar")).toBe("foo-bar")
  })

  test("converts ellipsis", () => {
    expect(normalizeUnicode("wait\u2026")).toBe("wait...")
  })

  test("converts non-breaking space", () => {
    expect(normalizeUnicode("foo\u00A0bar")).toBe("foo bar")
  })

  test("passes plain ASCII through unchanged", () => {
    expect(normalizeUnicode("hello world")).toBe("hello world")
  })
})

describe("Comparators", () => {
  test("exact matches identical strings", () => {
    expect(Comparators.exact("abc", "abc")).toBe(true)
    expect(Comparators.exact("abc", "ABC")).toBe(false)
    expect(Comparators.exact("abc ", "abc")).toBe(false)
  })

  test("rstrip ignores trailing whitespace", () => {
    expect(Comparators.rstrip("abc  ", "abc")).toBe(true)
    expect(Comparators.rstrip("abc", "abc  ")).toBe(true)
    expect(Comparators.rstrip(" abc", "abc")).toBe(false)
  })

  test("trim ignores all surrounding whitespace", () => {
    expect(Comparators.trim("  abc  ", "abc")).toBe(true)
    expect(Comparators.trim("abc", "  abc  ")).toBe(true)
    expect(Comparators.trim("  a b c  ", "a b c")).toBe(true)
  })

  test("normalized handles Unicode + whitespace", () => {
    expect(Comparators.normalized("\u201Chello\u201D  ", "hello")).toBe(false)
    expect(Comparators.normalized("  \u201Chello\u201D  ", '"hello"')).toBe(true)
  })
})

describe("findPattern", () => {
  const lines = ["alpha", "beta", "gamma", "delta", "epsilon"]

  test("finds exact match", () => {
    expect(findPattern(lines, ["beta", "gamma"], 0, Comparators.exact)).toBe(1)
  })

  test("respects startIndex", () => {
    expect(findPattern(lines, ["beta", "gamma"], 2, Comparators.exact)).toBe(-1)
  })

  test("returns -1 for no match", () => {
    expect(findPattern(lines, ["beta", "delta"], 0, Comparators.exact)).toBe(-1)
  })

  test("finds first occurrence only", () => {
    const dupes = ["a", "b", "a", "b", "c"]
    expect(findPattern(dupes, ["a", "b"], 0, Comparators.exact)).toBe(0)
  })

  test("does not match when trailing empty line present", () => {
    expect(findPattern(lines, ["beta", "gamma", ""], 0, Comparators.exact)).toBe(-1)
  })

  test("returns -1 for empty pattern", () => {
    expect(findPattern(lines, [], 0, Comparators.exact)).toBe(-1)
    expect(findPattern(lines, [""], 0, Comparators.exact)).toBe(-1)
  })

  test("matches single-line pattern", () => {
    expect(findPattern(lines, ["gamma"], 0, Comparators.exact)).toBe(2)
  })

  test("matches at end of file", () => {
    expect(findPattern(lines, ["epsilon"], 0, Comparators.exact)).toBe(4)
  })

  test("works with trim comparator", () => {
    const padded = ["  alpha", "beta  ", "gamma"]
    expect(findPattern(padded, ["alpha", "beta"], 0, Comparators.trim)).toBe(0)
  })

  test("works with rstrip comparator", () => {
    const trailing = ["alpha  ", "beta", "gamma"]
    expect(findPattern(trailing, ["alpha", "beta"], 0, Comparators.rstrip)).toBe(0)
  })

  test("works with normalized comparator", () => {
    const fancy = ["\u201Chello\u201D", "world"]
    expect(findPattern(fancy, ['"hello"', "world"], 0, Comparators.normalized)).toBe(0)
  })
})

describe("findPatternBackward", () => {
  const lines = ["alpha", "beta", "gamma", "beta", "gamma"]

  test("finds pattern at end of file", () => {
    expect(findPatternBackward(lines, ["beta", "gamma"], Comparators.exact)).toBe(3)
  })

  test("returns -1 when pattern does not match end", () => {
    expect(findPatternBackward(lines, ["alpha", "beta"], Comparators.exact)).toBe(-1)
  })

  test("returns -1 for empty pattern", () => {
    expect(findPatternBackward(lines, [], Comparators.exact)).toBe(-1)
    expect(findPatternBackward(lines, [""], Comparators.exact)).toBe(-1)
  })

  test("returns -1 when pattern longer than lines", () => {
    expect(findPatternBackward(["a"], ["a", "b"], Comparators.exact)).toBe(-1)
  })

  test("does not match when trailing empty line present", () => {
    expect(findPatternBackward(lines, ["beta", "gamma", ""], Comparators.exact)).toBe(-1)
  })

  test("matches single-line pattern at end", () => {
    expect(findPatternBackward(lines, ["gamma"], Comparators.exact)).toBe(4)
  })

  test("works with trim comparator", () => {
    const padded = ["alpha", "  beta  ", "gamma  "]
    expect(findPatternBackward(padded, ["beta", "gamma"], Comparators.trim)).toBe(1)
  })
})
