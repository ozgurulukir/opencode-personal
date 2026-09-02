# Nested (depth 2+) Subagent Permission Ask Hangs in TUI

## Goal

Fix the bug where a subagent at depth 2+ (grandchild / deeper) whose `bash`/`shell` tool invokes
`Permission.ask` hangs forever because the `ask` is never surfaced in the TUI. The permission
request is `Deferred.await`'d with no timeout, and because `handleSubtask` runs nested subagent
loops **synchronously** inside the parent loop, a grandchild's hung ask blocks the whole session —
the UI appears frozen.

Three fixes are planned (TUI recursive aggregation, remove the parentID guard, `ask` timeout as
defense-in-depth), plus one investigation (whether non-TUI `opencode run` and the web/app UI share
the same flat one-level aggregation bug).

Root cause was already fully verified; this plan does not re-derive it. All file:line anchors were
re-verified against the tree on 2026-08-13.

---

## Background — verified root cause

- **`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:164-179`** — TUI aggregation:

  ```ts
  const children = createMemo(() => {
    const parentID = session()?.parentID ?? session()?.id
    return sync.data.session
      .filter((x) => x.parentID === parentID || x.id === parentID)
      .toSorted(...)
  })
  const permissions = createMemo(() => {
    if (session()?.parentID) return []                       // hides when viewing any subagent
    return children().flatMap((x) => sync.data.permission[x.id] ?? [])   // root + DIRECT children only
  })
  const questions = createMemo(() => { ...same as permissions... })
  ```

  `children()` only captures the **current** session plus its **direct** children. A depth-2 subagent
  (parent = a subagent) is excluded, so its asks (stored under its own `sessionID`) are never read.

- **`packages/opencode/src/permission/index.ts:221-229`** — the hang:

  ```ts
  const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
  pending.set(id, { info, deferred })
  yield* bus.publish(Event.Asked, info)
  return yield* Effect.ensuring(
    Deferred.await(deferred),        // NO timeout — only resolves on reply()
    Effect.sync(() => { pending.delete(id) }),
  )
  ```

- **`packages/opencode/src/tool/shell/execute.ts:397-408`** — `ask(ctx, scan)` at line 404 gates the
  shell command; `run()` at line 408 launches after. The hang occurs at `ask`, before launch.

- **`packages/opencode/src/session/loop/subtask.ts:38-138`** — `handleSubtask` executes the child
  agent's `task` tool (line 113) synchronously inside the parent loop; the nested subagent's own
  loop runs its own `Permission.ask` with the grandchild's `sessionID`, whose deferred never resolves
  because the TUI never shows it.

- The TUI **store** (`packages/opencode/src/cli/cmd/tui/context/sync.tsx:114-134`) correctly stores
  every ask under `store.permission[request.sessionID]` regardless of depth — the data is present;
  only the aggregation in `index.tsx` drops it.

---

## Steps

### Step 1 — TUI: recursive permission/question aggregation (the fix for the hang)

**What.** Replace the direct-children-only aggregation in
`packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:164-179` with a recursive traversal of the
full descendant subtree belonging to the currently-viewed session.

Introduce a pure, extracted helper (reuse the exact BFS model already proven in the app — see
Step 4) so it can be unit-tested without mounting the renderable. Mirror the app's
`session-request-tree.ts` pattern.

Design:

- New file `packages/opencode/src/cli/cmd/tui/util/session-tree.ts` exporting a pure function
  (matches the repo's `.shared.ts`-style "pure function, no IO, no render" convention):

  ```ts
  /**
   * Collects the session ID of the root plus every descendant reachable through the
   * `parentID` chain (any depth, cycle-safe via a `seen` set).
   * Mirrors packages/app/src/pages/session/composer/session-request-tree.ts.
   */
  export function collectSessionDescendants(
    sessions: ReadonlyArray<{ id: string; parentID?: string | null }>,
    rootID: string,
  ): Set<string>
  ```

  BFS over a `parentID → [children]` adjacency map, seeded with `{ rootID }`, walking until no
  unseen children remain. **Treat any falsy `parentID` (`""`, `null`, `undefined`) as "not a
  child"** — match the app's reference impl (`session-request-tree.ts:12`, `if (!item.parentID)`),
  so root sessions and the well-known `parentID = ""` sentinel are never linked to a parent. A
  `seen` set makes it cycle-safe (a `parentID` loop terminates).

**Keep the existing `children` memo (line 165-170) intact.** It powers subagent tab navigation
between **direct** children via `moveFirstChild()`/`moveChild()` (`index.tsx:388,389,399,401`) — for
a root session its direct children are the navigation targets. Its direct-children semantics are
**correct for navigation** and must not change. Only the two aggregation memos get the recursive
treatment:

- In `index.tsx`, update the `permissions`/`questions` memos (lines 172-179) to walk the full
  descendant subtree of the currently-viewed session via a new `sessionIDs` memo:

  ```ts
  const sessionIDs = createMemo(() => {
    const root = session()?.id
    return root ? collectSessionDescendants(sync.data.session, root) : new Set<string>()
  })
  const permissions = createMemo(() =>
    [...sessionIDs()].flatMap((id) => sync.data.permission[id] ?? []),
  )
  const questions = createMemo(() =>
    [...sessionIDs()].flatMap((id) => sync.data.question[id] ?? []),
  )
  ```

  `collectSessionDescendants` includes the root session's ID, so the currently-viewed session's
  **own** asks are included too (fixes Step 2 naturally). `children()` continues to be used by
  `moveFirstChild()`/`moveChild()` for navigation — keep it; do NOT delete it as dead code.
  A cursory grep shows `children` referenced at `index.tsx:388,389,399,401` in the
  `moveFirstChild`/`moveChild` handlers (verified during review), in addition to the usages in the
  rewritten `permissions`/`questions` memos.

**Why.** The grandchild's ask is guaranteed to be surfaced once the aggregation walks the whole
`parentID` chain, so `Deferred.await` resolves and the nested loop (and the whole session) unblocks.

**Files.**
- `packages/opencode/src/cli/cmd/tui/util/session-tree.ts` (new)
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

### Step 2 — TUI: remove the `if (session()?.parentID) return []` guard

**What.** Delete the two one-line guards at `index.tsx:173` and `:177` that return `[]` whenever the
viewed session has a parent.

**Why.** With Step 1's `collectSessionDescendants`, the viewed session's ID is already included, so
its own pending ask must be shown even when the user is viewing a subagent. Guards would silently
re-hide a nested session's own request.

**Detail / trade-off.** `permissions()/questions()` feed the `PermissionPrompt`/`QuestionPrompt` at
`index.tsx:1232-1237`, which render whenever non-empty — independent of `visible`. So a nested
session being viewed will now display its own pending prompt. Leave `visible()` at line 180
(`!session()?.parentID && ...`) unchanged: it gates the composer `Prompt` input (we do not want to
let the user send a new message into a subagent session), and cancelling/rejecting the prompt works
through the existing keybind regardless of `visible`. Do **not** touch `disabled()` at line 181 —
it correctly blocks input while a prompt is pending.

**Files.**
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`

### Step 3 — Permission `ask` timeout (defense-in-depth, shared path)

**What.** Add a timeout to the `ask` wait in `packages/opencode/src/permission/index.ts` so a
never-surfaced / never-replied prompt fails with a clear **timed-out** error instead of hanging
forever. This protects unrelated surfaces and regressions (e.g., a future nested ask the UI misses,
a headless run, a crashed UI client).

**Design.**

1. **New typed error.** Add alongside `RejectedError`/`CorrectedError`/`DeniedError` (lines 89-113):

   ```ts
   export class TimedOutError extends Schema.TaggedErrorClass<TimedOutError>()("PermissionTimedOutError", {
     timeoutMs: Schema.Number,
   }) {
     override get message() {
       return `Permission prompt timed out after ${this.timeoutMs}ms and was rejected.`
     }
   }
   ```

2. **Extend the error union + interface** (lines 113, 133):
   - `export type Error = DeniedError | RejectedError | CorrectedError | TimedOutError`
   - `readonly ask: (input: AskInput) => Effect.Effect<void, Error>`

3. **Widen the deferred error channel** (lines 138-141):
   - `PendingEntry.deferred: Deferred.Deferred<void, RejectedError | CorrectedError | TimedOutError>`

4. **Race `Deferred.await` against a timer.** Replace lines 221-229 with:

   ```ts
   const timeout = timeoutMs ?? PERMISSION_ASK_TIMEOUT_MS
   const deferred = yield* Deferred.make<void, RejectedError | CorrectedError | TimedOutError>()
   pending.set(id, { info, deferred })
   yield* bus.publish(Event.Asked, info)
   return yield* Effect.ensuring(
     Effect.raceFirst(
       Deferred.await(deferred),
       Effect.gen(function* () {
         yield* Clock.sleep(Duration.millis(timeout))
         // Broadcast a synthetic "reject" so the TUI/run/web stores remove the stale prompt.
         yield* bus.publish(Event.Replied, { sessionID: info.sessionID, requestID: id, reply: "reject" })
         return yield* Effect.fail(new TimedOutError({ timeoutMs: timeout }))
       }),
     ),
     Effect.sync(() => { pending.delete(id) }),
   )
   ```

   **Must use `Effect.raceFirst`, NOT `Effect.race`.** `Effect.race` returns the first effect to
   **succeed** — a failing branch is ignored and it keeps waiting on the other. Because the timeout
   branch ends in `Effect.fail(...)`, `Effect.race` would keep waiting on `Deferred.await(deferred)`
   forever, i.e. the hang persists. `Effect.raceFirst` returns whichever branch **completes first**
   (success OR failure), so the `TimedOutError` propagates once the timer fires. Existing precedent
   in the repo: `packages/opencode/src/file/ripgrep.ts:221-223` races an effect against
   `waitForAbort(signal)` with `effect.pipe(Effect.raceFirst(waitForAbort(signal)))`.

   **Destructure `timeoutMs` OUT of `input` (data-leak guard).** The `ask` entrypoint already does
   `const { ruleset, ...request } = input` (line 191). Add the new field to that destructuring:
   `const { ruleset, timeoutMs, ...request } = input`, then read the timeout from the local:
   `const timeout = timeoutMs ?? PERMISSION_ASK_TIMEOUT_MS`. `request` is later spread into
   `info` via `Schema.decodeUnknownSync(Request)({ id, ...request })` and then published as
   `Event.Asked` (line 223). `Schema.Struct`-decoded `Request` does NOT strip unknown fields here,
   so leaving `timeoutMs` in `request` would leak it into the published `Event.Asked` payload. The
   explicit destructure keeps `AskInput`'s control field out of the wire payload.
   (Re-verified: `permission/index.ts:191` is the `const { ruleset, ...request } = input` line.)

   **Alternative (idiomatic): `Effect.timeout` — weigh before finalizing.** The codebase uses
   `Effect.timeout` as the standard primitive in 8 places, e.g. `processor.ts:681`
   (`Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore)`). An equivalent
   formulation:
   ```ts
   Deferred.await(deferred).pipe(
     Effect.timeout(Duration.millis(timeout)),
     Effect.catchTag("TimeoutException", () =>
       bus.publish(Event.Replied, { sessionID: info.sessionID, requestID: id, reply: "reject" })
         .pipe(Effect.andThen(Effect.fail(new TimedOutError({ timeoutMs: timeout })))),
     ),
   )
   ```
   This is more idiomatic but (a) `Effect.timeout` **interrupts** the inner `Deferred.await`, and
   (b) requires catching `TimeoutException` to do the store-clearing publish + typed fail. The
   `raceFirst` + `Clock.sleep` + explicit `Effect.fail` version keeps the timeout branch visible and
   lets the inner `Deferred.await` remain uninterruptible (the pending map cleanup is driven by the
   outer `Effect.ensuring` in both cases). Either is correct once the primitive is `raceFirst`/the
   catch-all is `Timeout`. Recommendation: prefer the `raceFirst`/`Clock.sleep` form for clarity and
   because it does not interrupt the await that the `ensuring` finalizer also observes; if a reviewer
   prefers `Effect.timeout` for consistency, adopt the `catchTag("TimeoutException")` form exactly as
   shown. Both must publish `Event.Replied(reject)` before propagating `TimedOutError`.

   Add module const `PERMISSION_ASK_TIMEOUT_MS = 5 * 60_000` and an optional `timeoutMs` field on
   `AskInput` (via `Schema.optional` in the existing `AskInput = Schema.Struct({...})` at line 115-119)
   so callers can override. Keep the default generous — a real user may legitimately take a while to
   answer; this is purely a hang/safety net.

5. **Update the module's result type / imports.** Import `Clock`, `Duration` from `"effect"` (line 14).

**Why a synthetic `Event.Replied(reject)` on timeout.** The TUI store (`context/sync.tsx:99-112`)
only removes a prompt upon `permission.replied`; the run transport clears blockers on
`permission.replied`/`question.replied` (`stream.transport.ts:465-475`). Broadcasting reject on
timeout reuses the exact store-clearing path, so the prompt disappears everywhere and the deferred
fails with the typed `TimedOutError`. This is the same mechanism `reply("reject")` already uses.

**How the error reaches the caller.**
- Non-shell tools call the shared `Permission.ask` through `Tool.Context.ask`/`permission.ask`
  (see subtask.ts:130-137 wrapping in `Effect.orDie`; execute.ts:404). The timed-out `Effect.fail`
  propagates up; `handleSubtask`'s `Effect.catchCause` (subtask.ts:140-145) squashes it into a
  normal tool error and the parent loop continues — no hang. The shell tool's `ask` at execute.ts:404
  returns the error before `run()` is reached, so the command is never launched.

**Scrutiny — all callers.** `Permission.ask` is the single shared gate used by shell
(`execute.ts:404`) and non-shell tools (`read`/`grep`/`glob`/`webfetch`/`websearch`/`edit`/`write`/
`apply_patch`/`task`). Because the timeout is centralized in the service, every consumer inherits
the safety net. The only behavioral change for healthy flows: a prompt left unanswered >5min now
fails with `TimedOutError` instead of blocking forever. Existing `next.test.ts` reply/reject tests
finish within the timeout and are unaffected. This is the riskiest change (shared path) — hence the
mandatory characterization coverage below.

**Config / tuning decision.** Keep it a module-level constant + per-request optional override, NOT a
user config key, to avoid expanding the config schema surface. If a maintainer later wants it
configurable, add one config key in one place — note this as an open question.

**Files.**
- `packages/opencode/src/permission/index.ts`

### Step 4 — Investigate non-TUI `run` + web/app aggregation (report, fix only if broken)

**Findings (evidence from tree, 2026-08-13):**

- **`packages/app` — NOT broken.** `packages/app/src/pages/session/composer/session-request-tree.ts:11-34`
  (`sessionTreeRequest`) already does the recursive descendant walk we are adding to the TUI: it
  builds a `parentID → [children]` map, BFS-seeds with the current `sessionID`, and returns the first
  matching permission/question in the subtree. Used by `sessionPermissionRequest`/`sessionQuestionRequest`
  (lines 36-52) and the composer region (`session-composer-region.tsx`), which shows the dock for
  `props.state.permissionRequest()`. **No fix needed** here — it is the reference implementation to mirror.

- **`packages/opencode/src/cli/cmd/run` (non-TUI `opencode run`) — appears fine; add a verification.**
  It does NOT use the flat direct-children pattern. It tracks subagents in a `tabs`/`details` map
  (`subagent-data.ts`): `syncTaskTab` (lines 316-339) registers a tab for **any** `task` part whose
  `sessionId`/`sessionID` metadata key is present (`taskSessionID`, lines 312-314) — i.e., every
  subagent at any depth registers a tab, because each nested subagent executes a `task` part carrying
  its child `sessionID`. `listSubagentPermissions` (588-590) / `listSubagentQuestions` (592-594)
  flatten across **all** `details` (all tabs, any depth), and `snapshotSubagentData` (636-641)
  publishes the aggregate. `pickView` (285-288) + `trackBlocker` (453-463) seed blockers for the main
  `sessionID` **or any known tab** (`stream.transport.ts:458`). So nested asks reach the aggregate.

  **Verification step (do not skip):** confirm in a manual run that a depth-3 subagent's
  `bash` permission produces a `task` part with `sessionId` metadata, and that
  `event.properties.sessionID` for the permission matches a known tab so `trackBlocker` seeds it
  (otherwise the run path would be silent for depth-3). If that edge is ever missed, the Step-3
  timeout now guarantees run can't hang either. No code fix planned unless verification exposes a gap.

- **TUI** — the one surface actually broken (Steps 1-2).

**`questions` symmetry.** The `questions` memo (index.tsx:176-179) and the app's
`sessionQuestionRequest` / run's `listSubagentQuestions` all mirror their permission counterparts.
Our Step 1 applies the same recursive treatment to both `permissions` and `questions`, so symmetry
is preserved in the TUI. No separate questions-only fix is required.

---

## Test strategy (repo Rule 3: characterization first, where behavior changes)

There is **no existing component test** for the TUI `Session` renderable (it is a ~2300-line
OpenTUI renderable, not unit-testable in isolation). Per Rule 3, keep the change testable by
putting the new logic in a pure helper and testing that rather than the renderable.

1. **New: `packages/opencode/test/cli/cmd/tui/session-tree.test.ts`** — characterization/unit tests
   for `collectSessionDescendants`:
   - depth-0 (root alone), depth-1 (root + direct children), depth-2 (grandchild), depth-3+
   - a sibling sub-tree that is NOT a descendant is excluded
   - the viewed session is itself a subagent (its own ID is included)
   - cycle safety (`parentID` loops terminate), any falsy `parentID` (`""` / `null` / `undefined`)
     is ignored — mirror `session-request-tree.ts:12` (`if (!item.parentID)`)
   - deduplication across a diamond-shaped graph
   - **navigation preserved:** `children()` (kept for `moveFirstChild`/`moveChild`) still returns
     exactly the direct children of the root — assert its direct-children semantics unchanged so the
     `permissions`/`questions` rewrite cannot silently alter tab navigation

2. **Extend `packages/opencode/test/permission/next.test.ts`** — permission `ask` timeout behavior
   (uses `testEffect` + `TestClock`; see existing `waitForPending`/`yieldNow` patterns in that file):
   - `ask` resolves normally when a reply arrives before the timeout (existing behavior, no regression)
   - `ask` **fails with `TimedOutError`** after `TestClock.advance(past timeout)` with no reply —
     this asserts the `raceFirst` semantics: the failing timeout branch completes and wins, so the
     `TimedOutError` propagates (a naive `Effect.race` would hang here and the test would time out)
   - after timeout the `pending` entry is removed (`list()` is empty) and an `Event.Replied`
     (reply: `"reject"`) is published with the correct `requestID`
   - `input.timeoutMs` override respected (short override times out fast; long override waits)

   Follow the file's `waitForPending(N)` + `Effect.yieldNow` pattern and the
   `mock.restore()`/`afterEach` hygiene from `test/AGENTS.md` to avoid the documented
   `ScopedCache` cross-test leakage (run `bun test test/permission/ -t "always"` after to confirm no
   regression, per `permission/AGENTS.md`).

3. **Regression run.** From `packages/opencode`: `bun typecheck` and the full permission + CLI-run
   test suites. Note the repo's known order-dependent failures (`permission/next.test.ts:78`
   "reject cancels all pending for same session" is a documented pre-existing flake); new timeout
   tests should use `TestClock` and not share state with that one.

4. **No `as any`.** The new error union and deferred widening must compile cleanly; verify with
   `bun typecheck` from `packages/opencode`.

---

## Architecture decisions

- **Recursive aggregation mirrors the shipped app implementation.** `packages/app` already solves
  exactly this problem with `session-request-tree.ts`. Adopting the same BFS-of-`parentID` model in
  the TUI keeps behavior consistent across surfaces and reuses a proven, tested design instead of
  inventing a parallel one. Alternative considered: per-depth `flatMap` chained via `parentID`
  (bounded to N levels) — rejected: it reintroduces a fixed-depth ceiling (the very bug) and is
  more code. Trade-off: the BFS visits every session once per memo recompute; sessions are few
  (tens), so cost is negligible.

- **Pure helper + unit-test instead of renderable test.** The TUI `Session` component is not
  unit-testable; extracting `collectSessionDescendants` satisfies Rule 3 (behavior locked by tests
  before/with the refactor) without a heavyweight component harness.

- **Timeout as defense-in-depth, not the primary fix.** The primary fix is Steps 1-2 (surface the
  ask). The timeout is a safety net for any future surface that misses an ask, and it converts a
  permanent hang into a typed, surfaced error for other (non-TUI) paths. Alternatives considered:
  (a) no timeout — rejected, keeps the hang class alive; (b) a hang watchdog that auto-replies
  "allow once" — rejected: silently granting a command is a security regression; timing out as a
  **reject** is the safe default (least privilege). The timer uses `Effect.raceFirst` (first branch
  to complete, success or failure) so the failing `TimedOutError` branch actually wins; `Effect.race`
  would be a no-op for a failing branch and is explicitly rejected here. Precedent: `ripgrep.ts:222`.

- **Per-request override via `AskInput.timeoutMs`, not config.** Keeps the riskiest shared change
  self-contained and does not expand the config schema. Adjusting the default later is a one-line
  constant change. `timeoutMs` is destructured out of `input` alongside `ruleset` so it never leaks
  into the `Event.Asked` payload.

- **Keep the `children` memo for navigation (no unrelated refactor).** `children()` is a separate
  concern from aggregation — it drives `moveFirstChild`/`moveChild` subagent tab navigation
  (`index.tsx:388,389,399,401`). Its direct-children semantics are correct there, so the fix leaves
  it untouched and only rewrites the `permissions`/`questions` memos. This keeps the change narrowly
  scoped to the bug (surface nested asks) and avoids breaking navigation.

---

## Open questions

1. **Timeout default (currently `5 * 60_000` ms).** Reasonable? Should non-interactive surfaces
   (headless `opencode run -p`, plugins) use a shorter value / `timeoutMs: 0` = never timeout?
   (A: keep generous default; revisit if a caller is identified that wants no timeout.)

2. **Nested-subagent context in the TUI prompt.** After Step 1, a grandchild's ask is shown even
   though its request context (message text) lives in the grandchild session's message stream, which
   is not visible when viewing the root session. Should the permission prompt also surface the
   originating subagent (e.g., a "from subagent S2" label)? Out of scope for this bug (blocking hang
   is fixed), but worth a follow-up.

3. **Run-path depth-3 verification** (Step 4) may reveal that nested subagent `task` parts do not
   always carry `sessionId` metadata at depth 3+, which would make `run` silently miss those asks.
   The Step-3 timeout now prevents a hang either way, but if the verification fails we should file a
   follow-up to seed blockers from metadata regardless of tab membership.

4. **Whether `TimedOutError` needs to be added to the SDK generated `Event`/error unions.**
   `Event.Replied` already exists in the SDK; the new error type is only used server-internally and
   serialized into tool output, so no SDK regen is expected. Confirm during implementation (root
   AGENTS: regenerate SDK only when bus `Event` union changes).

---

## Summary of files touched

| File | Change |
|------|--------|
| `packages/opencode/src/cli/cmd/tui/util/session-tree.ts` | **new** — pure `collectSessionDescendants` |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | Steps 1-2 — recursive aggregation in `permissions`/`questions` memos; remove `if parentID return []` guards; `children` memo kept for navigation |
| `packages/opencode/src/permission/index.ts` | Step 3 — `TimedOutError`, widen union/deferred, `raceFirst` timeout, destructure `timeoutMs`, `PERMISSION_ASK_TIMEOUT_MS`, optional `timeoutMs` on `AskInput` |
| `packages/opencode/test/cli/cmd/tui/session-tree.test.ts` | **new** — `collectSessionDescendants` unit tests |
| `packages/opencode/test/permission/next.test.ts` | extends — `ask` timeout characterization tests |
| (`packages/opencode/src/cli/cmd/run/...`) | **no change unless** Step-4 verification exposes a depth-3 gap |
| `packages/app/src/pages/session/composer/session-request-tree.ts` | **no change** — already recursive (reference impl) |