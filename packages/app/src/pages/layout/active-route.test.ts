import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { activeRouteTransition, createActiveRouteSync, type ActiveRouteState } from "./active-route"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const empty: ActiveRouteState = { session: "", sessionProject: "", directory: "" }

const transition = (prev: ActiveRouteState, overrides: Partial<Parameters<typeof activeRouteTransition>[1]> = {}) =>
  activeRouteTransition(prev, {
    ready: true,
    slug: "abc",
    id: "s1",
    root: "/repo",
    dir: "/repo",
    serverRoot: undefined,
    ...overrides,
  })

describe("activeRouteTransition", () => {
  test("resets when the page is not ready", () => {
    expect(transition(empty, { ready: false })).toEqual({ kind: "reset" })
  })

  test("resets when the route slug or directory is missing", () => {
    expect(transition(empty, { slug: undefined })).toEqual({ kind: "reset" })
    expect(transition(empty, { slug: "" })).toEqual({ kind: "reset" })
    expect(transition(empty, { dir: "" })).toEqual({ kind: "reset" })
  })

  test("resets when no session id is selected", () => {
    expect(transition(empty, { id: undefined })).toEqual({ kind: "reset" })
  })

  test("tracks a bare project route without touching the server project", () => {
    const action = transition(empty, { root: undefined })
    expect(action).toEqual({ kind: "project", session: "abc/s1", directory: "/repo" })
  })

  test("syncs on first resolution and requests the project touch", () => {
    const action = transition(empty)
    expect(action).toEqual({
      kind: "sync",
      session: "abc/s1",
      directory: "/repo",
      id: "s1",
      root: "/repo",
      touch: true,
    })
  })

  test("syncs without a touch when the server already points at the root", () => {
    const action = transition(empty, { serverRoot: "/repo" })
    expect(action).toMatchObject({ kind: "sync", touch: false })
  })

  test("syncs when the directory changes for the same session id", () => {
    const prev: ActiveRouteState = { session: "abc/s1", sessionProject: "/repo", directory: "/repo" }
    const action = transition(prev, { dir: "/repo/workspace" })
    expect(action).toMatchObject({ kind: "sync", directory: "/repo/workspace", touch: true })
  })

  test("is a no-op when the route and project root are unchanged", () => {
    const prev: ActiveRouteState = { session: "abc/s1", sessionProject: "/repo", directory: "/repo" }
    const action = transition(prev, { serverRoot: "/repo" })
    expect(action).toEqual({ kind: "none", root: "/repo", touch: false })
  })

  test("still requests the touch on the no-op path when the server points elsewhere", () => {
    const prev: ActiveRouteState = { session: "abc/s1", sessionProject: "/repo", directory: "/repo" }
    const action = transition(prev, { serverRoot: "/other" })
    expect(action).toEqual({ kind: "none", root: "/repo", touch: true })
  })

  test("remembers the project when only the root changes for a stable route", () => {
    const prev: ActiveRouteState = { session: "abc/s1", sessionProject: "/repo", directory: "/repo" }
    const action = transition(prev, { root: "/fork" })
    expect(action).toEqual({
      kind: "remember",
      directory: "/repo",
      id: "s1",
      root: "/fork",
      touch: true,
    })
  })
})

describe("createActiveRouteSync", () => {
  function setup() {
    const pageReady = createSignal(true)
    const slug = createSignal<string | undefined>(undefined)
    const sessionId = createSignal<string | undefined>(undefined)
    const projectRoot = createSignal<string | undefined>(undefined)
    const directory = createSignal("")
    const calls: string[] = []
    let serverRoot: string | undefined = undefined

    const route = createActiveRouteSync({
      pageReady: () => pageReady[0](),
      slug: () => slug[0](),
      sessionId: () => sessionId[0](),
      projectRoot: () => projectRoot[0](),
      directory: () => directory[0](),
      lastServerProjectRoot: () => serverRoot,
      touchProject: (root) => {
        serverRoot = root
        calls.push(`touch:${root}`)
      },
      syncSessionRoute: (dir, id, root) => {
        calls.push(`sync:${dir}:${id}:${root}`)
        return root
      },
      rememberSessionRoute: (dir, id, root) => {
        calls.push(`remember:${dir}:${id}:${root}`)
        return root
      },
    })
    return { route, calls, pageReady, slug, sessionId, projectRoot, directory }
  }

  test("starts empty without touching or remembering", async () => {
    await createRoot(async (dispose) => {
      const { route, calls } = setup()
      await tick()
      expect(route).toEqual({ session: "", sessionProject: "", directory: "" })
      expect(calls).toEqual([])
      dispose()
    })
  })

  test("clears the route when the session id is removed", async () => {
    await createRoot(async (dispose) => {
      const { route, slug, sessionId, directory } = setup()
      await tick()
      slug[1]("abc")
      sessionId[1]("s1")
      directory[1]("/repo")
      await tick()
      expect(route.session).toBe("abc/s1")

      sessionId[1](undefined)
      await tick()
      expect(route).toEqual({ session: "", sessionProject: "", directory: "" })
      dispose()
    })
  })

  test("remembers the project when the root resolves after the route", async () => {
    await createRoot(async (dispose) => {
      const { route, calls, slug, sessionId, projectRoot, directory } = setup()
      await tick()
      slug[1]("abc")
      sessionId[1]("s1")
      directory[1]("/repo")
      await tick()
      expect(route).toEqual({ session: "abc/s1", sessionProject: "", directory: "/repo" })
      expect(calls).toEqual([])

      projectRoot[1]("/repo")
      await tick()
      expect(route).toEqual({ session: "abc/s1", sessionProject: "/repo", directory: "/repo" })
      expect(calls).toEqual(["touch:/repo", "remember:/repo:s1:/repo"])
      dispose()
    })
  })

  test("does not re-sync when nothing changes", async () => {
    await createRoot(async (dispose) => {
      const { calls, slug, sessionId, projectRoot, directory } = setup()
      await tick()
      slug[1]("abc")
      sessionId[1]("s1")
      directory[1]("/repo")
      projectRoot[1]("/repo")
      await tick()
      expect(calls).toEqual(["touch:/repo", "remember:/repo:s1:/repo"])

      directory[1]("/repo")
      await tick()
      expect(calls).toEqual(["touch:/repo", "remember:/repo:s1:/repo"])
      dispose()
    })
  })

  test("remembers instead of syncing when only the project root changes", async () => {
    await createRoot(async (dispose) => {
      const { route, calls, slug, sessionId, projectRoot, directory } = setup()
      await tick()
      slug[1]("abc")
      sessionId[1]("s1")
      directory[1]("/repo")
      projectRoot[1]("/repo")
      await tick()
      calls.length = 0

      projectRoot[1]("/fork")
      await tick()
      expect(route.sessionProject).toBe("/fork")
      expect(calls).toEqual(["touch:/fork", "remember:/repo:s1:/fork"])
      dispose()
    })
  })
})
