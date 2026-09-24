import { describe, expect, test } from "bun:test"
import path from "path"

// Regression guard for bece62b: `opencode -c` used to boot the TUI with a
// fabricated RouteProvider initialRoute ({ type: "session", sessionID: "dummy" }).
// That mounted the Session route and issued session.get with an id the server
// rejects (SessionID requires the "ses" prefix — session/schema.ts), crashing
// -c with 'Expected a string starting with "ses", got "dummy"'. Mounting the
// real App in tests is not feasible (12+ providers, plugin runtime, renderer
// palette), so this guard asserts the source-level contract instead — same
// pattern as test/_hygiene/mock-restore.guard.test.ts. If this test fails
// after a refactor, re-verify the invariants consciously: they are what keep
// -c from crashing and Home from auto-submitting -p mid-navigation.

const APP = path.resolve(import.meta.dir, "../../../../src/cli/cmd/tui/app.tsx")
const HOME = path.resolve(import.meta.dir, "../../../../src/cli/cmd/tui/routes/home.tsx")

describe("-c continue boot guard", () => {
  test("app.tsx does not fabricate an initialRoute session for --continue", async () => {
    const src = await Bun.file(APP).text()
    // Anchor sanity: if this fails, app.tsx moved/renamed — re-verify the guard.
    expect(src).toContain("RouteProvider")
    // R1: any initialRoute here reintroduces the fabricated-boot-route class of bug.
    expect(src).not.toContain("initialRoute")
    // R1 (strengthened): no fabricated/dummy session id may appear in TUI boot source.
    expect(src).not.toContain("dummy")
  })

  test("home.tsx auto-submit effect keeps the --continue guard before submit", async () => {
    const src = await Bun.file(HOME).text()
    const submit = src.indexOf("r.submit()")
    expect(submit).toBeGreaterThan(-1) // anchor sanity
    const effectStart = src.lastIndexOf("createEffect(", submit)
    const effect = src.slice(effectStart, submit)
    // R2 (strengthened): the guard must live INSIDE the auto-submit effect, not elsewhere.
    expect(effect).toContain("args.continue")
    const guard = src.indexOf("args.continue", effectStart)
    // R2: the guard must exist inside the auto-submit effect, before r.submit().
    expect(guard).toBeGreaterThan(effectStart)
    expect(guard).toBeLessThan(submit)
  })
})
