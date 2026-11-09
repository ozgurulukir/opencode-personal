# Issue #379 — App shell and provider hygiene

**Branch:** `issue-379-app-shell-hygiene`
**Date:** 2026-11-08 (verified against working tree 2026-11-09)
**Supplementary:** `_plan/webui-review-findings-2026-11-08.md` — **not on disk** (glob returned nothing); plan is grounded solely in direct source reads.

## Goal

Fix four hygiene defects in `packages/app` called out by issue #379:

1. Two nested `QueryClientProvider`s in the composed tree (outer one dead).
2. Commented-out dead code blocks in `app.tsx`.
3. `ConnectionGate` health loop busy-retries with no inter-attempt sleep; `ConnectionError` runs a 1s interval even when retry is a no-op.
4. Duplicate store setters (`setBootStore` / `set`) in `global-sync.tsx` that invite drift.

All cited line anchors were **re-verified against the working tree** — they all still match.

---

## Verified evidence (anchors re-checked)

| Claim | Actual | Status |
|---|---|---|
| Outer `QueryProvider` | `app.tsx:158`–`:164` inside `AppBaseProviders` | ✅ |
| Inner `QueryProvider` | `app.tsx:310`–`:325` inside `AppInterface` | ✅ |
| Client construction | `app.tsx:85`–`:96` (`QueryClientProvider` at `:95`) | ✅ |
| Composition nest | `entry.tsx:170`–`:176` wraps `AppBaseProviders` → `AppInterface` | ✅ |
| Commented `Suspense` | `app.tsx:133` + `:136` (children at `:134`–`:135` are real) | ✅ |
| Commented `Show` | `app.tsx:208`–`:215` | ✅ |
| Stray `{/*</Show>*/}` | `app.tsx:234` | ✅ |
| `while (true)` no sleep | `app.tsx:188`–`:192` | ✅ |
| 1s interval | `app.tsx:247`–`:248` | ✅ |
| `setBootStore` | `global-sync.tsx:131`–`:137` (used only at `:147`) | ✅ |
| `set` | `global-sync.tsx:155`–`:161` (public, returned at `:439`) | ✅ |

### Which `QueryProvider` to remove — analysis

All four `useQueryClient` consumers live **inside** `AppInterface`'s inner provider:

- `context/global-sync.tsx:115` (GlobalSyncProvider — inside `:310`)
- `pages/session.tsx:327` (route under router — inside `:310`)
- `components/status-popover-body.tsx:141` (inside `:310`)
- `components/dialog-select-mcp.tsx:22` (inside `:310`)

`DialogSelectMcp` is mounted via `dialog.show(() => <DialogSelectMcp/>)` under `DialogProvider` (which sits outside the inner `QueryProvider`), yet its `useQueryClient()` at `:22` still resolves the inner client because the dialog factory transfers the caller's Solid owner/context chain — `useDialog()` captures the caller's `getOwner()` and `ctx.show` runs `runWithOwner(owner, () => createRoot(...))` in `packages/ui/src/context/dialog.tsx`, so the dialog inherits its caller's context (caller = session page, inside the inner provider).

Non-`useQueryClient` tanstack consumers (context-resolving hooks, all mounted inside the composed tree): `context/global-sync.tsx` — `useQueries` `:84`, `useQuery` `:139`, `useMutation` `:432`; `context/global-sync/child-store.ts` — `useQueries` `:179`; `pages/session.tsx` — `createQuery` `:597`, `useMutation` `:722`/`:1525`/`:1630`/`:1654`; `components/prompt-input.tsx` — `useQueries` `:1259`; `components/dialog-select-mcp.tsx` — `useMutation` `:30`; `components/dialog-select-server.tsx` — `useMutation` `:294`/`:320`; `components/dialog-edit-project.tsx` — `useMutation` `:75`; `components/dialog-custom-provider.tsx` — `useMutation` `:119`; `components/status-popover-body.tsx` — `useMutation` `:143`; `pages/session/message-timeline.tsx` — `useMutation` `:244`/`:251`/`:258`; `pages/session/composer/session-question-dock.tsx` — `useMutation` `:209`/`:221`; `pages/layout/sidebar-workspace.tsx` — `useIsFetching` `:323`/`:457`. (`queryOptions` in `global-sync.tsx:60,68` / `bootstrap.ts:87,93,172,178` is a pure option builder, not a context consumer; the `QueryClient` itself is constructed at `app.tsx:86`.)

