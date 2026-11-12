import { describe, expect, test } from "bun:test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import type { Session } from "@opencode-ai/sdk/v2/client"
import {
  createWorkspaceOperations,
  needsPostDeleteRedirect,
  shouldLeaveDeletedWorkspace,
} from "./workspace-operations"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import type { useLanguage } from "@/context/language"
import type { useLayout } from "@/context/layout"

describe("shouldLeaveDeletedWorkspace", () => {
  const input = (overrides: Partial<Parameters<typeof shouldLeaveDeletedWorkspace>[0]> = {}) => ({
    leaveDeletedWorkspace: false,
    hasRouteSlug: true,
    currentDirectory: "/r/w2",
    deletedDirectory: "/r/w1",
    ...overrides,
  })

  test("explicit leave flag wins", () => {
    expect(shouldLeaveDeletedWorkspace(input({ leaveDeletedWorkspace: true }))).toBe(true)
    expect(shouldLeaveDeletedWorkspace(input({ leaveDeletedWorkspace: true, hasRouteSlug: false }))).toBe(true)
  })

  test("stays when there is no active route slug", () => {
    expect(shouldLeaveDeletedWorkspace(input({ hasRouteSlug: false }))).toBe(false)
  })

  test("leaves when the deleted workspace is the current one", () => {
    expect(shouldLeaveDeletedWorkspace(input({ currentDirectory: "/r/w1" }))).toBe(true)
    expect(shouldLeaveDeletedWorkspace(input({ currentDirectory: "/r/w1/" }))).toBe(true)
  })

  test("stays when the current workspace is a different one", () => {
    expect(shouldLeaveDeletedWorkspace(input())).toBe(false)
  })
})

describe("needsPostDeleteRedirect", () => {
  const input = (overrides: Partial<Parameters<typeof needsPostDeleteRedirect>[0]> = {}) => ({
    hasRouteSlug: true,
    resolvedRoot: "/r",
    root: "/r",
    nextKey: "/r/w2",
    workspaceDirs: ["/r", "/r/w1"],
    ...overrides,
  })

  test("no redirect without a route slug", () => {
    expect(needsPostDeleteRedirect(input({ hasRouteSlug: false }))).toBe(false)
  })

  test("redirects when the routed directory no longer belongs to the project", () => {
    expect(needsPostDeleteRedirect(input())).toBe(true)
  })

  test("stays when the routed directory is still a valid workspace", () => {
    expect(needsPostDeleteRedirect(input({ nextKey: "/r/w1/" }))).toBe(false)
  })

  test("stays when the routed directory resolved to another project root", () => {
    expect(needsPostDeleteRedirect(input({ resolvedRoot: "/other" }))).toBe(false)
  })
})

const session = (id: string, archived?: number) =>
  ({
    title: "",
    version: "v2",
    slug: "",
    projectID: "p",
    directory: "/r/w1",
    parentID: undefined,
    messageCount: 0,
    permissions: { session: {}, share: {} },
    time: { created: 1, updated: 1, archived },
    ...{ id },
  }) as Session

