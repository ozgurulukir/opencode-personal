// Characterization tests for the shared file-reading primitives extracted from
// `read.ts` into `tool/file-read.ts`. These lock the streaming window semantics
// (line truncation, byte budget, offset/limit, hunk range merging) so follow-up
// refactors can't change behavior. They exercise the real streaming implementation
// against temp files.

import { describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { lines, linesWithHunks, getChangedRanges, truncateLine, MAX_LINE_LENGTH } from "../../src/tool/file-read"
import { tmpdir } from "../fixture/fixture"

describe("file-read.lines", () => {
  test("returns all lines within limit with correct count", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "file.txt")
    await fs.writeFile(filepath, "a\nb\nc")
    const result = await lines(filepath, { limit: 10, offset: 1 })
    expect(result.raw).toEqual(["a", "b", "c"])
    expect(result.count).toBe(3)
    expect(result.cut).toBe(false)
    expect(result.more).toBe(false)
  })

  test("respects offset (1-indexed) and excludes prior lines", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "file.txt")
    await fs.writeFile(filepath, "a\nb\nc\nd")
    const result = await lines(filepath, { limit: 10, offset: 2 })
    expect(result.raw).toEqual(["b", "c", "d"])
    expect(result.count).toBe(4)
  })

  test("limits lines and flags more", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "file.txt")
    await fs.writeFile(filepath, "1\n2\n3\n4\n5")
    const result = await lines(filepath, { limit: 2, offset: 1 })
    expect(result.raw).toEqual(["1", "2"])
    expect(result.more).toBe(true)
    expect(result.cut).toBe(false)
  })

  test("truncates over-length lines via truncateLine", async () => {
    const suffix = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
    const long = "x".repeat(MAX_LINE_LENGTH + 50)
    const truncated = truncateLine(long)
    expect(truncated.length).toBe(MAX_LINE_LENGTH + suffix.length)
    expect(truncated.endsWith(suffix)).toBe(true)
  })

  test("cuts at the byte budget without splitting a line", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "file.txt")
    // ~26 lines of 2000 chars exceed the 50KB byte budget (25 lines * 2000 = 50KB).
    const linesContent = Array.from({ length: 26 }, () => "x".repeat(2000)).join("\n")
    await fs.writeFile(filepath, linesContent)
    const result = await lines(filepath, { limit: 100, offset: 1 })
    expect(result.cut).toBe(true)
    expect(result.more).toBe(true)
    expect(result.raw.length).toBeGreaterThan(0)
    expect(result.raw.length).toBeLessThan(26)
  })
})

describe("file-read.getChangedRanges", () => {
  test("parses a unified diff header", () => {
    const diff = "@@ -1,5 +1,5 @@\n foo\n@@ -10 +10,2 @@\n bar"
    expect(getChangedRanges(diff)).toEqual([
      { start: 1, end: 5 },
      { start: 10, end: 11 },
    ])
  })

  test("handles empty diff", () => {
    expect(getChangedRanges("")).toEqual([])
  })

  test("ignores non-header lines", () => {
    expect(getChangedRanges("foo\nbar\n@@ -1 +1 @@\nbaz")).toEqual([{ start: 1, end: 1 }])
  })
})

describe("file-read.linesWithHunks", () => {
  test("returns only lines within expanded + merged hunk ranges", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "file.txt")
    await fs.writeFile(filepath, "1\n2\n3\n4\n5\n6\n7\n8\n9\n10")
    const result = await linesWithHunks(filepath, [{ start: 3, end: 4 }], 1)
    expect(result.raw).toEqual(["2: 2", "3: 3", "4: 4", "5: 5"])
  })

  test("merges adjacent ranges and prefixes line numbers", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "file.txt")
    await fs.writeFile(filepath, "1\n2\n3\n4\n5\n6")
    // Ranges 2-2 and 4-4 with context 1 merge into 1-5
    const result = await linesWithHunks(filepath, [{ start: 2, end: 2 }, { start: 4, end: 4 }], 1)
    expect(result.raw).toEqual(["1: 1", "2: 2", "3: 3", "4: 4", "5: 5"])
  })

  test("caps collected hunks at the byte budget", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "file.txt")
    // 300 lines of 300 chars exceed the 50KB byte budget while staying well
    // under the per-line truncation cap (2000).
    const linesContent = Array.from({ length: 300 }, (_, i) => `${i + 1}`.padEnd(300)).join("\n")
    await fs.writeFile(filepath, linesContent)
    const result = await linesWithHunks(filepath, [{ start: 1, end: 300 }])
    expect(result.cut).toBe(true)
    expect(result.raw.length).toBeGreaterThan(0)
    expect(result.raw.length).toBeLessThan(300)
  })
})
