# Regression Test: `-c` dummy sessionID fix (commit `bece62b`)

Date: 2026-09-24 · Status: DRAFT (research only — no code written)
Supersedes the "no regression test" conclusion of `_plan/continue-dummy-sessionid-2026-09-24.md` (line 216) — a feasible guard was found this session.

## Goal

Add a regression test that **fails on the pre-`bece62b` behavior** and **passes on the fixed behavior**, guarding two invariants:

1. **R1 — no fabricated boot route:** `app.tsx` must never pass a fabricated `initialRoute` (e.g. `{ type: "session", sessionID: "dummy" }`) to `RouteProvider` for `--continue`. The old code mounted the Session route immediately and issued `sdk.client.v2.session.get({ sessionID: "dummy" })`, which the server rejects (`SessionID` = `Schema.isStartsWith("ses")` → `Expected a string starting with "ses", got "dummy" at ["sessionID"]`).
2. **R2 — Home `-p` guard:** `home.tsx`'s auto-submit effect must not submit `args.prompt` while `args.continue` is navigating (guard added at `home.tsx:56`).

## Verified anchors (read this session, post-fix tree)

| Anchor | Location | Notes |
|---|---|---|
| Bare `RouteProvider` | `packages/opencode/src/cli/cmd/tui/app.tsx:200` | Post-fix: no props. Pre-fix passed `initialRoute={input.args.continue ? { type: "session", sessionID: "dummy" } : undefined}` (removed by `bece62b`). |
| Continue effect | `app.tsx:373-394` | Picks latest parentless session (`toSorted` by `time.updated` desc → `find(x => x.parentID === undefined)`), forks when `args.fork`, else navigates. **Byte-identical pre/post fix** — the fix touched only `initialRoute` + the Home guard. |
| Home auto-submit effect | `packages/opencode/src/cli/cmd/tui/routes/home.tsx:50-60` | `r.submit()` at line 59; the `if (args.continue) return` guard at **line 56** (added by `bece62b`). |
| `-c` option | `packages/opencode/src/cli/cmd/tui/thread.ts:93-97` | `option("continue", { alias: ["c"], type: "boolean" })`; forwarded into `tui()` at `thread.ts:243-250` (`continue: args.continue`). No session fabrication here. |
| `SessionID` schema | `packages/opencode/src/session/schema.ts:7-12` | `Schema.String.check(Schema.isStartsWith("ses")).pipe(Schema.brand("SessionID"), ...)` — why `"dummy"` 400s. |
| `RouteProvider` init | `packages/opencode/src/cli/cmd/tui/context/route.tsx:24-34` | `init: (props: { initialRoute?: Route })`; default `{ type: "home" }` or `OPENCODE_ROUTE` env. Post-fix, `initialRoute` appears **only** in this file (grep-verified). |
| Fix commit | `git show bece62b` | 2 files: removes the `initialRoute` prop block in `app.tsx` (-10/+1), adds the `args.continue` guard in `home.tsx` (+1). No later commits touch these files (`git log bece62b..HEAD -- <files>` empty) → clean revert possible for fail-verification. |
| Guard-test precedent | `packages/opencode/test/_hygiene/mock-restore.guard.test.ts` | Existing repo convention: a bun test that reads source files and regex-asserts invariants (mock.module restore hook). Validates the source-contract approach as repo-idiomatic. |
| Mount harness scope | `packages/opencode/test/cli/cmd/tui/sync-fixture.tsx:117-155` | Mounts only `ArgsProvider > ExitProvider > KVProvider > SDKProvider > ProjectProvider > SyncProvider`. No `RouteProvider`/`ThemeProvider`/`LocalProvider`/keymap/plugin runtime → `App` and `Home` are **not** mountable here without disproportionate refactoring (confirms prior plan's finding). |
| `LocalProvider` deps | `packages/opencode/src/cli/cmd/tui/context/local.tsx:24-50` | Requires `useTheme` (renderer palette) — mounting real `Home` pulls in the full theme/renderer stack. |
| Test runner | `packages/opencode/package.json` → `"test": "bun test --timeout 30000"`; `bunfig.toml` test preload = `@opentui/solid/preload` + `./test/preload.ts` | Tests run from `packages/opencode`, **never repo root** (root guard). Pure `.test.ts` files run fine under this preload (see `context-usage.shared.test.ts`). |

## Chosen approach

**Source-contract regression guard** (hygiene-pattern) — one new test file, two tests:

**File:** `packages/opencode/test/cli/cmd/tui/continue-boot.guard.test.ts` (plain `.test.ts`, no JSX, no imports of app code)

```ts
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
  })

  test("home.tsx auto-submit effect keeps the --continue guard before submit", async () => {
    const src = await Bun.file(HOME).text()
    const submit = src.indexOf("r.submit()")
    expect(submit).toBeGreaterThan(-1) // anchor sanity
    const effectStart = src.lastIndexOf("createEffect(", submit)
    const guard = src.indexOf("args.continue", effectStart)
    // R2: the guard must exist inside the auto-submit effect, before r.submit().
    expect(guard).toBeGreaterThan(effectStart)
    expect(guard).toBeLessThan(submit)
  })
})
```

### Why this is the best feasible test

- **Discriminates the fix (the hard requirement).** Reverting `bece62b` makes both tests fail: `app.tsx` again contains `initialRoute` (R1), and the auto-submit effect no longer references `args.continue` before `r.submit()` (R2 → `guard === -1`). No pure-function test can do this, because the continue-selection logic was **unchanged** by the fix (see rejected alternatives).
- **Repo-idiomatic.** `_hygiene/mock-restore.guard.test.ts` already scans source with regex as a regression guard; this follows the same pattern, placed next to the TUI tests it guards (feature-specific, unlike `_hygiene` which is test-infra hygiene).
- **Zero mocks, zero `any`, deterministic, milliseconds-fast.** Satisfies "do not add mocks of code we own".
- **Anchor sanity asserts** (`RouteProvider` present, `r.submit()` present) make refactor drift fail loudly with a "re-verify this guard" signal instead of silently passing.

### Accepted trade-off (stated explicitly)

The test is **textual, not behavioral**: it pins source invariants, not runtime behavior. It is brittle to refactors of `app.tsx`/`home.tsx` (rename of `RouteProvider`, restructuring the effect, renaming `args.continue`) — but every such refactor *should* trip a conscious re-verification of these invariants, and the failure messages point the developer at the why-comment. Given that mounting `App`/`Home` is confirmed infeasible without a provider-stack refactor (out of proportion for a regression guard), this is the right cost/benefit. It is acceptable per repo conventions because of the `_hygiene` precedent.

## Architecture Decisions — alternatives investigated and rejected

1. **Mount the real `App` (behavioral test of boot route).** Rejected. `App` (`app.tsx:246-933`) requires `TuiPluginRuntime.init`, `OpencodeKeymapProvider`, `ThemeProvider` (renderer palette via `createCliRenderer`), `LocalProvider` → `useTheme` (`local.tsx:50`), dialog/command-palette/frecency/prompt-history/prompt-ref/editor providers — 12+ providers plus plugin loading. The existing harness (`sync-fixture.tsx`) mounts none of these. Disproportionate; matches the prior plan's finding.
2. **Mount the real `Home` (behavioral test of R2).** Rejected. Needs `RouteProvider` + `LocalProvider` (→ `ThemeProvider` → renderer palette) + `TuiPluginRuntime.Slot` + the full `Prompt` component (textarea/keymap). Also a negative assertion ("nothing submitted") with readiness gating (`sync.ready && local.model.ready`) — timing-flaky.
3. **Extract continue-selection into a pure `.shared.ts` helper + unit tests.** Rejected **as the regression test** (kept as a noted future option). The selection logic (`app.tsx:373-394`) is byte-identical pre/post fix — any unit test of it passes on both versions, so it cannot fail on the old behavior. It also never produced the `"dummy"` id (ids come from server sync data); the bug was solely the `initialRoute` prop. If the selection logic ever grows, do Rule-3 characterization first and extract `latestParentlessSession(sessions)` then.
4. **Extract the Home auto-submit decision into a pure helper + characterization tests.** Rejected **as the regression test**. Post-fix, the extracted function would contain the `continue` guard, so its test passes even if someone reverts the guard in `home.tsx` — the logic moves out of the file where the regression happened. (A 6-condition guard over 10 lines also fails the "keep it minimal" bar.) The source-contract test guards the actual file.
5. **Server-side `SessionID` validation test** (`SessionID` rejects `"dummy"`). Rejected. True pre- and post-fix (schema unchanged) — documents the 400 but guards nothing about the TUI regression.
6. **Pre-resolve last-session id in `thread.ts` and pass as `args.sessionID`.** Already rejected in the prior plan (crosses the worker RPC boundary for no behavioral gain); unchanged.

**Step routing:** **all steps → @coder.** No behavior-preserving restructuring is proposed (extraction rejected), so there are **no @refactor steps** and Rule-3 characterization-first is not triggered.

## Steps

1. **(@coder)** Create `packages/opencode/test/cli/cmd/tui/continue-boot.guard.test.ts` with the exact source above. Why: the regression guard for R1+R2. No other file is touched.
2. **(@coder)** Run the new test on HEAD — expect **2 passes** (see Run & verify below).
3. **(@coder)** Verify it fails on the pre-fix behavior by temporarily reverting `bece62b` (procedure below), then restore. Why: proves the test discriminates; skip only if the revert is blocked by unrelated WIP.
4. **(@coder)** Run `bun typecheck` from `packages/opencode` (plain TS test, no app imports — should be clean) and `bun run lint` from repo root.

## Run & verify

```powershell
# From packages/opencode (never repo root):
cd packages/opencode
bun test test/cli/cmd/tui/continue-boot.guard.test.ts        # → 2 pass

# Prove it fails on the old behavior (no later commits touch these files — verified):
git revert --no-commit bece62b
bun test test/cli/cmd/tui/continue-boot.guard.test.ts        # → 2 fail (expected):
#   test 1: app.tsx contains "initialRoute" again
#   test 2: guard === -1  (no args.continue inside the auto-submit effect)
git revert --abort                                            # restore HEAD
bun test test/cli/cmd/tui/continue-boot.guard.test.ts        # → 2 pass again
```

Full-suite sanity (order-dependence is a known repo issue): `bun test` from `packages/opencode` — this file reads two source files and shares no state, so it cannot leak.

## Open Questions

1. Should the guard also forbid the `OPENCODE_ROUTE` env backdoor (`route.tsx:29`) for `-c` boots? Out of scope here (debug affordance, not part of this regression) — flagged for a future hardening pass.
2. Naming bikeshed: `continue-boot.guard.test.ts` vs `continue-route.guard.test.ts` — either is fine; pick one at implementation time.
3. If the team later wants behavioral routing coverage, it requires a provider-stack test harness refactor (RouteProvider + theme/keymap/plugin stubs) — defer until App routing is next touched.
