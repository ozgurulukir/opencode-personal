import { describe, expect, test } from "bun:test"
import {
  collectSessionDescendants,
  firstChildSession,
  nextSiblingSession,
  sortChildSessions,
} from "../../../../src/cli/cmd/tui/util/session-tree"

type TreeSession = { id: string; parentID?: string | null; time?: { created: number } }

const session = (id: string, parentID?: string | null, created = 0): TreeSession => ({
  id,
  parentID: parentID === undefined ? undefined : parentID,
  time: { created },
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

describe("child and sibling session navigation", () => {
  test("sortChildSessions orders direct children chronologically (oldest-first) with id tiebreaker", () => {
    const sessions = [
      session("root", undefined, 100),
      // Descending ULID-style IDs where newest has lexicographically smaller ID
      session("ses_001_newest", "root", 300),
      session("ses_002_middle", "root", 200),
      session("ses_003_oldest", "root", 150),
    ]
    const children = sortChildSessions(sessions, "root")
    expect(children.map((x) => x.id)).toEqual(["ses_003_oldest", "ses_002_middle", "ses_001_newest"])
  })

  test("firstChildSession finds direct child from root AND from a child session that has grandchildren", () => {
    const sessions = [
      session("root", undefined, 100),
      session("child1", "root", 200),
      session("child2", "root", 300),
      session("grandchild1", "child1", 400),
      session("grandchild2", "child1", 500),
    ]
    expect(firstChildSession(sessions, "root")?.id).toBe("child1")
    // Viewing child1 and pressing session.child.first navigates into grandchild1 (not child1 itself!)
    expect(firstChildSession(sessions, "child1")?.id).toBe("grandchild1")
    // Viewing child2 (no grandchildren) returns undefined
    expect(firstChildSession(sessions, "child2")).toBeUndefined()
  })

  test("nextSiblingSession cycles forward (+1) and backward (-1) in chronological order", () => {
    const sessions = [
      session("root", undefined, 100),
      session("ses_001_third", "root", 300),
      session("ses_002_second", "root", 200),
      session("ses_003_first", "root", 150),
    ]
    // Forward (+1): first -> second -> third -> first (wraps)
    expect(nextSiblingSession(sessions, "ses_003_first", 1)?.id).toBe("ses_002_second")
    expect(nextSiblingSession(sessions, "ses_002_second", 1)?.id).toBe("ses_001_third")
    expect(nextSiblingSession(sessions, "ses_001_third", 1)?.id).toBe("ses_003_first")

    // Backward (-1): first -> third (wraps) -> second -> first
    expect(nextSiblingSession(sessions, "ses_003_first", -1)?.id).toBe("ses_001_third")
    expect(nextSiblingSession(sessions, "ses_001_third", -1)?.id).toBe("ses_002_second")
    expect(nextSiblingSession(sessions, "ses_002_second", -1)?.id).toBe("ses_003_first")
  })
})