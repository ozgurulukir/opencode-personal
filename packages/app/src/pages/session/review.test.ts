import { describe, expect, test } from "bun:test"
import {
  changeModes,
  isVcsChanges,
  newSessionWorktreeFor,
  resolveVcsMode,
  reviewDiffsFor,
  reviewIsReady,
} from "./review"

describe("session review decisions", () => {
  test("changeModes offers git and turn for a git project on the default branch", () => {
    expect(changeModes({ vcs: "git" }, { branch: "main", default_branch: "main" })).toEqual(["git", "turn"])
  })

  test("changeModes offers branch mode when checked out on a non-default branch", () => {
    expect(changeModes({ vcs: "git" }, { branch: "feature", default_branch: "main" })).toEqual([
      "git",
      "branch",
      "turn",
    ])
  })

  test("changeModes offers only turn without git", () => {
    expect(changeModes({ vcs: undefined }, undefined)).toEqual(["turn"])
    expect(changeModes(undefined, undefined)).toEqual(["turn"])
  })

  test("resolveVcsMode maps git/branch and leaves turn unmapped", () => {
    expect(resolveVcsMode("git")).toBe("git")
    expect(resolveVcsMode("branch")).toBe("branch")
    expect(resolveVcsMode("turn")).toBeUndefined()
  })

  test("isVcsChanges distinguishes vcs-backed modes from turn mode", () => {
    expect(isVcsChanges("git")).toBe(true)
    expect(isVcsChanges("branch")).toBe(true)
    expect(isVcsChanges("turn")).toBe(false)
  })

  test("reviewDiffsFor serves the vcs query only once fetched to avoid suspense", () => {
    expect(reviewDiffsFor("git", false, [{ id: "a" }], [{ id: "t" }])).toEqual([])
    expect(reviewDiffsFor("git", true, [{ id: "a" }], [{ id: "t" }])).toEqual([{ id: "a" }])
    expect(reviewDiffsFor("git", true, undefined, [{ id: "t" }])).toEqual([])
  })

  test("reviewDiffsFor falls back to turn diffs outside vcs modes", () => {
    expect(reviewDiffsFor("turn", true, [{ id: "a" }], [{ id: "t" }])).toEqual([{ id: "t" }])
  })

  test("reviewIsReady gates on vcs pending state only for vcs modes", () => {
    expect(reviewIsReady("git", true)).toBe(false)
    expect(reviewIsReady("git", false)).toBe(true)
    expect(reviewIsReady("turn", true)).toBe(true)
  })

  test("newSessionWorktreeFor passes create through and picks the directory off the project worktree", () => {
    expect(newSessionWorktreeFor("create", { worktree: "/repo" }, "/repo")).toBe("create")
    expect(newSessionWorktreeFor("main", { worktree: "/repo" }, "/other")).toBe("/other")
    expect(newSessionWorktreeFor("main", { worktree: "/repo" }, "/repo")).toBe("main")
    expect(newSessionWorktreeFor("main", undefined, "/repo")).toBe("main")
  })
})
