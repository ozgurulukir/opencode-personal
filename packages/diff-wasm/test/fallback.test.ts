import { test, expect, describe, afterEach } from "bun:test"
import { diffLines, createTwoFilesPatch, structuredPatch } from "../src/index"

describe("WASM failure and JS fallback behavior", () => {
  const originalWasmPath = (globalThis as any).OPENCODE_DIFF_WASM_JS_PATH

  afterEach(() => {
    (globalThis as any).OPENCODE_DIFF_WASM_JS_PATH = originalWasmPath
  })

  test("createTwoFilesPatch falls back to JS diffing when WASM path is invalid", async () => {
    (globalThis as any).OPENCODE_DIFF_WASM_JS_PATH = "./non_existent_wasm_path.js"

    const oldText = "hello world\nline 2\n"
    const newText = "hello world\nline 2 changed\nline 3\n"

    const patch = await createTwoFilesPatch("file.txt", "file.txt", oldText, newText)

    expect(typeof patch).toBe("string")
    expect(patch).toContain("--- file.txt")
    expect(patch).toContain("+++ file.txt")
    expect(patch).toContain("-line 2")
    expect(patch).toContain("+line 2 changed")
  })

  test("diffLines falls back to JS diffing when WASM path is invalid", async () => {
    (globalThis as any).OPENCODE_DIFF_WASM_JS_PATH = "./non_existent_wasm_path.js"

    const oldText = "foo\nbar\n"
    const newText = "foo\nbaz\n"

    const changes = await diffLines(oldText, newText)

    expect(Array.isArray(changes)).toBe(true)
    expect(changes.length).toBeGreaterThan(0)
    const added = changes.find((c) => c.added)
    const removed = changes.find((c) => c.removed)
    expect(added).toBeDefined()
    expect(removed).toBeDefined()
  })

  test("structuredPatch falls back to JS diffing when WASM path is invalid", async () => {
    (globalThis as any).OPENCODE_DIFF_WASM_JS_PATH = "./non_existent_wasm_path.js"

    const oldText = "a\nb\nc\n"
    const newText = "a\nx\nc\n"

    const patchObj = await structuredPatch("a.txt", "b.txt", oldText, newText)

    expect(patchObj).toHaveProperty("hunks")
    expect(patchObj.hunks.length).toBeGreaterThan(0)
    expect(patchObj.hunks[0]).toHaveProperty("oldStart")
    expect(patchObj.hunks[0]).toHaveProperty("newStart")
  })
})
