# Plan: Fix `opencode -c` crash — fabricated `"dummy"` sessionID

Date: 2026-09-24
Status: APPROVED for @coder
Scope: `packages/opencode` only (TUI). No SDK regen, no server changes.

---

## 1. Goal

`opencode -c` (`--continue`) must continue the last session cleanly:

- No `Expected a string starting with "ses", got "dummy" at ["sessionID"]` error.
- No spurious `session.get` request with a placeholder id.
- `-c` continues the last parentless session; `-c -s <id>` / `-s <id>` explicit selection unchanged; `--fork` unchanged.
- **No previous session** → app lands on the normal Home route (logo + prompt), no error toast. (Defined behavior: the continue effect finds no match and no-ops; Home is the initial route anyway.)

## 2. Verified root cause (all anchors read this session)

**Chain of failure:**

1. **`-c` option** — `packages/opencode/src/cli/cmd/tui/thread.ts:93-97`:
   ```ts
   .option("continue", {
     alias: ["c"],
     describe: "continue the last session",
     type: "boolean",
   })
   ```
   Passed into the TUI at `thread.ts:243-250`:
   ```ts
   args: {
     continue: args.continue,
     sessionID: args.session,
     agent: args.agent,
     model: args.model,
     prompt,
     fork: args.fork,
   },
   ```

2. **Fabricated initial route** — `packages/opencode/src/cli/cmd/tui/app.tsx:200-208`:
   ```tsx
   <RouteProvider
     initialRoute={
       input.args.continue
         ? {
             type: "session",
             sessionID: "dummy",
           }
         : undefined
     }
   >
   ```

3. **RouteProvider default** — `packages/opencode/src/cli/cmd/tui/context/route.tsx:24-34`. Route union at `route.tsx:5-22` (`HomeRoute | SessionRoute | PluginRoute`; `SessionRoute.sessionID` is a plain `string`, no brand in TUI context):
   ```ts
   init: (props: { initialRoute?: Route }) => {
     const [store, setStore] = createStore<Route>(
       props.initialRoute ??
         (process.env["OPENCODE_ROUTE"]
           ? JSON.parse(process.env["OPENCODE_ROUTE"])
           : { type: "home" }),
     )
   ```

4. **Session route mounts immediately** — `app.tsx:922-931`: the `<Switch>` is gated only by `ready()` (plugin init), NOT by sync status:
   ```tsx
   <Show when={ready()}>
     ...
     <Match when={route.data.type === "session"}>
       <Session />
     </Match>
   ```

5. **Mount-time fetch with the placeholder** — `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:232-270` (fetch at 236, error path at 261-269):
   ```tsx
   createEffect(() => {
     const sessionID = route.sessionID
     void (async () => {
       ...
       const result = await sdk.client.v2.session.get({ sessionID }, { throwOnError: true })
       ...
     })().catch((error) => {
       if (route.sessionID !== sessionID) return
       toast.show({ message: errorMessage(error), variant: "error", duration: 5000 })
       navigate({ type: "home" })
     })
   })
   ```

6. **Where the error text originates (server-side, not client)** — `packages/opencode/src/server/routes/instance/httpapi/groups/v2/session.ts:149-153`:
   ```ts
   HttpApiEndpoint.get("get", "/api/session/:sessionID", {
     params: { sessionID: SessionID },
     ...
   ```
   Effect HttpApi decodes the path param with the `SessionID` schema → 400 whose message is the ParseError text; `throwOnError: true` makes the SDK client throw it. Grep of `packages/sdk/js/src/v2` for `isStartsWith` found **no client-side validation** — validation is server-side only.

7. **The schema** — `packages/opencode/src/session/schema.ts:7-12` (exact, no drift):
   ```ts
   export const SessionID = Schema.String.check(Schema.isStartsWith("ses")).pipe(
     Schema.brand("SessionID"),
     withStatics((s) => ({
       descending: (id?: string) => s.make(Identifier.descending("session", id)),
     })),
   )
   ```

8. **The late navigation (why it "works" today, racy)** — `app.tsx:382-403`:
   ```ts
   let continued = false
   createEffect(() => {
     // When using -c, session list is loaded in blocking phase, so we can navigate at "partial"
     if (continued || sync.status === "loading" || !args.continue) return
     const match = sync.data.session
       .toSorted((a, b) => b.time.updated - a.time.updated)
       .find((x) => x.parentID === undefined)?.id
     if (match) {
       continued = true
       if (args.fork) { /* fork then navigate */ } else {
         route.navigate({ type: "session", sessionID: match })
       }
     }
   })
   ```