Between the outer and inner providers nothing uses tanstack-query:

- `packages/ui` has **zero** `@tanstack/solid-query` imports → `DialogProvider`, `MarkedProvider`, `FileComponentProvider` (children of the outer provider) don't need it.
- `ServerProvider` (`context/server.tsx`) — no tanstack/query usage (grep clean).
- `ConnectionGate` / `ServerKey` — `createResource`/`Show` only.
- `ErrorPage` (ErrorBoundary fallback, outside both providers) — no tanstack usage.

Composition facts:

- Only composition in the repo: `entry.tsx:170`–`:176`. `AppBaseProviders`/`AppInterface` are re-exported from `src/index.ts`, but **no workspace package imports `@opencode-ai/app`** (grep: only `bun.lock` + own `package.json`).
- No test imports `app.tsx` or `entry.tsx`.

**Decision: remove the OUTER `QueryProvider` (`AppBaseProviders`, `app.tsx:158`/`:164`); keep the INNER one (`AppInterface`, `app.tsx:310`/`:325`).**

Rationale: the inner provider is the one every consumer resolves today; keeping it in `AppInterface` keeps that exported component self-contained. The outer provider has no consumers and is dead in the composed tree.

---

## Steps

### 0. Pre-edit impact analysis (repo rule)

Run GitNexus impact on `AppBaseProviders`, `AppInterface`, `ConnectionGate`, `ConnectionError`, `createGlobalSync` (MCP `impact` or `node .gitnexus/run.cjs impact ...`). Verify the index is fresh first (`list_repos`); per repo Notes the index may not cover this repo — if unavailable, the grep-based caller analysis in this plan is the fallback and is already complete (callers: `AppBaseProviders`/`AppInterface` → `entry.tsx` + `index.ts` only; `ConnectionGate`/`ConnectionError` → file-local; `setBootStore` → single internal use). Warn on HIGH/CRITICAL before proceeding.

### 1. Remove the outer `QueryProvider` — `packages/app/src/app.tsx`

- **What:** Delete the `<QueryProvider>` / `</QueryProvider>` wrapper at `app.tsx:158` and `:164` so `ErrorBoundary` directly wraps `DialogProvider`.
- **Why:** Outer client is dead when composed (`entry.tsx` nests `AppBaseProviders` → `AppInterface`); hooks resolve the inner one. Single client removes the wasted instance and `useQueryClient` ambiguity.
- **Keeps:** the `QueryProvider` component definition (`:85`–`:96`) and the `QueryClient`/`QueryClientProvider` import (`:13`) — still used at `:310`.
- **No change** to `entry.tsx` — its composition becomes correct automatically.

### 2. Delete dead commented code — `packages/app/src/app.tsx`

- `:133` and `:136`: delete the two commented `Suspense` lines; **keep** the real children at `:134`–`:135` (result: `RouterRoot` renders `{props.appChildren}` + `{props.children}` directly inside `AppShellProviders`).
- `:208`–`:215`: delete the entire commented `Show` block.
- `:234`: delete `{/*</Show>*/}`.
- **Adjacent dead symbol:** `const Loading` at `app.tsx:53` is referenced **only** by the commented Suspense fallback (grep: zero live references) — delete it too. `Suspense` and `Show` imports stay (live uses at `:201`, `:217`, `:261`, `:289`).

### 3. Add explicit backoff to the health loop — `packages/app/src/app.tsx:188`–`:192`

- **What:** inside `while (true)`, after the retry-decision line, add:

```tsx
while (true) {
  const res = yield* Effect.promise(() => checkServerHealth(http))
  if (res.healthy) return true
  if (checkMode() === "background" || type === "http") return false
  yield* Effect.sleep("500 millis")
}
```

