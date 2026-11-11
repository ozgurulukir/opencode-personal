import { describe, expect, test } from "bun:test"
import { atOptionKey, atOptionGroup, compareAtGroups, atSelectPart, createAtMentionItems } from "./at-mentions"

describe("prompt-input at-mentions", () => {
  test("atOptionKey returns empty string for undefined option", () => {
    expect(atOptionKey(undefined)).toBe("")
  })

  test("atOptionKey keys agent options as agent:<name>", () => {
    expect(atOptionKey({ type: "agent", name: "plan", display: "plan" })).toBe("agent:plan")
  })

  test("atOptionKey keys file options as file:<path>", () => {
    expect(atOptionKey({ type: "file", path: "src/foo.ts", display: "src/foo.ts" })).toBe("file:src/foo.ts")
  })

  test("atOptionGroup categorizes agents as agent regardless of recency flags", () => {
    expect(atOptionGroup({ type: "agent", name: "plan", display: "plan" })).toBe("agent")
  })

  test("atOptionGroup categorizes recent file options as recent", () => {
    expect(atOptionGroup({ type: "file", path: "a.ts", display: "a.ts", recent: true })).toBe("recent")
  })

  test("atOptionGroup categorizes non-recent file options as file", () => {
    expect(atOptionGroup({ type: "file", path: "a.ts", display: "a.ts" })).toBe("file")
  })

  test("compareAtGroups orders agent before recent before file", () => {
    const groups = [{ category: "file" }, { category: "recent" }, { category: "agent" }, { category: "file" }, { category: "recent" }]
    const sorted = [...groups].sort(compareAtGroups).map((group) => group.category)
    expect(sorted).toEqual(["agent", "recent", "recent", "file", "file"])
  })

  test("compareAtGroups treats equal categories as tied", () => {
    expect(compareAtGroups({ category: "file" }, { category: "file" })).toBe(0)
  })

  test("atSelectPart builds an agent pill part with @-prefixed content at origin", () => {
    expect(atSelectPart({ type: "agent", name: "plan", display: "plan" })).toEqual({
      type: "agent",
      name: "plan",
      content: "@plan",
      start: 0,
      end: 0,
    })
  })

  test("atSelectPart builds a file pill part with @-prefixed content at origin", () => {
    expect(atSelectPart({ type: "file", path: "src/foo.ts", display: "src/foo.ts", recent: true })).toEqual({
      type: "file",
      path: "src/foo.ts",
      content: "@src/foo.ts",
      start: 0,
      end: 0,
    })
  })

  test("items with a blank query returns agents followed by pinned recents", async () => {
    const items = createAtMentionItems({
      agents: () => [{ type: "agent", name: "plan", display: "plan" }],
      recentPaths: () => ["b.ts", "a.ts"],
      searchFiles: async () => {
        throw new Error("search must not run for blank queries")
      },
    })

    expect(await items("   ")).toEqual([
      { type: "agent", name: "plan", display: "plan" },
      { type: "file", path: "b.ts", display: "b.ts", recent: true },
      { type: "file", path: "a.ts", display: "a.ts", recent: true },
    ])
  })

  test("items with a query appends search results after agents and pinned recents", async () => {
    const items = createAtMentionItems({
      agents: () => [{ type: "agent", name: "plan", display: "plan" }],
      recentPaths: () => ["b.ts"],
      searchFiles: async (query) => (query === "fo" ? ["foo.ts", "bar/foo.ts"] : []),
    })

    expect(await items("fo")).toEqual([
      { type: "agent", name: "plan", display: "plan" },
      { type: "file", path: "b.ts", display: "b.ts", recent: true },
      { type: "file", path: "foo.ts", display: "foo.ts" },
      { type: "file", path: "bar/foo.ts", display: "bar/foo.ts" },
    ])
  })

  test("items excludes search results already present in recents", async () => {
    const items = createAtMentionItems({
      agents: () => [],
      recentPaths: () => ["dupe.ts"],
      searchFiles: async () => ["dupe.ts", "fresh.ts"],
    })

    expect(await items("d")).toEqual([
      { type: "file", path: "dupe.ts", display: "dupe.ts", recent: true },
      { type: "file", path: "fresh.ts", display: "fresh.ts" },
    ])
  })
})
