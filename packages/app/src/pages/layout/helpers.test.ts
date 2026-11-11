import { describe, expect, test } from "bun:test"
import {
  collectNewSessionDeepLinks,
  collectOpenProjectDeepLinks,
  drainPendingDeepLinks,
  parseDeepLink,
  parseNewSessionDeepLink,
} from "./deep-links"
import { type Session } from "@opencode-ai/sdk/v2/client"
import {
  childSessionOnPath,
  dialogLeftMargin,
  displayName,
  effectiveWorkspaceOrder,
  errorMessage,
  hasProjectPermissions,
  latestRootSession,
  orderedWorkspaceIds,
  panelSide,
  panelWidth,
  sessionIsWorking,
} from "./helpers"
import { pathKey } from "@/utils/path-key"

const session = (input: Partial<Session> & Pick<Session, "id" | "directory">) =>
  ({
    title: "",
    version: "v2",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: 0, updated: 0, archived: undefined },
    ...input,
  }) as Session

describe("session working state", () => {
  test("only busy and retry statuses show the working indicator", () => {
    expect(sessionIsWorking({ type: "busy" })).toBe(true)
    expect(sessionIsWorking({ type: "retry", attempt: 1, message: "retrying", next: 1 })).toBe(true)
    expect(sessionIsWorking({ type: "idle" })).toBe(false)
    expect(sessionIsWorking(undefined)).toBe(false)
  })
})

describe("layout deep links", () => {
  test("parses open-project deep links", () => {
    expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
  })

  test("ignores non-project deep links", () => {
    expect(parseDeepLink("opencode://other?directory=/tmp/demo")).toBeUndefined()
    expect(parseDeepLink("https://example.com")).toBeUndefined()
  })

  test("ignores malformed deep links safely", () => {
    expect(() => parseDeepLink("opencode://open-project/%E0%A4%A%")).not.toThrow()
    expect(parseDeepLink("opencode://open-project/%E0%A4%A%")).toBeUndefined()
  })

  test("parses links when URL.canParse is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(URL, "canParse")
    Object.defineProperty(URL, "canParse", { configurable: true, value: undefined })
    try {
      expect(parseDeepLink("opencode://open-project?directory=/tmp/demo")).toBe("/tmp/demo")
    } finally {
      if (original) Object.defineProperty(URL, "canParse", original)
      if (!original) Reflect.deleteProperty(URL, "canParse")
    }
  })

  test("ignores open-project deep links without directory", () => {
    expect(parseDeepLink("opencode://open-project")).toBeUndefined()
    expect(parseDeepLink("opencode://open-project?directory=")).toBeUndefined()
  })

  test("collects only valid open-project directories", () => {
    const result = collectOpenProjectDeepLinks([
      "opencode://open-project?directory=/a",
      "opencode://other?directory=/b",
      "opencode://open-project?directory=/c",
    ])
    expect(result).toEqual(["/a", "/c"])
  })

  test("parses new-session deep links with optional prompt", () => {
    expect(parseNewSessionDeepLink("opencode://new-session?directory=/tmp/demo")).toEqual({ directory: "/tmp/demo" })
    expect(parseNewSessionDeepLink("opencode://new-session?directory=/tmp/demo&prompt=hello%20world")).toEqual({
      directory: "/tmp/demo",
      prompt: "hello world",
    })
  })

  test("ignores new-session deep links without directory", () => {
    expect(parseNewSessionDeepLink("opencode://new-session")).toBeUndefined()
    expect(parseNewSessionDeepLink("opencode://new-session?directory=")).toBeUndefined()
  })

  test("collects only valid new-session deep links", () => {
    const result = collectNewSessionDeepLinks([
      "opencode://new-session?directory=/a",
      "opencode://open-project?directory=/b",
      "opencode://new-session?directory=/c&prompt=ship%20it",
    ])
    expect(result).toEqual([{ directory: "/a" }, { directory: "/c", prompt: "ship it" }])
  })

  test("drains global deep links once", () => {
    const target = {
      __OPENCODE__: {
        deepLinks: ["opencode://open-project?directory=/a"],
      },
    } as unknown as Window & { __OPENCODE__?: { deepLinks?: string[] } }

    expect(drainPendingDeepLinks(target)).toEqual(["opencode://open-project?directory=/a"])
    expect(drainPendingDeepLinks(target)).toEqual([])
  })
})