- **Why:** today a failed attempt re-enters the loop immediately. `checkServerHealth`'s 750ms health cache (`utils/server-health.ts:17,103`) returns an already-resolved promise for repeats, so non-HTTP failure modes microtask-spin (busy CPU) between real network probes; only the outer 10s `Effect.timeoutOrElse` (`:194`) bounds it.
- **Placement:** sleep only on the path that actually retries (non-HTTP, blocking/first run). HTTP and background modes return immediately — unchanged.
- **Mechanism:** `Effect.sleep` — no new dependency. `Effect` is already imported (`app.tsx:14`), the loop is already `Effect.gen`, and string durations are already used in this file (`"10 seconds"` at `:194`). Repo-wide precedent: `opencode/src/cli/cmd/run/stream.transport.ts:567` (`yield* Effect.sleep("250 millis")`), exponential variant at `control-plane/workspace.ts:488`. The sleep sits inside the existing 10s timeout pipe (`:193`–`:197`), so it is budgeted and interruptible; `Effect.ensuring` (mode flip to background) is unaffected.
- **Duration:** fixed `500 millis` — simple; worst case one cached re-read per fresh probe (750ms cache) ≈ 1 network probe/sec, well within the 10s grace window. No escalating curve needed at this scale.

### 4. Skip the `ConnectionError` interval when retry is a no-op — `packages/app/src/app.tsx`

- **4a. ConnectionGate (`:221`–`:223`)** — pass `undefined` instead of a guarded no-op closure:

```tsx
onRetry={checkMode() === "background" ? () => void healthCheckActions.refetch() : undefined}
```

  The old closure's internal `if (checkMode() === "background")` guard moves to the prop expression (same condition, now visible to the child). `checkMode()` in JSX is reactive in Solid, so the prop flips `fn ↔ undefined` as the mode changes. Blocking windows: mode is set to `"blocking"` only by `onServerSelected`, which always starts a refetch in the same handler — so a check is in flight while blocking and auto-retry would be redundant anyway.

- **4b. ConnectionError (`:247`–`:248`)** — replace the unconditional `setInterval` with reactive start/stop:

```tsx
createEffect(() => {
  if (!props.onRetry) return
  const timer = setInterval(() => props.onRetry?.(), 1000)
  onCleanup(() => clearInterval(timer))
})
```

  - Reads `props.onRetry` inside the effect → tracks the prop getter → interval exists **only** while a real retry callback exists; torn down on `undefined` (blocking) and on unmount.
  - Interval callback reads `props.onRetry?.()` fresh each tick (no stale capture).
  - **Import:** add `createEffect` to the `solid-js` import block (`app.tsx:15`–`:28`); `onCleanup` already imported.
- **Why:** today the interval is created unconditionally at mount and ticks every 1s calling a no-op during blocking windows (timer churn for nothing).

### 5. Collapse duplicate store setters — `packages/app/src/context/global-sync.tsx`

- **What:**
  1. Delete `setBootStore` (`:131`–`:137`).
  2. Move the `set` definition (`:155`–`:161`, body unchanged) to immediately after `setProjects` (`:127`–`:129`), i.e. **before** the `bootstrap` query.
  3. At `:147`, change `setGlobalStore: setBootStore` → `setGlobalStore: set`.
- **Why:** both wrappers do the same thing (project special-case → `setProjects`, else pass through to `setGlobalStore`); `set` is the public superset (also accepts function updaters for `project`), `setBootStore` is used in exactly one place. One helper removes the drift risk (`setBootStore` lacks the function branch).
- **Safety:** `bootstrapGlobal` (`global-sync/bootstrap.ts:122`) only calls `setGlobalStore("project", <array>)` — handled identically by `set`; its return value is discarded (`.then((data) => ...)`). No other references to `setBootStore` exist (grep verified). `set`'s cast `as typeof setGlobalStore` keeps `bootstrapGlobal`'s `SetStoreFunction<GlobalStore>` parameter satisfied, same as before.
- **Do not** simplify `set`'s project special-case further in this issue (see Open Questions — it is behaviorally vestigial but out of scope).

