import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"
import { Glob } from "@opencode-ai/core/util/glob"

describe("Glob.match", () => {
  test("matches exact filename", () => {
    expect(Glob.match("*.ts", "file.ts")).toBe(true)
    expect(Glob.match("*.ts", "file.js")).toBe(false)
  })

  test("matches dotfiles", () => {
    expect(Glob.match("*.json", ".eslintrc.json")).toBe(true)
  })

  test("matches globstar patterns", () => {
    expect(Glob.match("**/*.test.ts", "src/util/binary.test.ts")).toBe(true)
    expect(Glob.match("**/*.test.ts", "src/util/binary.ts")).toBe(false)
  })

  test("matches brace expansion", () => {
    expect(Glob.match("*.{ts,tsx}", "app.tsx")).toBe(true)
    expect(Glob.match("*.{ts,tsx}", "app.js")).toBe(false)
  })
})

describe("Glob.scanSync", () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "glob-test-"))
    await writeFile(join(dir, "a.ts"), "")
    await writeFile(join(dir, "b.js"), "")
    await writeFile(join(dir, ".hidden.ts"), "")
    await mkdir(join(dir, "sub"))
    await writeFile(join(dir, "sub", "c.ts"), "")
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test("finds files matching pattern", () => {
    const results = Glob.scanSync("*.ts", { cwd: dir })
    expect(results.sort()).toEqual(["a.ts"])
  })

  test("excludes dotfiles by default", () => {
    const results = Glob.scanSync("*.ts", { cwd: dir })
    expect(results).not.toContain(".hidden.ts")
  })

  test("includes dotfiles when dot option is set", () => {
    const results = Glob.scanSync("*.ts", { cwd: dir, dot: true })
    expect(results.sort()).toEqual([".hidden.ts", "a.ts"])
  })

  test("excludes directories by default", () => {
    const results = Glob.scanSync("*", { cwd: dir })
    expect(results).not.toContain("sub")
  })

  test("includes directories when include is all", () => {
    const results = Glob.scanSync("*", { cwd: dir, include: "all" })
    expect(results).toContain("sub")
  })

  test("finds nested files with globstar", () => {
    const results = Glob.scanSync("**/*.ts", { cwd: dir })
    expect(results.sort()).toEqual(["a.ts", "sub/c.ts"])
  })

  test("returns absolute paths when absolute option is set", () => {
    const results = Glob.scanSync("a.ts", { cwd: dir, absolute: true })
    expect(results).toEqual([join(dir, "a.ts")])
  })
})
