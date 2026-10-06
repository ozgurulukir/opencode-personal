import { test, expect } from "bun:test"
import { diffLines, createTwoFilesPatch, structuredPatch, formatPatch, parsePatch, applyPatch } from "../src/index"

test("structuredPatch preserves hunks and lines structure", async () => {
  const oldText = "line 1\nline 2\nline 3\n"
  const newText = "line 1\nline 2 modified\nline 3\nline 4\n"

  const result = await structuredPatch("a.txt", "b.txt", oldText, newText, "", "", { context: 1 })

  expect(result).toHaveProperty("hunks")
  expect(result.hunks.length).toBeGreaterThan(0)
  expect(result.hunks[0]).toHaveProperty("oldStart")
  expect(result.hunks[0]).toHaveProperty("oldLines")
  expect(result.hunks[0]).toHaveProperty("newStart")
  expect(result.hunks[0]).toHaveProperty("newLines")
  expect(Array.isArray(result.hunks[0].lines)).toBe(true)
})

test("structuredPatch uses one-based ranges accepted by formatPatch and applyPatch", async () => {
  const original = "a\nb\n"
  const modified = "a\nc\n"
  const result = await structuredPatch("a.txt", "b.txt", original, modified)

  expect(result.hunks[0].oldStart).toBe(1)
  expect(result.hunks[0].newStart).toBe(1)
  expect(applyPatch(original, formatPatch(result))).toBe(modified)
})

test("structuredPatch preserves missing-newline markers", async () => {
  const result = await structuredPatch("a.txt", "b.txt", "a", "b")

  expect(result.hunks[0].lines).toEqual(["-a", "\\ No newline at end of file", "+b", "\\ No newline at end of file"])
  expect(applyPatch("a", formatPatch(result))).toBe("b")
})

test("structuredPatch uses the diff package default context", async () => {
  const original = "1\n2\n3\n4\n5\n6\n7\n8\n9\n"
  const modified = "1\n2\n3\n4\nchanged\n6\n7\n8\n9\n"
  const result = await structuredPatch("a.txt", "b.txt", original, modified)

  expect(result.hunks[0].lines).toHaveLength(10)
})

test("structuredPatch falls back for contexts outside the WASM integer range", async () => {
  const original = "1\n2\n3\n4\n5\n6\n7\n8\n9\n"
  const modified = "1\n2\n3\n4\nchanged\n6\n7\n8\n9\n"
  const result = await structuredPatch("a.txt", "b.txt", original, modified, undefined, undefined, {
    context: Infinity,
  })

  expect(result.hunks[0].lines).toHaveLength(10)
})

test("createTwoFilesPatch matches the diff package file headers", async () => {
  const patch = await createTwoFilesPatch("old.txt", "new.txt", "old\n", "new\n")

  expect(patch).toBe(
    "===================================================================\n--- old.txt\n+++ new.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n",
  )
})

test("diffLines returns explicit boolean change flags", async () => {
  const changes = await diffLines("same\nold\n", "same\nnew\n")

  expect(changes).toEqual([
    { value: "same\n", added: false, removed: false, count: 1 },
    { value: "old\n", added: false, removed: true, count: 1 },
    { value: "new\n", added: true, removed: false, count: 1 },
  ])
})

test("falls back to JS line semantics for standalone carriage returns", async () => {
  const changes = await diffLines("a\rb\r", "a\rc\r")

  expect(changes).toEqual([
    { value: "a\rb\r", added: false, removed: true, count: 1 },
    { value: "a\rc\r", added: true, removed: false, count: 1 },
  ])
})

test("createTwoFilesPatch and parsePatch are bidirectional", async () => {
  const oldText = "function foo() {\n  return 1\n}\n"
  const newText = "function foo() {\n  return 2\n}\n"

  const patchStr = await createTwoFilesPatch("foo.ts", "foo.ts", oldText, newText)
  expect(typeof patchStr).toBe("string")
  expect(patchStr).toContain("--- foo.ts")
  expect(patchStr).toContain("+++ foo.ts")

  const parsed = parsePatch(patchStr)
  expect(parsed.length).toBe(1)
  expect(parsed[0].hunks.length).toBeGreaterThan(0)
})

test("applyPatch applies unified diff cleanly", async () => {
  const original = "a\nb\nc\n"
  const modified = "a\nb modified\nc\n"
  const patchStr = await createTwoFilesPatch("file", "file", original, modified)

  const applied = applyPatch(original, patchStr)
  expect(applied).toBe(modified)
})