describe("layout workspace helpers", () => {
  test("normalizes trailing slash in workspace key", () => {
    expect(String(pathKey("/tmp/demo///"))).toBe("/tmp/demo")
    expect(String(pathKey("C:\\tmp\\demo\\\\"))).toBe("C:/tmp/demo")
  })

  test("preserves posix and drive roots in workspace key", () => {
    expect(String(pathKey("/"))).toBe("/")
    expect(String(pathKey("///"))).toBe("/")
    expect(String(pathKey("C:\\"))).toBe("C:/")
    expect(String(pathKey("C://"))).toBe("C:/")
    expect(String(pathKey("C:///"))).toBe("C:/")
  })

  test("keeps local first while preserving known order", () => {
    const result = effectiveWorkspaceOrder("/root", ["/root", "/b", "/c"], ["/root", "/c", "/a", "/b"])
    expect(result).toEqual(["/root", "/c", "/b"])
  })

  test("finds the latest root session across workspaces", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/root" },
          session: [session({ id: "root", directory: "/root", time: { created: 1, updated: 1, archived: undefined } })],
        },
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "workspace",
              directory: "/workspace",
              time: { created: 2, updated: 2, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("workspace")
  })

  test("detects project permissions with a filter", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }, { id: "perm-hidden" }],
        child: [{ id: "perm-child" }],
      },
      (item) => item.id === "perm-child",
    )

    expect(result).toBe(true)
  })

  test("ignores project permissions filtered out", () => {
    const result = hasProjectPermissions(
      {
        root: [{ id: "perm-root" }],
      },
      () => false,
    )

    expect(result).toBe(false)
  })

  test("ignores archived and child sessions when finding latest root session", () => {
    const result = latestRootSession(
      [
        {
          path: { directory: "/workspace" },
          session: [
            session({
              id: "archived",
              directory: "/workspace",
              time: { created: 10, updated: 10, archived: 10 },
            }),
            session({
              id: "child",
              directory: "/workspace",
              parentID: "parent",
              time: { created: 20, updated: 20, archived: undefined },
            }),
            session({
              id: "root",
              directory: "/workspace",
              time: { created: 30, updated: 30, archived: undefined },
            }),
          ],
        },
      ],
      120_000,
    )

    expect(result?.id).toBe("root")
  })

  test("finds the direct child on the active session path", () => {
    const list = [
      session({ id: "root", directory: "/workspace" }),
      session({ id: "child", directory: "/workspace", parentID: "root" }),
      session({ id: "leaf", directory: "/workspace", parentID: "child" }),
    ]

    expect(childSessionOnPath(list, "root", "leaf")?.id).toBe("child")
    expect(childSessionOnPath(list, "child", "leaf")?.id).toBe("leaf")
    expect(childSessionOnPath(list, "root", "root")).toBeUndefined()
    expect(childSessionOnPath(list, "root", "other")).toBeUndefined()
  })

  test("formats fallback project display name", () => {
    expect(displayName({ worktree: "/tmp/app" })).toBe("app")
    expect(displayName({ worktree: "/tmp/app", name: "My App" })).toBe("My App")
  })

  test("extracts api error message and fallback", () => {
    expect(errorMessage({ data: { message: "boom" } }, "fallback")).toBe("boom")
    expect(errorMessage(new Error("broken"), "fallback")).toBe("broken")
    expect(errorMessage("unknown", "fallback")).toBe("fallback")
  })
})

describe("dialog left margin", () => {
  test("uses the sidebar width when opened", () => {
    expect(dialogLeftMargin(true, 260)).toBe(260)
  })

  test("falls back to the collapsed rail width when closed", () => {
    expect(dialogLeftMargin(false, 260)).toBe(48)
  })
})

describe("panel sizing", () => {
  test("side clamps the sidebar width to a 244px floor", () => {
    expect(panelSide(200)).toBe(244)
    expect(panelSide(244)).toBe(244)
    expect(panelSide(320)).toBe(320)
  })

  test("panel width reserves 64px and clamps at zero", () => {
    expect(panelWidth(244)).toBe(180)
    expect(panelWidth(64)).toBe(0)
    expect(panelWidth(10)).toBe(0)
  })
})

describe("orderedWorkspaceIds", () => {
  const input = (overrides: Partial<Parameters<typeof orderedWorkspaceIds>[0]> = {}) => ({
    worktree: "/repo",
    sandboxes: ["/repo/a", "/repo/b"],
    persistedOrder: undefined,
    currentDirectory: undefined,
    isPending: () => false,
    ...overrides,
  })

  test("orders local first, then sandboxes via effectiveWorkspaceOrder", () => {
    expect(orderedWorkspaceIds(input())).toEqual(["/repo", "/repo/a", "/repo/b"])
  })

  test("appends a non-pending current directory outside the sandbox list", () => {
    expect(orderedWorkspaceIds(input({ currentDirectory: "/repo/extra" }))).toEqual([
      "/repo",
      "/repo/a",
      "/repo/b",
      "/repo/extra",
    ])
  })

  test("puts a pending current directory right after local", () => {
    expect(
      orderedWorkspaceIds(input({ currentDirectory: "/repo/extra", isPending: (d) => d === "/repo/extra" })),
    ).toEqual(["/repo", "/repo/extra", "/repo/a", "/repo/b"])
  })

  test("ignores the current directory when it is already among the workspaces", () => {
    expect(orderedWorkspaceIds(input({ currentDirectory: "/repo/b" }))).toEqual(["/repo", "/repo/a", "/repo/b"])
  })

  test("ignores a current directory equal to the local worktree", () => {
    expect(orderedWorkspaceIds(input({ currentDirectory: "/repo/" }))).toEqual(["/repo", "/repo/a", "/repo/b"])
  })

  test("persists a custom order over the sandbox order", () => {
    expect(orderedWorkspaceIds(input({ persistedOrder: ["/repo/b", "/repo/a"] }))).toEqual([
      "/repo",
      "/repo/b",
      "/repo/a",
    ])
  })
})
