// Characterization tests (Rule 3, #380 Phase 1/2): lock the pure helper surface
// of message-part.tsx before the god-file split. These import from
// message-part.tsx now and follow the helpers into message-part.shared.ts.
import { afterAll, describe, expect, mock, test } from "bun:test"
import type { Part, Session, ToolPart } from "@opencode-ai/sdk/v2"
import type { PartGroup } from "./message-part"

// message-part.tsx imports @solidjs/router, which reads window.history at module
// load — bun test has no DOM. Stub it before the dynamic import (see
// message-part.test.ts for the same pattern).
mock.module("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => () => {},
}))
afterAll(() => mock.restore())

const {
  currentSession,
  groupParts,
  index,
  isContextGroupTool,
  list,
  partDefaultOpen,
  relativizeProjectPath,
  same,
  sameGroup,
  sameGroups,
  sameRef,
  sessionLink,
  taskSession,
  toolDefaultOpen,
  urls,
} = await import("./message-part")

describe("relativizeProjectPath", () => {
  test("strips the directory but keeps the path's leading separator", () => {
    expect(relativizeProjectPath("/proj/src/a.ts", "/proj")).toBe("/src/a.ts")
    expect(relativizeProjectPath("C:\\proj\\src\\a.ts", "C:\\proj")).toBe("\\src\\a.ts")
  })

  test("passes through when directory is missing, root, or not a prefix", () => {
    expect(relativizeProjectPath("/other/a.ts", "/proj")).toBe("/other/a.ts")
    expect(relativizeProjectPath("/proj/a.ts", "/")).toBe("/proj/a.ts")
    expect(relativizeProjectPath("/proj/a.ts", "\\")).toBe("/proj/a.ts")
    expect(relativizeProjectPath("/proj/a.ts")).toBe("/proj/a.ts")
    expect(relativizeProjectPath("", "/proj")).toBe("")
  })

  test("exact directory match relativizes to empty string", () => {
    expect(relativizeProjectPath("/proj", "/proj")).toBe("")
  })

  test("directory with trailing separator strips the separator too", () => {
    expect(relativizeProjectPath("/proj/src/a.ts", "/proj/")).toBe("src/a.ts")
  })
})

describe("urls", () => {
  test("extracts unique http(s) urls and trims trailing punctuation", () => {
    expect(urls("see https://x.dev/a, and http://y.dev/b.")).toEqual(["https://x.dev/a", "http://y.dev/b"])
  })

  test("deduplicates and handles empty input", () => {
    expect(urls("https://x.dev/a https://x.dev/a")).toEqual(["https://x.dev/a"])
    expect(urls(undefined)).toEqual([])
    expect(urls("")).toEqual([])
    expect(urls("no urls here")).toEqual([])
  })

  test("stops at angle brackets, quotes, and backticks", () => {
    expect(urls("<https://x.dev/a>")).toEqual(["https://x.dev/a"])
    expect(urls('"https://x.dev/a"')).toEqual(["https://x.dev/a"])
  })
})

describe("sessionLink / currentSession", () => {
  test("sessionLink prefers the href callback, then rewrites /session paths", () => {
    expect(sessionLink("s1", "/dir/session")).toBe("/dir/session/s1")
    expect(sessionLink("s1", "/dir/session", (id) => `/custom/${id}`)).toBe("/custom/s1")
    expect(sessionLink(undefined, "/dir/session")).toBeUndefined()
    expect(sessionLink("s1", "/no-session-here")).toBeUndefined()
  })

  test("currentSession extracts the session id from a path", () => {
    expect(currentSession("/dir/session/abc")).toBe("abc")
    expect(currentSession("/dir/session/abc?x=1")).toBe("abc")
    expect(currentSession("/dir/session")).toBeUndefined()
  })
})

describe("taskSession", () => {
  const parent = "parent-1"
  const mk = (id: string, title: string, created: number, archived?: unknown) =>
    ({
      id,
      title,
      parentID: parent,
      time: { created, archived },
    }) as unknown as Session

  test("picks the latest matching non-archived child by title prefix and agent", () => {
    const sessions = [mk("a", "fix bug @Build", 1), mk("b", "fix bug @Build", 5), mk("c", "other @Build", 9)]
    expect(taskSession({ description: "fix bug", subagent_type: "build" }, `/s/session/${parent}`, sessions)).toBe("b")
  })

  test("returns undefined without a current session or without sessions", () => {
    expect(taskSession({}, "/elsewhere", [])).toBeUndefined()
    expect(taskSession({ description: "d" }, `/s/session/${parent}`, undefined)).toBeUndefined()
  })

  test("skips archived children", () => {
    const sessions = [mk("a", "task @Build", 1), mk("b", "task @Build", 9, true)]
    expect(taskSession({ description: "task", subagent_type: "build" }, `/s/session/${parent}`, sessions)).toBe("a")
  })

  test("no description matches any title for the agent", () => {
    const sessions = [mk("a", "alpha @Build", 1), mk("b", "beta @Build", 2)]
    expect(taskSession({ subagent_type: "build" }, `/s/session/${parent}`, sessions)).toBe("b")
  })
})

