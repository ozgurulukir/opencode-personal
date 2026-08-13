// Characterization tests for the shared symlink-safe path helpers extracted
// from `write.ts`/`edit.ts` into `tool/file-path.ts`.

import { describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import os from "os"
import path from "path"
import { resolvePath, projectContainmentError } from "../../src/tool/file-path"
import { tmpdir } from "../fixture/fixture"

describe("file-path.resolvePath", () => {
  test("returns the canonical real path for an existing file", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "file.txt")
    await fs.writeFile(file, "x")
    expect(resolvePath(file)).toBe(await fs.realpath(file))
  })

  test("resolves symlinks inside the project pointing outside", async () => {
    await using outside = await tmpdir()
    await using fixture = await tmpdir()
    await fs.writeFile(path.join(outside.path, "secret.txt"), "s")
    await fs.symlink(
      outside.path,
      path.join(fixture.path, "evil"),
      process.platform === "win32" ? "junction" : "dir",
    )
    expect(resolvePath(path.join(fixture.path, "evil", "secret.txt"))).toBe(await fs.realpath(path.join(outside.path, "secret.txt")))
  })

  test("falls back to resolving the parent dir for not-yet-created files", async () => {
    await using tmp = await tmpdir()
    const target = path.join(tmp.path, "new", "file.txt")
    const resolved = resolvePath(target)
    expect(path.dirname(resolved)).toBe(path.dirname(path.resolve(target)))
  })

  test("handles nonexistent files under a symlinked parent", async () => {
    await using outside = await tmpdir()
    await using fixture = await tmpdir()
    await fs.symlink(
      outside.path,
      path.join(fixture.path, "link"),
      process.platform === "win32" ? "junction" : "dir",
    )
    const resolved = resolvePath(path.join(fixture.path, "link", "future.ts"))
    expect(resolved).toContain(await fs.realpath(outside.path))
  })
})

describe("file-path.projectContainmentError", () => {
  test("returns undefined for files inside the directory", () => {
    const dir = path.join(os.tmpdir(), "opencode-project")
    expect(projectContainmentError(path.join(dir, "file.ts"), dir)).toBeUndefined()
  })

  test("returns undefined for the directory itself", () => {
    const dir = path.join(os.tmpdir(), "opencode-project")
    expect(projectContainmentError(dir, dir)).toBeUndefined()
  })

  test("reports a sibling-directory escape", () => {
    const dir = path.join(os.tmpdir(), "app")
    const sibling = path.join(os.tmpdir(), "app2", "file.ts")
    expect(projectContainmentError(sibling, dir)).toBe(`Path escapes project directory: ${sibling}`)
  })

  test("reports an up-and-out escape", () => {
    const dir = path.join(os.tmpdir(), "app")
    const outside = path.join(dir, "..", "secret")
    expect(projectContainmentError(outside, dir)).toContain("Path escapes project directory")
  })
})
