import { describe, expect, test } from "bun:test"
import { readdir, readFile } from "fs/promises"
import path from "path"

// Regression guard for the mock.module leak fix (Step 2 of the refactoring blueprint).
//
// mock.module() in bun:test persists across test files. Without an afterAll(() => mock.restore())
// (or afterEach equivalent), mock state leaks into every subsequent file in the run, producing
// the "passes in isolation, fails in suite" order-dependent failures documented in AGENTS.md.
//
// This test scans every test file and fails if any uses mock.module() without a restore hook.

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..")
const TEST_ROOTS = [
  path.resolve(import.meta.dir, ".."),
  path.resolve(import.meta.dir, "../../../app/src"),
  path.resolve(import.meta.dir, "../../../ui/src"),
]

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "_hygiene" || entry.name === "node_modules") continue
      yield* walk(full)
    } else if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      yield full
    }
  }
}

// Accepts either:
//   afterAll(() => mock.restore()) / afterAll(() => { ... mock.restore() ... })
// or an afterEach block that calls mock.restore() (the stderr-capture pattern).
function hasRestoreHook(src: string): boolean {
  if (/afterAll\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{?[\s\S]*?mock\.restore\s*\(\s*\)/.test(src)) return true
  if (/afterEach\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{?[\s\S]*?mock\.restore\s*\(\s*\)/.test(src)) return true
  if (/afterEach/.test(src) && /mock\.restore\s*\(\s*\)/.test(src)) return true
  return false
}

// Ignore commented-out references to mock.module
function usesMockModule(src: string): boolean {
  return /(?:^|\n)\s*(?:void\s+)?mock\.module\s*\(/.test(src)
}

describe("mock.module hygiene guard", () => {
  test("every file using mock.module() also restores via afterAll/afterEach", async () => {
    const violators: string[] = []
    for (const root of TEST_ROOTS) {
      for await (const file of walk(root)) {
        const src = await readFile(file, "utf-8")
        if (!usesMockModule(src)) continue
        if (!hasRestoreHook(src)) violators.push(path.relative(REPO_ROOT, file))
      }
    }
    expect(
      violators,
      `Files with mock.module() but no afterAll/afterEach restore hook:\n${violators.join("\n")}`,
    ).toEqual([])
  })
})