describe("list / same / index", () => {
  test("list falls back on non-array input", () => {
    const fallback = ["x"]
    expect(list(undefined, fallback)).toBe(fallback)
    expect(list(null, fallback)).toBe(fallback)
    const arr = ["y"]
    expect(list(arr, fallback)).toBe(arr)
  })

  test("same is reference-true, null/false mismatched, elementwise otherwise", () => {
    const arr = [1, 2]
    expect(same(arr, arr)).toBe(true)
    expect(same(undefined, undefined)).toBe(true)
    expect(same(undefined, arr)).toBe(false)
    expect(same(arr, undefined)).toBe(false)
    expect(same([1, 2], [1, 2])).toBe(true)
    expect(same([1, 2], [1, 2, 3])).toBe(false)
    expect(same([1, 2], [2, 1])).toBe(false)
  })

  test("index maps by id, last wins", () => {
    const map = index([{ id: "a" }, { id: "b" }, { id: "a" }])
    expect(map.get("a")).toEqual({ id: "a" })
    expect(map.get("b")).toEqual({ id: "b" })
    expect(map.size).toBe(2)
  })
})

describe("groupParts / equality", () => {
  const tool = (id: string, name: string) => ({ id, type: "tool", tool: name }) as unknown as Part
  const text = (id: string) => ({ id, type: "text", text: "hi" }) as unknown as Part
  const wrap = (messageID: string, part: Part) => ({ messageID, part })

  test("isContextGroupTool matches read/glob/grep/list only", () => {
    expect(isContextGroupTool(tool("1", "read"))).toBe(true)
    expect(isContextGroupTool(tool("2", "grep"))).toBe(true)
    expect(isContextGroupTool(tool("3", "bash"))).toBe(false)
    expect(isContextGroupTool(text("4"))).toBe(false)
  })

  test("groups consecutive context tools, keeps others as parts", () => {
    const groups = groupParts([
      wrap("m1", text("t1")),
      wrap("m1", tool("r1", "read")),
      wrap("m1", tool("r2", "glob")),
      wrap("m1", tool("b1", "bash")),
      wrap("m2", tool("r3", "grep")),
    ])
    expect(groups).toEqual([
      { key: "part:m1:t1", type: "part", ref: { messageID: "m1", partID: "t1" } },
      {
        key: "context:r1",
        type: "context",
        refs: [
          { messageID: "m1", partID: "r1" },
          { messageID: "m1", partID: "r2" },
        ],
      },
      { key: "part:m1:b1", type: "part", ref: { messageID: "m1", partID: "b1" } },
      {
        key: "context:r3",
        type: "context",
        refs: [{ messageID: "m2", partID: "r3" }],
      },
    ])
  })

  test("leading and trailing context runs flush correctly", () => {
    const groups = groupParts([wrap("m1", tool("r1", "list")), wrap("m1", text("t1"))])
    expect(groups).toEqual([
      { key: "context:r1", type: "context", refs: [{ messageID: "m1", partID: "r1" }] },
      { key: "part:m1:t1", type: "part", ref: { messageID: "m1", partID: "t1" } },
    ])
    expect(groupParts([])).toEqual([])
    expect(groupParts([wrap("m1", tool("r1", "read"))])).toEqual([
      { key: "context:r1", type: "context", refs: [{ messageID: "m1", partID: "r1" }] },
    ])
  })

  test("sameRef compares both ids", () => {
    expect(sameRef({ messageID: "m", partID: "p" }, { messageID: "m", partID: "p" })).toBe(true)
    expect(sameRef({ messageID: "m", partID: "p" }, { messageID: "m", partID: "q" })).toBe(false)
    expect(sameRef({ messageID: "m", partID: "p" }, { messageID: "n", partID: "p" })).toBe(false)
  })

  test("sameGroup compares keys, types, and payloads", () => {
    const partGroup: PartGroup = { key: "k", type: "part", ref: { messageID: "m", partID: "p" } }
    const ctxGroup: PartGroup = { key: "c", type: "context", refs: [{ messageID: "m", partID: "p" }] }
    expect(sameGroup(partGroup, { ...partGroup })).toBe(true)
    expect(sameGroup(partGroup, { ...partGroup, key: "x" })).toBe(false)
    expect(sameGroup(ctxGroup, { ...ctxGroup, refs: [] })).toBe(false)
    expect(sameGroup(ctxGroup, { ...ctxGroup, refs: [{ messageID: "m", partID: "p" }] })).toBe(true)
    expect(sameGroup(partGroup, ctxGroup)).toBe(false)
    expect(sameGroup(partGroup, partGroup)).toBe(true) // reference identity
  })

  test("sameGroups handles undefined and elementwise comparison", () => {
    const groups: PartGroup[] = [{ key: "k", type: "part", ref: { messageID: "m", partID: "p" } }]
    expect(sameGroups(undefined, undefined)).toBe(true)
    expect(sameGroups(groups, undefined)).toBe(false)
    expect(sameGroups(groups, [{ ...groups[0]! }])).toBe(true)
    expect(sameGroups(groups, [])).toBe(false)
  })
})

describe("toolDefaultOpen / partDefaultOpen", () => {
  test("bash follows the shell flag, edit/write/apply_patch the edit flag", () => {
    expect(toolDefaultOpen("bash", true)).toBe(true)
    expect(toolDefaultOpen("bash")).toBe(false)
    expect(toolDefaultOpen("edit", false, true)).toBe(true)
    expect(toolDefaultOpen("write", false, true)).toBe(true)
    expect(toolDefaultOpen("apply_patch", false, true)).toBe(true)
    expect(toolDefaultOpen("edit")).toBe(false)
    expect(toolDefaultOpen("read")).toBeUndefined()
  })

  test("partDefaultOpen only answers for tool parts", () => {
    const toolPart = { id: "1", type: "tool", tool: "bash" } as unknown as ToolPart
    const textPart = { id: "2", type: "text", text: "x" } as unknown as Part
    expect(partDefaultOpen(toolPart, true)).toBe(true)
    expect(partDefaultOpen(textPart, true)).toBeUndefined()
  })
})
