import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SessionStatus } from "../../src/session/status"
import { AppRuntime } from "../../src/effect/app-runtime"
import { WithInstance } from "../../src/project/with-instance"
import { SessionID } from "../../src/session/schema"
import { withTimeout } from "../../src/util/timeout"
import { tmpdir } from "../fixture/fixture"

// Deterministic tests for the SessionStatus waitIdle latch (v2 wait lost-wakeup fix).
// The latch must never lose a wakeup regardless of interleaving: set(idle)
// opens registered waiters before clearing the in-memory status, and waitIdle
// registers its waiter before the status re-check.

const sessionID = SessionID.make("ses_status_test")

describe("session status waitIdle", () => {
  test("returns immediately when already idle", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const svc = await AppRuntime.runPromise(SessionStatus.Service.use((svc) => Effect.succeed(svc)))
        await AppRuntime.runPromise(svc.waitIdle(sessionID))
        expect(true).toBe(true)
      },
    })
  })

  test("resolves when set(idle) races the registration", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const svc = await AppRuntime.runPromise(SessionStatus.Service.use((s) => Effect.succeed(s)))
        await AppRuntime.runPromise(svc.set(sessionID, { type: "busy" }))
        const waited = AppRuntime.runPromise(svc.waitIdle(sessionID))
        // Deterministic interleave: the Idle transition happens while the
        // waiter is already registered and parked on the Deferred.
        await new Promise((resolve) => setTimeout(resolve, 50))
        await AppRuntime.runPromise(svc.set(sessionID, { type: "idle" }))
        await withTimeout(waited, 2_000, "waitIdle must resolve on set(idle)")
        expect((await AppRuntime.runPromise(svc.get(sessionID))).type).toBe("idle")
      },
    })
  })

  test("opens every concurrently-registered waiter", async () => {
    await using tmp = await tmpdir()
    await WithInstance.provide({
      directory: tmp.path,
      fn: async () => {
        const svc = await AppRuntime.runPromise(SessionStatus.Service.use((s) => Effect.succeed(s)))
        await AppRuntime.runPromise(svc.set(sessionID, { type: "busy" }))
        const first = AppRuntime.runPromise(svc.waitIdle(sessionID))
        const second = AppRuntime.runPromise(svc.waitIdle(sessionID))
        await new Promise((resolve) => setTimeout(resolve, 50))
        await AppRuntime.runPromise(svc.set(sessionID, { type: "idle" }))
        await withTimeout(Promise.all([first, second]), 2_000, "all waiters must resolve on set(idle)")
      },
    })
  })
})