### 6. Verification

1. **Typecheck:** from `packages/app` → `bun typecheck` (`tsgo -b`). Note: caches in `packages/app/node_modules/.ts-dist/tsconfig.tsbuildinfo`; if results look stale after edits, delete that `*.tsbuildinfo` and re-run (repo Known Issue).
2. **Unit tests:** from `packages/app` → `bun run test:unit` (`bun test --preload ../ui/test/solid-jsx.ts --preload ./happydom.ts ./src`). Full suite, not single files (order-dependent flakiness is a known pre-existing condition — do not chase unrelated reds). Existing coverage relevant here:
   - `src/utils/server-health.test.ts` (141 lines) — covers `checkServerHealth` itself; **unaffected** (the sleep is in `ConnectionGate`, not `server-health.ts`).
   - `src/context/global-sync.test.ts` — covers eviction/session-load helpers only; does not touch the setters; **unaffected**.
   - **No test imports `app.tsx`/`entry.tsx`** — there is no existing harness for `ConnectionGate`/`ConnectionError`/provider composition; AC only requires typecheck + existing tests green. No new tests are required (see Open Questions for the optional component-test discussion).
3. **Lint:** from repo root → `bun run lint`. Grep output for `app.tsx` / `global-sync.tsx` and confirm **no new** `no-unused-vars` (e.g. leftover `Loading`/imports). A clean pass alone is not proof (warnings are non-fatal repo-wide).
4. **Static greps (post-change):**
   - `rg -n "QueryClientProvider|<QueryProvider>" packages/app/src` → exactly one `<QueryProvider>` usage site (`app.tsx:310` region).
   - `rg -n "setBootStore" packages/app` → zero matches.
   - `rg -n "\{/\*" packages/app/src/app.tsx` → zero matches.
5. **Manual smoke (optional, per `packages/app/AGENTS.md` local dev):** backend `bun run --conditions=browser ./src/index.ts serve --port 4096` (from `packages/opencode`), app `bun dev -- --port 4444` (from `packages/app`), open `http://localhost:4444` — app boots, no console errors from query context. Note: the web entry passes `disableHealthCheck` (`entry.tsx:174`), so the health-loop and `ConnectionError` paths only exercise via non-`disableHealthCheck` compositions of the exported `AppInterface` — manual UI verification of those two paths is not reachable from the default web entry.
6. **Pre-push:** husky runs `bun turbo typecheck` across all packages — `packages/app` typecheck must be clean before push; regenerate nothing (no server-side schema/config change).

---

## Architecture Decisions

### D1 — Remove outer `QueryProvider`, keep inner (`AppInterface`)

- **Approach:** delete `app.tsx:158`/`:164`.
- **Rationale:** all 4 `useQueryClient` consumers resolve the inner client today; nothing between the two providers (ui providers, ServerProvider, ConnectionGate, ErrorPage) uses tanstack-query; `AppInterface` stays self-contained as an exported entry.
- **Alternative A:** remove inner, keep outer — rejected: `AppInterface` (exported via `index.ts`) would require callers to compose `AppBaseProviders` around it to get query support; the outer wrapper otherwise has no query-related responsibility.
- **Alternative B:** hoist one provider into `entry.tsx` — rejected: worse — both exported components would need external composition; more explanation required (Decision Framework), and it contradicts "least explanation that fits existing conventions".
- **Trade-off:** none identified — the outer client currently receives zero queries, so no cache behavior changes.

### D2 — Backoff = `yield* Effect.sleep("500 millis")` inside the existing `Effect.gen`