9. **Sync lifecycle** — `packages/opencode/src/cli/cmd/tui/context/sync.tsx`: status starts `"loading"` (`:50`), becomes `"partial"` after the blocking phase (`:409`), `"complete"` after non-blocking (`:428`). With `-c`, `session.list` is loaded in the **blocking** phase (`sync.tsx:348,363,380,388,404`) so the continue effect can fire at `"partial"`. `ready` getter (`:455-458`) = `status !== "loading"`.

**Failure mechanics:** the Session route mounts with `"dummy"` and fires `session.get` immediately; the continue effect only navigates once sync reaches `"partial"`. The doomed fetch's 400 round-trip vs. the blocking-phase completion is a **race** — when the fetch error wins, the user gets the error toast + a flash of Home before the real navigation. When navigation wins, the catch's `route.sessionID !== sessionID` guard suppresses it. Either way a spurious invalid request is always sent.

## 3. Load-bearing check: is `"dummy"` used anywhere else?

Grep results (this session):

- `sessionID: "dummy"` — **only** `app.tsx:205`. No other construction of an `initialRoute` session route exists.
- `initialRoute` — only `app.tsx:201` (call site) and `route.tsx:26,28` (prop definition). No other call site passes `initialRoute`.
- Other `"dummy"` matches are unrelated: `session/llm.ts:218,490` (LiteLLM dummy tool), `v2/auth.ts:8` + `auth/index.ts:8` (`OAUTH_DUMMY_KEY`), `util/scrap.ts:4` (dummyFunction), `plugin/codex.ts:421` (dummy API key comment).

**Conclusion: `"dummy"` is not load-bearing anywhere. Removing it is safe.**

## 4. Approach (chosen) + alternatives

### Chosen: boot `-c` on Home; let the existing continue effect navigate (2 files)

Remove the fabricated session route entirely. `-c` starts on the default Home route (the "valid loading/home state"); the existing continue effect at `app.tsx:382-403` navigates to the real last session when sync reaches `"partial"`. Add a one-line guard in `Home` so `args.prompt` is never auto-submitted into a **new** session when `-c` is active.

**Why this is correct for every case:**

