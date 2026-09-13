/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import { tmpdir } from "../../../fixture/fixture"
import { controllableEventSource, directory, mount, json } from "./sync-fixture"

describe("tui sync", () => {
  test("refresh scopes sessions by default and lists project sessions when disabled", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const { app, kv, sync, session } = await mount()

    try {
      expect(kv.get("session_directory_filter_enabled", true)).toBe(true)
      expect(session.at(-1)?.searchParams.get("scope")).toBeNull()
      expect(session.at(-1)?.searchParams.get("path")).toBe("packages/opencode")

      kv.set("session_directory_filter_enabled", false)
      await sync.session.refresh()

      expect(session.at(-1)?.searchParams.get("scope")).toBe("project")
      expect(session.at(-1)?.searchParams.get("path")).toBeNull()
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("session.created respects the active directory filter", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const events = controllableEventSource()
    const { app, sync } = await mount(undefined, events.source)

    try {
      const base = {
        directory,
        title: "created",
        summary: {},
        version: "x",
        time: { created: 1, updated: 1 },
      }

      events.dispatch({
        payload: {
          type: "session.created",
          properties: {
            info: { ...base, id: "ses_outside", path: "packages/other" },
          },
        } as never,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(sync.session.get("ses_outside")).toBeUndefined()

      events.dispatch({
        payload: {
          type: "session.created",
          properties: {
            info: { ...base, id: "ses_inside", path: "packages/opencode/subdir" },
          },
        } as never,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(sync.session.get("ses_inside")?.id).toBe("ses_inside")
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })

  test("session.next.updated with partial info (no id) merges into the existing session entry", async () => {
    const previous = Global.Path.state
    await using tmp = await tmpdir()
    Global.Path.state = tmp.path
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    const events = controllableEventSource()
    const sessionID = "ses_seed1"
    const base = {
      id: sessionID,
      directory: "packages/opencode",
      title: "t",
      summary: {},
      version: "x",
      time: { created: 1, updated: 1 },
    }
    // Serve a seeded session so the store has an existing entry (id present).
    const { app, sync } = await mount((url) => {
      if (url.pathname === "/api/session") return json({ items: [base] })
      if (url.pathname === `/api/session/${sessionID}`) return json(base)
      return undefined
    }, events.source)

    try {
      // Wait for bootstrap to seed the session list.
      await new Promise((r) => setTimeout(r, 50))
      expect(sync.session.get(sessionID)?.id).toBe(sessionID)

      // The server emits partial patches (no id) for updates, e.g. setRevert.
      events.dispatch({
        directory,
        payload: {
          type: "session.next.updated",
          properties: {
            sessionID,
            info: {
              summary: { additions: 3, deletions: 1, files: 2 },
              revert: { messageID: "msg_9", diff: "d" },
              time: { updated: 2 },
            },
          },
        } as never,
      })
      await new Promise((r) => setTimeout(r, 50))

      const updated = sync.session.get(sessionID)
      expect(updated?.id).toBe(sessionID)
      expect(updated?.revert?.messageID).toBe("msg_9")
      expect(updated?.title).toBe("t") // unrelated fields preserved
      expect(updated?.time).toEqual({ created: 1, updated: 2 })

      events.dispatch({
        directory,
        payload: {
          type: "session.next.updated",
          properties: {
            sessionID: "ses_unknown",
            info: { title: "partial only" },
          },
        } as never,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(sync.data.session).toHaveLength(1)

      events.dispatch({
        directory,
        payload: {
          type: "session.next.updated",
          properties: {
            sessionID,
            info: { time: { archived: 3 } },
          },
        } as never,
      })
      await new Promise((r) => setTimeout(r, 50))
      expect(sync.session.get(sessionID)).toBeUndefined()
    } finally {
      app.renderer.destroy()
      Global.Path.state = previous
    }
  })
})
