import { describe, expect, test } from "bun:test"
import { collectSessionDescendants } from "../../../../src/cli/cmd/tui/util/session-tree"

type TreeSession = { id: string; parentID?: string | null }

const session = (id: string, parentID?: string | null): TreeSession => ({
  id,
  parentID: parentID === undefined ? undefined : parentID,
})

// A minimal helper replicating the TUI `children` memo (src/.../session/index.tsx)
// semantics, filtered to the subagent navigation targets used by
// moveFirstChild/moveChild (which keep only `!!x.parentID`). This lets us assert the
// direct-children semantics stay correct while the aggregation walks the full subtree.
function navigationTargets(sessions: TreeSession[], root: string): string[] {
  const parentID = sessions.find((x) => x.id === root)?.parentID ?? root
  return sessions
    .filter((x) => (x.parentID === parentID || x.id === parentID) && !!x.parentID)
    .map((x) => x.id)
}

describe("collectSessionDescendants", () => {
  test("depth-0 returns only the root", () => {
    const sessions = [session("root")]
    expect([...collectSessionDescendants(sessions, "root")]).toEqual(["root"])
  })

  test("depth-1 includes root and direct children", () => {
    const sessions = [session("root"), session("a", "root"), session("b", "root")]
    expect([...collectSessionDescendants(sessions, "root")].sort()).toEqual(["a", "b", "root"])
  })

  test("depth-2 includes grandchild", () => {
    const sessions = [
      session("root"),
      session("a", "root"),
      session("a1", "a"),
    ]
    expect([...collectSessionDescendants(sessions, "root")].sort()).toEqual(["a", "a1", "root"])
  })

  test("depth-3 includes great-grandchild", () => {
    const sessions = [
      session("root"),
      session("a", "root"),
      session("b", "a"),
      session("c", "b"),
    ]
    expect([...collectSessionDescendants(sessions, "root")].sort()).toEqual(["a", "b", "c", "root"])
  })

  test("excludes a sibling subtree that is not a descendant", () => {
    const sessions = [
      session("root"),
      session("child", "root"),
      session("grandchild", "child"),
      // sibling of the root, not a descendant
      session("sibling"),
      session("siblingChild", "sibling"),
    ]
    expect([...collectSessionDescendants(sessions, "root")].sort()).toEqual(["child", "grandchild", "root"])
  })

  test("includes the viewed session's own ID when it is itself a subagent", () => {
    const sessions = [
      session("root"),
      session("sub", "root"),
      session("grand", "sub"),
      session("great", "grand"),
    ]
    // Viewing "sub" directly: own ID + descendants, but NOT the root.
    expect([...collectSessionDescendants(sessions, "sub")].sort()).toEqual(["grand", "great", "sub"])
  })

  test("ignores falsy parentID empty string sentinel", () => {
    const sessions = [session("root", ""), session("child", "root")]
    expect([...collectSessionDescendants(sessions, "root")].sort()).toEqual(["child", "root"])
  })

  test("ignores null parentID", () => {
    const sessions = [session("root", null), session("child", "root")]
    expect([...collectSessionDescendants(sessions, "root")].sort()).toEqual(["child", "root"])
  })

  test("ignores undefined parentID", () => {
    const sessions = [session("root"), session("child", "root")]
    expect([...collectSessionDescendants(sessions, "root")].sort()).toEqual(["child", "root"])
  })

  test("is cycle-safe and terminates on a parentID loop", () => {
    const sessions = [
      session("a", "b"),
      session("b", "a"),
      session("c", "a"),
    ]
    expect([...collectSessionDescendants(sessions, "a")].sort()).toEqual(["a", "b", "c"])
  })

  test("deduplicates across a diamond-shaped graph", () => {
    const sessions = [
      session("root"),
      session("left", "root"),
      session("right", "root"),
      // grandchild with two parents (diamond)
      session("diamond", "left"),
      session("diamond", "right"),
    ]
    expect([...collectSessionDescendants(sessions, "root")].sort()).toEqual(["diamond", "left", "right", "root"])
  })

  test("navigation preserved: direct children of the root are unchanged", () => {
    const sessions = [
      session("root"),
      session("child1", "root"),
      session("child2", "root"),
      session("grandchild", "child1"),
    ]
    const ids = collectSessionDescendants(sessions, "root")
    expect([...ids].sort()).toEqual(["child1", "child2", "grandchild", "root"])

    // moveFirstChild/moveChild navigate between DIRECT children only.
    const nav = navigationTargets(sessions, "root").sort()
    expect(nav).toEqual(["child1", "child2"])
  })
})