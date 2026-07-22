import { describe, expect, test } from "bun:test"
import path from "path"
import { referencePath } from "@/reference/reference"
import os from "os"

describe("referencePath", () => {
  const dir = "/project/packages/app"
  const worktree = "/project"

  test("resolves tilde path against home", () => {
    const expectedHome = process.env.OPENCODE_TEST_HOME ?? os.homedir()
    const result = referencePath({ directory: dir, worktree, value: "~/docs" })
    expect(result).toBe(path.join(expectedHome, "docs"))
  })

  test("passes through absolute paths unchanged", () => {
    expect(referencePath({ directory: dir, worktree, value: "/absolute/path" }))
      .toBe("/absolute/path")
  })

  test("resolves relative path against worktree", () => {
    expect(referencePath({ directory: dir, worktree, value: "sub/file" }))
      .toBe(path.resolve(worktree, "sub/file"))
  })

  test("falls back to directory when worktree is root", () => {
    expect(referencePath({ directory: dir, worktree: "/", value: "sub/file" }))
      .toBe(path.resolve(dir, "sub/file"))
  })
})
