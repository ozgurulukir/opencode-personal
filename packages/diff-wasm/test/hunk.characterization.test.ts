import { test, expect } from "bun:test"
import { diffLines, createTwoFilesPatch, structuredPatch, formatPatch, parsePatch, applyPatch } from "../src/index"

test("structuredPatch preserves hunks and lines structure", () => {
  const oldText = "line 1\nline 2\nline 3\n"
  const newText = "line 1\nline 2 modified\nline 3\nline 4\n"

  const result = structuredPatch("a.txt", "b.txt", oldText, newText, "", "", { context: 1 })

  expect(result).toHaveProperty("hunks")
  expect(result.hunks.length).toBeGreaterThan(0)
  expect(result.hunks[0]).toHaveProperty("oldStart")
  expect(result.hunks[0]).toHaveProperty("oldLines")
  expect(result.hunks[0]).toHaveProperty("newStart")
  expect(result.hunks[0]).toHaveProperty("newLines")
  expect(Array.isArray(result.hunks[0].lines)).toBe(true)
})

test("createTwoFilesPatch and parsePatch are bidirectional", () => {
  const oldText = "function foo() {\n  return 1\n}\n"
  const newText = "function foo() {\n  return 2\n}\n"

  const patchStr = createTwoFilesPatch("foo.ts", "foo.ts", oldText, newText)
  expect(typeof patchStr).toBe("string")
  expect(patchStr).toContain("--- foo.ts")
  expect(patchStr).toContain("+++ foo.ts")

  const parsed = parsePatch(patchStr)
  expect(parsed.length).toBe(1)
  expect(parsed[0].hunks.length).toBeGreaterThan(0)
})

test("applyPatch applies unified diff cleanly", () => {
  const original = "a\nb\nc\n"
  const modified = "a\nb modified\nc\n"
  const patchStr = createTwoFilesPatch("file", "file", original, modified)

  const applied = applyPatch(original, patchStr)
  expect(applied).toBe(modified)
})
