import { describe, expect, test } from "bun:test"
import { reorderWorkspaceIds } from "./workspace-drag"

describe("reorderWorkspaceIds", () => {
  test("moves an item down to the target index", () => {
    expect(reorderWorkspaceIds(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"])
  })

  test("moves an item up to the target index", () => {
    expect(reorderWorkspaceIds(["a", "b", "c", "d"], "d", "b")).toEqual(["a", "d", "b", "c"])
  })

  test("returns undefined when the source is missing", () => {
    expect(reorderWorkspaceIds(["a", "b"], "x", "b")).toBeUndefined()
  })

  test("returns undefined when the target is missing", () => {
    expect(reorderWorkspaceIds(["a", "b"], "a", "x")).toBeUndefined()
  })

  test("returns undefined when source and target match", () => {
    expect(reorderWorkspaceIds(["a", "b"], "a", "a")).toBeUndefined()
  })

  test("does not mutate the input", () => {
    const ids = ["a", "b", "c"]
    reorderWorkspaceIds(ids, "a", "c")
    expect(ids).toEqual(["a", "b", "c"])
  })
})
