import { mock, describe, expect, test, afterAll } from "bun:test"
import fs from "fs"
import path from "path"
import os from "os"

let mockedWhich: (cmd: string) => string | null = () => null
mock.module("../../src/util/which", () => ({
  which: (cmd: string) => mockedWhich(cmd),
}))

// mock.module() persists across test files — restore to prevent leakage (AGENTS.md).
afterAll(() => mock.restore())

import { gofmt, mix, prettier, oxfmt, pint } from "../../src/format/formatter"
import { Flag } from "@opencode-ai/core/flag/flag"

describe("Formatter Status Checks", () => {
  test("gofmt is enabled when binary exists", async () => {
    mockedWhich = (cmd) => (cmd === "gofmt" ? "/path/to/gofmt" : null)
    const result = await gofmt.enabled({ directory: "/dummy", worktree: "/dummy" })
    expect(result).toEqual(["/path/to/gofmt", "-w", "$FILE"])
  })

  test("gofmt is disabled when binary does not exist", async () => {
    mockedWhich = () => null
    const result = await gofmt.enabled({ directory: "/dummy", worktree: "/dummy" })
    expect(result).toBe(false)
  })

  test("mix is enabled when binary exists", async () => {
    mockedWhich = (cmd) => (cmd === "mix" ? "/path/to/mix" : null)
    const result = await mix.enabled({ directory: "/dummy", worktree: "/dummy" })
    expect(result).toEqual(["/path/to/mix", "format", "$FILE"])
  })

  test("mix is disabled when binary does not exist", async () => {
    mockedWhich = () => null
    const result = await mix.enabled({ directory: "/dummy", worktree: "/dummy" })
    expect(result).toBe(false)
  })
})

describe("Package / Composer Formatters (prettier, oxfmt, pint)", () => {
  test("prettier.enabled finds prettier in ancestor package.json", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "formatter-test-"))
    try {
      const nestedDir = path.join(tmpDir, "a", "b", "c")
      fs.mkdirSync(nestedDir, { recursive: true })
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ devDependencies: { prettier: "^3.0.0" } }))
      fs.writeFileSync(path.join(path.join(tmpDir, "a"), "package.json"), JSON.stringify({ name: "sub-a" }))
      fs.writeFileSync(path.join(path.join(tmpDir, "a", "b"), "package.json"), JSON.stringify({ name: "sub-b" }))
      fs.writeFileSync(path.join(nestedDir, "package.json"), JSON.stringify({ name: "sub-c" }))

      const result = await prettier.enabled({ directory: nestedDir, worktree: tmpDir })
      expect(Array.isArray(result)).toBe(true)
      if (Array.isArray(result)) {
        expect(result[0]).toContain("prettier")
        expect(result[1]).toBe("--write")
        expect(result[2]).toBe("$FILE")
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("oxfmt.enabled finds oxfmt in ancestor package.json", async () => {
    Flag.OPENCODE_EXPERIMENTAL_OXFMT = true
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "formatter-oxfmt-test-"))
    try {
      const nestedDir = path.join(tmpDir, "dir1", "dir2", "dir3")
      fs.mkdirSync(nestedDir, { recursive: true })
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ dependencies: { oxfmt: "^1.0.0" } }))
      fs.writeFileSync(path.join(path.join(tmpDir, "dir1"), "package.json"), JSON.stringify({ name: "d1" }))
      fs.writeFileSync(path.join(path.join(tmpDir, "dir1", "dir2"), "package.json"), JSON.stringify({ name: "d2" }))

      const result = await oxfmt.enabled({ directory: nestedDir, worktree: tmpDir })
      expect(Array.isArray(result)).toBe(true)
      if (Array.isArray(result)) {
        expect(result[0]).toContain("oxfmt")
        expect(result[1]).toBe("$FILE")
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      Flag.OPENCODE_EXPERIMENTAL_OXFMT = false
    }
  })

  test("pint.enabled finds laravel/pint in ancestor composer.json", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "formatter-pint-test-"))
    try {
      const nestedDir = path.join(tmpDir, "sub1", "sub2")
      fs.mkdirSync(nestedDir, { recursive: true })
      fs.writeFileSync(path.join(tmpDir, "composer.json"), JSON.stringify({ "require-dev": { "laravel/pint": "^1.0" } }))
      fs.writeFileSync(path.join(path.join(tmpDir, "sub1"), "composer.json"), JSON.stringify({ name: "s1" }))

      const result = await pint.enabled({ directory: nestedDir, worktree: tmpDir })
      expect(result).toEqual(["./vendor/bin/pint", "$FILE"])
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("benchmark sequential vs parallel package.json reading", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "formatter-bench-"))
    try {
      let current = tmpDir
      const depth = 20
      for (let i = 0; i < depth; i++) {
        current = path.join(current, `level_${i}`)
        fs.mkdirSync(current, { recursive: true })
        fs.writeFileSync(
          path.join(current, "package.json"),
          JSON.stringify({ name: `level_${i}`, devDependencies: i === 0 ? { prettier: "3.0.0" } : {} }),
        )
      }

      const iterations = 50
      const start = performance.now()
      for (let i = 0; i < iterations; i++) {
        await prettier.enabled({ directory: current, worktree: tmpDir })
      }
      const elapsed = performance.now() - start
      console.log(`Benchmark (${iterations} runs, depth ${depth}): ${elapsed.toFixed(2)} ms total, ${(elapsed / iterations).toFixed(3)} ms/op`)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