describe("createWorkspaceOperations", () => {
  function setup(overrides: { currentDir?: () => string; removeResult?: { data: unknown }; resetResult?: { data: unknown } } = {}) {
    const calls: string[] = []
    const { removeResult = { data: true }, resetResult = { data: true }, ...rest } = overrides
    const input = {
      currentDir: () => "/r",
      params: { dir: "abc" },
      globalSDK: {
        client: {
          worktree: {
            remove: async () => {
              calls.push("remove")
              return removeResult
            },
            reset: async () => {
              calls.push("reset")
              return resetResult
            },
          },
          v2: {
            session: {
              list: async () => {
                calls.push("list")
                return { data: { items: [session("s1"), session("s2", 5)] } }
              },
              update: async (args: { sessionID: string }) => {
                calls.push("archive:" + args.sessionID)
                return { data: null }
              },
            },
          },
          instance: {
            dispose: async () => {
              calls.push("dispose")
              return { data: null }
            },
          },
        },
      } as unknown as ReturnType<typeof useGlobalSDK>,
      globalSync: {
        set: (_key: string, mutator: (draft: unknown) => void) => {
          calls.push("sandbox")
          mutator([{ worktree: "/r", sandboxes: ["/r/w1", "/r/w2"] }])
        },
      } as unknown as ReturnType<typeof useGlobalSync>,
      language: { t: (key: string) => key } as unknown as ReturnType<typeof useLanguage>,
      layout: {
        projects: {
          list: () => [{ worktree: "/r", sandboxes: ["/r/w1"] }],
          close: (directory: string) => calls.push("close:" + directory),
          open: (root: string) => calls.push("open:" + root),
        },
        mobileSidebar: { hide: () => calls.push("hideSidebar") },
      } as unknown as ReturnType<typeof useLayout>,
      store: {
        lastProjectSession: { "/r": { directory: "/r/w1", id: "s9", at: 0 } },
        workspaceOrder: { "/r": ["/r/w1"] },
      },
      navigateRoot: (href: string) => calls.push("navReset:" + href),
      navigate: (href: string) => calls.push("nav:" + href),
      setBusy: (directory: string, value: boolean) => calls.push("busy:" + directory + ":" + value),
      clearTerminals: (_directory: string, sessionIDs: string[]) => calls.push("terminals:" + sessionIDs.join(",")),
      removeWorkspaceOrder: (_root: string, directory: string) => calls.push("order:" + directory),
      resolveProjectRoot: () => "/r",
      clearLastProjectSession: (root: string) => calls.push("clearLast:" + root),
      ...rest,
    }
    const ops = createWorkspaceOperations(input as Parameters<typeof createWorkspaceOperations>[0])
    return { ops, calls }
  }

  test("delete: same-root guard short-circuits everything", async () => {
    const { ops, calls } = setup()
    await ops.deleteWorkspace("/r", "/r")
    expect(calls).toEqual([])
  })

  test("delete: happy path clears caches, order, closes workspace, reopens root", async () => {
    const { ops, calls } = setup()
    await ops.deleteWorkspace("/r", "/r/w1")
    expect(calls).toEqual([
      "busy:/r/w1:true",
      "remove",
      "busy:/r/w1:false",
      "clearLast:/r",
      "sandbox",
      "order:/r/w1",
      "close:/r/w1",
      "open:/r",
    ])
  })

  test("delete: navigating away from the deleted workspace redirects before removal", async () => {
    const { ops, calls } = setup({ currentDir: () => "/r/w1" })
    await ops.deleteWorkspace("/r", "/r/w1")
    expect(calls[0]).toBe(`navReset:/${base64Encode("/r")}/session`)
    expect(calls.at(-1)).toBe("open:/r")
    expect(calls.filter((c) => c.startsWith("navReset"))).toHaveLength(1)
  })

  test("delete: explicit leave flag skips the early redirect", async () => {
    const { ops, calls } = setup({ currentDir: () => "/r/w1" })
    await ops.deleteWorkspace("/r", "/r/w1", true)
    expect(calls.filter((c) => c.startsWith("navReset"))).toHaveLength(0)
    expect(calls.at(-1)).toBe("open:/r")
  })

  test("delete: failed removal keeps busy flag cleared and skips cleanup", async () => {
    const { ops, calls } = setup({ removeResult: { data: false } })
    await ops.deleteWorkspace("/r", "/r/w1")
    expect(calls).toEqual(["busy:/r/w1:true", "remove", "busy:/r/w1:false"])
  })

  test("reset: same-root guard short-circuits everything", async () => {
    const { ops, calls } = setup()
    await ops.resetWorkspace("/r", "/r")
    expect(calls).toEqual([])
  })

  test("reset: happy path disposes, resets, archives only active sessions", async () => {
    const { ops, calls } = setup()
    await ops.resetWorkspace("/r", "/r/w1")
    expect(calls).toEqual([
      "busy:/r/w1:true",
      "list",
      "terminals:s1,s2",
      "dispose",
      "reset",
      "archive:s1",
      "busy:/r/w1:false",
    ])
  })

  test("reset: failed reset skips session archiving", async () => {
    const { ops, calls } = setup({ resetResult: { data: false } })
    await ops.resetWorkspace("/r", "/r/w1")
    expect(calls).toEqual(["busy:/r/w1:true", "list", "terminals:s1,s2", "dispose", "reset", "busy:/r/w1:false"])
  })
})
