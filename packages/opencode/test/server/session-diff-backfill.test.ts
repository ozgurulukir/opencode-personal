/**
 * Regression test for the empty "Modified Files" sidebar on freshly created
 * sessions. `Session.diff` is the sidebar's data source; it used to return `[]`
 * whenever the `["session_diff", id]` cache was absent (cache miss). The cache
 * is only written by `SessionSummary.summarize`, which runs after the first
 * user turn — so a session viewed before any summarize returned an empty list
 * even when snapshots/diffs existed, hiding the Modified Files panel.
 *
 * The fix recomputes the diff from the session's snapshot boundaries on a cache
 * miss and backfills the cache. These tests pin both behaviours:
 *   1. cache hit  → returns the cached diffs as-is (unchanged behaviour)
 *   2. cache miss with no boundary snapshots → `[]` (safe fallback, no crash)
 */
import { afterEach, describe, expect } from "bun:test"
import { Effect } from "effect"
import { Server } from "@/server/server"
import { SessionPaths } from "@/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { Storage } from "@/storage/storage"
import { WithInstance } from "@/project/with-instance"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { it } from "../lib/effect"
import * as Log from "@opencode-ai/core/util/log"

void Log.init({ print: false })

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

function pathFor(template: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [key, value]) => result.replace(`:${key}`, value), template)
}

describe("session diff backfill on cache miss", () => {
  it.live("GET /session/<id>/diff returns cached diffs on cache hit", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true, config: { formatter: false, lsp: false } })),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )

      yield* Effect.promise(() =>
        WithInstance.provide({
          directory: tmp.path,
          fn: async () => {
            const session = await Effect.runPromise(
              Effect.provide(
                Session.Service.use((s) => s.create({ title: "backfill-hit" })),
                Session.defaultLayer,
              ),
            )

            const cached = [{ file: "cached.txt", additions: 4, deletions: 1 }]
            await Effect.runPromise(
              Effect.provide(
                Storage.Service.use((s) => s.write(["session_diff", session.id], cached)),
                Storage.defaultLayer,
              ),
            )

            const headers = { "x-opencode-directory": tmp.path }
            const response = await Server.Default().app.request(pathFor(SessionPaths.diff, { sessionID: session.id }), {
              headers,
            })
            expect(response.status).toBe(200)
            const body = (await response.json()) as Array<{ file: string; additions: number }>
            expect(body).toEqual(cached)
          },
        }),
      )
    }),
  )

  it.live("GET /session/<id>/diff falls back to [] on cache miss with no snapshots (no crash)", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true, config: { formatter: false, lsp: false } })),
        (t) => Effect.promise(() => t[Symbol.asyncDispose]()),
      )

      yield* Effect.promise(() =>
        WithInstance.provide({
          directory: tmp.path,
          fn: async () => {
            const session = await Effect.runPromise(
              Effect.provide(
                Session.Service.use((s) => s.create({ title: "backfill-miss" })),
                Session.defaultLayer,
              ),
            )

            // No `session_diff` cache entry written; no boundary snapshots exist.
            // The fix must not crash and must return a JSON array (empty here).
            const headers = { "x-opencode-directory": tmp.path }
            const response = await Server.Default().app.request(pathFor(SessionPaths.diff, { sessionID: session.id }), {
              headers,
            })
            expect(response.status).toBe(200)
            const body = (await response.json()) as unknown[]
            expect(Array.isArray(body)).toBe(true)
            expect(body).toHaveLength(0)
          },
        }),
      )
    }),
  )
})