| Case | Behavior after fix |
|---|---|
| `-c`, session exists | Home renders during blocking phase → continue effect navigates to last parentless session at `"partial"` (unchanged code) |
| `-c`, no session | Home stays; continue effect finds no match, no-ops → clean Home, no toast |
| `-c --fork` | Home briefly → fork → navigate to forked id (unchanged) |
| `-s <id>` | Unaffected: `app.tsx:373-378` onMount navigation + `thread.ts:213-224` `validateSession()` pre-flight already handle it |
| `-c -p "text"` | Home mounts (new!) — without a guard, `home.tsx:50-59` would auto-submit the prompt into a **new** session before the continue navigation. The guard makes this deterministic: prompt is not auto-submitted (matches today's race-won path where the prompt is silently dropped). Full `-c -p` support is out of scope (pre-existing broken — Session route never reads `args.prompt`). |
| `OPENCODE_ROUTE` env | Unaffected (`route.tsx:29-30` fallback still works) |
| `OPENCODE_FAST_BOOT` | Continue effect still waits for `status !== "loading"`; unchanged |

**Tradeoff accepted:** a brief Home flash (logo + prompt) between `ready()` and sync `"partial"` (blocking phase = 6 local requests, typically fast). This replaces today's empty session shell flash. Home is the honest loading state and matches normal boot UX; the user's preferred direction explicitly blesses "mount a valid loading/home state".

### Alternatives considered and rejected

1. **Keep `"dummy"` route, guard the fetch effect with `sessionID.startsWith("ses")`** — rejected: keeps a fabricated route in the store (violates the stated direction); duplicates the schema invariant as a magic string in the view layer; terminal-title effect and command palette still see a bogus session route.
2. **Defer rendering the `<Switch>` while `args.continue && sync.status === "loading"`** (render gate in `app.tsx:922`) — viable, eliminates the Home flash, but adds a new args+sync-coupled render gate and a blank-screen state; more complexity for a ~100–300 ms cosmetic win. Documented as the fallback if the Home flash is judged unacceptable.
3. **Make `SessionRoute.sessionID` optional / add a `"loading"` route type** — type surgery on the route union touching every consumer. Over-engineered.
4. **Resolve the last-session id pre-mount in `thread.ts`/worker RPC and pass it as `args.sessionID`** — moves the concern across the worker RPC protocol boundary; large change for no behavioral gain. Rejected.

## 5. Defense in depth decision

**No new guard is justified.** After the fix, every path into the Session route produces a real id: continue effect (id from server store), `-s` onMount (pre-validated by `validateSession()` at `thread.ts:213-224`), `SessionSelect` event, fork results, session-list dialogs. The only remaining invalid-id source is the dev-only `OPENCODE_ROUTE` env override, and the Session route's existing catch (`index.tsx:261-269`: toast + `navigate({ type: "home" })`) already degrades gracefully for any bad id — that IS the boundary defense (fail loud, recover). Adding a `startsWith("ses")` check in the component would duplicate the `SessionID` schema invariant as a magic string. Explicitly rejected as over-engineering.

## 6. File-by-file edit checklist (for @coder)

**Step 1 — `packages/opencode/src/cli/cmd/tui/app.tsx` (lines 200-208)**
Delete the `initialRoute` prop entirely so the JSX reads:
```tsx
<RouteProvider>
```
(The `RouteProvider` prop type in `context/route.tsx` stays untouched — optional prop, generic infrastructure. `input.args.continue` remains used at `app.tsx:385` and `sync.tsx:363`, so no dead args.)

**Step 2 — `packages/opencode/src/cli/cmd/tui/routes/home.tsx` (effect at lines 50-59)**
Add one early return so `-c` never auto-submits the prompt into a fresh session:
```tsx
if (!args.prompt) return
if (args.continue) return
if (r.current.input !== args.prompt) return
```

**Step 3 — no other changes.** Do not touch `context/route.tsx`, `routes/session/index.tsx`, `context/sync.tsx`, `thread.ts`, or the continue effect (`app.tsx:382-403` — it already implements the desired semantics).

Style: no semicolons, 120 col, `const` over `let`, no `any`, no new deps.

## 7. Risks / edge cases

- **Home flash for `-c`** (blocking-phase duration). Accepted; alternative render gate documented in §4 if rejected in review.
- **`-c -s <id>` combined** — pre-existing quirk, unchanged by this fix: the continue effect can override the `-s` selection at `"partial"` (both effects fire; `app.tsx:385` only checks `args.continue`). Out of scope.
- **`-c -p` prompt dropped** — pre-existing (prompt was already dropped or mis-submitted depending on today's race); the guard makes it deterministic. Full support (submit into the continued session) out of scope.
- **Blocking-phase failure with `-c`** — `aggregateFailures` fatal exit path unchanged (`sync.tsx:366-373,431-442`).
- **Upstream parity** — UNVERIFIED: no upstream remote is configured locally; whether `anomalyco/opencode` has the same bug or a fix was not checked. Fork commit `eabea7f` introduced the `"dummy"` placeholder.

## 8. Verification

1. **Typecheck** (mandatory, from the package dir — never `tsc`, never repo root):
   ```
   cd packages/opencode
   bun typecheck
   ```
   (`packages/app` and SDK are untouched — no SDK regen needed.)
2. **Lint**: `bun run lint` (oxlint) from repo root.
3. **Manual TUI verification** (no automated harness covers App-level routing — see below). Per `packages/opencode/AGENTS.md`, run the dev TUI in tmux, not foreground:
   - In a directory **with** an existing session: start with `-c` → expect: no error toast, last session opens.
   - In a directory **with no** sessions: start with `-c` → expect: Home route, no toast.
   - `-c --fork` → forked session opens.
   - `-s <valid-id>` → still opens that session.
4. **Test feasibility** (searched `packages/opencode/test/` this session): no existing routing/`initialRoute` tests. A component harness exists (`test/cli/cmd/tui/sync-fixture.tsx` — `testRender` from `@opentui/solid` + provider stack + fetch mock), but the continue effect is ~20 lines embedded in the heavy `App` component (keymap, renderer, plugins, dialogs) — not mountable in the harness without refactoring. Per repo rules (no single-use helper extraction without characterization need; don't duplicate logic in tests), **no regression test in this change**; manual verification above is primary. Optional follow-up: extract `latestParentlessSession(sessions)` as a pure `.shared.ts` helper with a unit test if App routing is ever refactored for testability.

## 9. Out of scope

- `-c -p` submitting the prompt into the continued session.
- `-c` + `-s` combination semantics.
- Removing the now-unused-by-callers `initialRoute` prop from `RouteProvider` (keep API surface; only call site removed).
- Upstream sync/parity check.
- Any server-side or SDK changes.