- **Rationale:** Effect already imported; loop already Effect-based; string durations already used in-file; repo-wide precedent (`stream.transport.ts`, `workspace.ts`). No new dependency (issue constraint), no promise/Effect style mixing.
- **Alternatives rejected:**
  - Export `wait()` from `server-health.ts` and `await` it — mixes promise-based helper into an Effect pipeline; sleep would also escape the surrounding `Effect.timeoutOrElse` bookkeeping style.
  - Plain `setTimeout` promisify — hand-rolled, uninterruptible by the 10s `Effect.timeoutOrElse`, worse than `Effect.sleep`.
  - Escalating/exponential curve — overkill inside a 10s budget with a 750ms probe cache; fixed delay is the option requiring least explanation.
- **Trade-off:** fixed delay (not exponential) — acceptable because the outer timeout already bounds total retry spend.

### D3 — Interval skip via `onRetry: undefined` + reactive `createEffect`

- **Rationale:** `onRetry?: () => void` is already optional; the no-op-ness is knowable only by the producer (ConnectionGate), so the signal must flow as `undefined`. Solid props are reactive getters, so mode flips propagate; `createEffect` + inner `onCleanup` is the idiomatic Solid start/stop pattern.
- **Alternatives rejected:**
  - Always-on interval calling `props.onRetry?.()` — fails the AC (timer still churns).
  - Boolean `autoRetry` prop — second prop encoding the same fact as `onRetry` presence; violates SSOT.
  - Reading `checkMode` inside `ConnectionError` — reaches into parent state; prop is the right boundary.
- **Trade-off:** one extra `createEffect` and an `createEffect` import; acceptable.

### D4 — Setter collapse: keep `set` (superset), delete `setBootStore`

- **Rationale:** `set` is the shipped public surface (returned at `:439`, 18+ call sites); `setBootStore` has one call site which only exercises the array branch that `set` handles identically (same call, same return value). Keeping `set`'s body untouched = zero behavior change on every path.
- **Alternatives rejected:**
  - Keep `setBootStore`, delete `set` — `setBootStore` lacks the function-updater branch and is not the public API; would regress `set`'s contract.
  - Extract a shared inner helper used by two wrappers — still two entry points; the AC asks for one helper.
  - Delete both wrappers (`const set = setGlobalStore`) — tempting (the project special-case routes to `setProjects`, which is literally `setGlobalStore("project", next)`, i.e. the passthrough call; only the return value differs and no call site uses it) but it is a behavior audit beyond the AC — deferred (Open Questions).
- **Trade-off:** the vestigial-looking special-case survives inside the single helper — documented, not silently removed.

---

## Open Questions

1. **Sleep duration:** `500 millis` recommended (≈1 probe/sec given the 750ms health cache; 20 attempts max in the 10s window). Any fixed value in 250–1000ms satisfies the AC; pick one and state it in the PR.
2. **Delete `Loading` (`app.tsx:53`)?** Recommended **yes** — only referenced by the comment block being deleted; it is already dead. Not listed explicitly in the issue's AC (comments only), so call it out in the PR description.
3. **Vestigial project special-case in `set`:** evidence shows `setProjects` ≡ passthrough for this key (identical `setGlobalStore("project", next)` call; return value unused at all 18 `globalSync.set(`/`sync.set(` call sites — all statement-position). Could later collapse `set` to `const set = setGlobalStore` and delete `setProjects`'s wrapper role (note: `setProjects` itself stays — used by `applyGlobalEvent({ setGlobalProject })` at `:360`). **Not in this issue** — separate, evidence-backed cleanup.
4. **Dead `showErrors` block in `bootstrap.ts:125`–`:130`** (commented-out call + now-unused `errors`/`showErrors` helpers above it) — observed while reading; **out of scope** for #379 (issue scope is `app.tsx` comments). Flag as a follow-up candidate.
5. **Component tests for `ConnectionGate`/`ConnectionError`:** none exist and none are required by the AC; building a harness (ServerProvider + Platform + Language + happydom timers) is disproportionate for interval start/stop. Optional follow-up only if the team wants regression coverage on the interval gating.
6. **`_plan/webui-review-findings-2026-11-08.md` missing:** the issue references it as supplementary; it does not exist on disk — if it exists elsewhere (other branch/worktree), re-check before implementation for extra findings.
