# Fix stuck/hanging provider LLM requests

**Status:** ✅ EXECUTED (reviewed 2026-09-22) — landed in `7e9466e`; evidence `provider/provider.ts:49-58` (`DEFAULT_HTTP_TIMEOUT` / `resolveHttpTimeout`) applied at `:188`, plus bridged subagent cancel (V1 `tool/task.ts` and V2 `v2/session.ts`).

## Goal

Provider LLM requests can hang **indefinitely** for two independent reasons, both confirmed by source inspection:

1. **No HTTP timeout is ever applied.** `packages/opencode/src/config/provider.ts:91-99` documents `timeout` as "Default is 300000 (5 minutes). Set to false to disable timeout.", but the code never injects a default. `customFetch` (`provider/provider.ts:1422-1474`) only installs `AbortSignal.timeout` when an explicit `timeout` is present (line 1430-1431), and it *also* hard-disables Bun's own fetch timeout via `timeout: false` (line 1463-1467). Grep for `300000` matches **only** the schema description strings — nothing applies it. So a request that never resolves (hung DNS, black-holed connection, a server that accepts but never responds) runs forever.
2. **Subagent cancel runs unbridged and cannot terminate a hung child.** `tool/task.ts:173` and `v2/session.ts:544` run the cancel effect via `Effect.runPromise(...)` directly. When the cancel effect yields a session service (e.g. `SessionRunState.cancel`), dropping the instance/workspace context produces `No context found for instance`, so a hung subagent can't be cancelled by its parent.

**Success criteria:** (a) every collective LLM call (main loop, subagent, side-channels, predict, title) is bounded by a real timeout unless the user explicitly opts out; (b) subagent cancellation actually runs within instance context and terminates a hung child; (c) the documented `timeout`/`chunkTimeout` defaults become truthful.

## Root cause verification (already done)

- `provider/provider.ts:1422-1474` — `customFetch`:
  - 1425: `chunkAbortCtl` created only if `chunkTimeout` is a number > 0.
  - 1430-1431: `AbortSignal.timeout(options["timeout"])` pushed ONLY if `options["timeout"]` is not `undefined`/`null`/`false`. **No default injection.**
  - 1449/1463-1467: Bun's fetch `timeout: false` explicitly disables the runtime timeout for ALL calls (both the malformed-JSON passthrough and the normal path).
  - 1470: `wrapSSE(res, chunkTimeout, chunkAbortCtl)` applied only when a chunk controller exists.
- `provider/provider.ts:44-90` — `wrapSSE`: timer reset on every successful `reader.read()` (lines 53-69). A slow-but-drip stream (partial tokens, keepalives) defeats `chunkTimeout`. Only applies to `text/event-stream` responses (line 47). So `chunkTimeout` guards only the fully-silent stream; a drip stream is bounded only by the total timeout.
- `config/provider.ts:91-103` — `timeout` is `Union([PositiveInt, Schema.Literal(false)])` (doc default 300000, `false` opt-out **exists**); `chunkTimeout` is `Schema.optional(PositiveInt)` (doc says "If no chunk arrives within this window, the request is aborted", **no default documented, NO `false` opt-out**). `options["timeout"]` flows from config into `customFetch` via the merged provider/model options (lines 1400-1414 build `options`, 1422 closures over it).
- `tool/task.ts:167,173` — `const cancel = ops.cancel(nextSession.id)` created in Effect context (line 167); `onAbort` (a plain closure) runs `Effect.runPromise(cancel).catch(...)` — unbridged, drops context. See `tool/tool.ts` AGENTS.md: `ops.cancel` is `TaskPromptOps.cancel` (from `promptOps` in `ctx.extra`); it ultimately invokes `SessionPrompt.cancel`/`SessionRunState.cancel` which read `InstanceState`/`Instance.current` → the "No context found for instance" defect.
- `v2/session.ts:539,544` — the same unbridged pattern: `Effect.runPromise(cancelChild).catch(...)`.
- **`EffectBridge` is NOT currently imported in either `tool/task.ts` or `v2/session.ts`** — the `@/effect/bridge` import must be added to both (see Steps 4, 5).

## Steps

### Step 1 — Add named defaults + pure resolvers (testable core)

**What:** Introduce module-level constants and two pure resolver functions near the top of `provider/provider.ts` (or a tiny sibling `provider/fetch-timeout.ts`):

```ts
export const DEFAULT_HTTP_TIMEOUT = 300_000 // 5 min — matches config/provider.ts doc
export const DEFAULT_CHUNK_TIMEOUT = 60_000 // 1 min of silence aborts an SSE stream

// Narrowing, NOT casting (no `as any`). undefined/null/other → default; false → false (unbounded); positive number → itself
export function resolveHttpTimeout(t: unknown): number | false {
  if (t === false) return false
  if (typeof t === "number") return t
  return DEFAULT_HTTP_TIMEOUT
}

// Narrowing. false → false (disable the chunk watchdog); positive number → itself; anything else → default
export function resolveChunkTimeout(t: unknown): number | false {
  if (t === false) return false
  if (typeof t === "number" && t > 0) return t
  return DEFAULT_CHUNK_TIMEOUT
}
```

**Why:** The default-application logic must be unit-testable in isolation (a live 300s test is impractical). Exporting pure resolvers lets us verify `undefined→300000`, `false→false`, `number→number` in microseconds. Keeping them in `provider.ts` (not a `.shared.ts`) is fine because they are trivially pure and cheap; export them for tests but keep the namespace self-reexport convention (`provider.ts` already exports via namespace projection).

**Files:** `packages/opencode/src/provider/provider.ts` (constants + resolvers; added before `wrapSSE` / `customFetch`). If a separate file is preferred for discoverability, `packages/opencode/src/provider/fetch-timeout.shared.ts` self-reexporting `export * as FetchTimeout from "./fetch-timeout.shared"` — but this is an ~14-line module; keep in `provider.ts` to honor "don't extract single-use helpers preemptively."

### Step 2 — Apply the default total timeout in `customFetch`

**What:** Replace lines 1430-1431 with resolver-driven logic:

```ts
const timeout = resolveHttpTimeout(options["timeout"])
const signals: AbortSignal[] = []
if (opts.signal) signals.push(opts.signal)
if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
if (timeout !== false) signals.push(AbortSignal.timeout(timeout))
```

**Why:** Makes the documented default truthful and bounds every hung request. `resolveHttpTimeout` returns `false` only for an explicit `timeout: false`, preserving the opt-out. Explicit numeric timeouts (e.g. config `timeout: 30000`) are untouched. Because `customFetch` is the single shared fetch fn used by the main loop, subagents, and all side-channels (all route through `Provider.getLanguage` → `sdk.languageModel`), **one change covers every caller** (Item 4 in scope).

**Decision — DEFAULT value = 300000 (the documented default), not 60s:**
- **Rationale:** The bug is *infinite* hang, not slow hang. Applying the *documented* 300s default is the least-surprise, minimal-blast-radius fix. It requires **no schema change** for `timeout` (the `false` literal and the "Default is 300000" description already exist) — after this fix the promise is honored.
- **Against 60s as the default:** a total timeout aborts legit long streams, notably reasoning/long-horizon models (e.g. GLM-5.2 reasoning) that can spend a long time computing a single token before emitting anything. The `chunkTimeout` watchdog (Step 3) already handles the "silent server" case with a shorter liveness bound. Lowering the total default to 60s and *additionally* making the docs match would be a separate, higher-blast-radius decision.
- **Net:** total timeout default 300000 bounds the truly-stuck case; `chunkTimeout` default 60000 catches silent 60s+ stalls much faster. Users who want an even stricter ceiling can set `timeout` explicitly (their config is respected verbatim).
- **Respecting opt-out:** `timeout: false` → no abort timer installed (unbounded total), exactly as documented. This opt-out applies to the **total** timeout only — see Step 3 for the independent `chunkTimeout: false` opt-out.

**Files:** `packages/opencode/src/provider/provider.ts` (edit `customFetch` body ~1422-1431).

### Step 3 — Default `chunkTimeout` as a companion liveness watchdog + add a `false` opt-out

**What (three coordinated edits):**

1. **Schema** — `config/provider.ts:100`: change `chunkTimeout: Schema.optional(PositiveInt)` to allow a `false` literal, mirroring `timeout`:
   ```ts
   chunkTimeout: Schema.optional(
     Schema.Union([PositiveInt, Schema.Literal(false)]).annotate({
       description: "Timeout in milliseconds between streamed SSE chunks for this provider. Default is 60000 (60 seconds). Set to false to disable.",
     }),
   ),
   ```
   This makes the default **and** the disable opt-out truthful at the config boundary.

2. **Resolver + calling code** — `provider/provider.ts:1419,1425`: use the resolver and suppress the controller when it returns false:
   ```ts
   const chunkTimeout = resolveChunkTimeout(options["chunkTimeout"])
   delete options["chunkTimeout"]
   // ...
   const chunkAbortCtl = chunkTimeout === false ? undefined : new AbortController()
   ```
   (`resolveChunkTimeout` never returns a non-positive `number`, so `=== false` is the only no-controller case.)

   **Typecheck gotcha (review-flagged):** after Step 3, `chunkTimeout` is typed `number | false`. The existing call-site guard at line 1469 (`if (!chunkAbortCtl) return res`) checks the *controller*, so TypeScript cannot correlate it with `chunkTimeout`'s type, and `wrapSSE(res, chunkTimeout, chunkAbortCtl)` at line 1470 would pass `number | false` to a `ms: number` parameter → `bun typecheck` failure. Fix: change the guard to `if (chunkTimeout === false) return res` (narrows `chunkTimeout` to `number`), then call `wrapSSE(res, chunkTimeout, chunkAbortCtl!)` — the `!` non-null assertion is acceptable (the controller is non-undefined when `chunkTimeout !== false`; the plan's "no `as` cast" rule does not preclude `!`). `wrapSSE`'s own internal guard (line 45: `if (typeof ms !== "number" || ms <= 0) return res`) is then redundant-but-harmless.

3. **Doc description** — the new `chunkTimeout` description (edit 1) names the 60000 default and the `false` opt-out.

**Why:** A fully-silent stream (connection accepted, server computes but sends nothing) is the classic hang. `chunkTimeout` aborts it after 60s of no chunk — far faster than the 300s total. And without a `false` literal, a user who wants NO chunk liveness bound (e.g. a legitimately quiet reasoning provider) had no way to disable it now that it has a default — Step 3 closes that gap symmetrically with `timeout: false`.

**Decision — include a default, = 60000, AND a `false` opt-out:**
- **Known limitation (must document in code + tests):** `wrapSSE` resets the timer on every successful `reader.read()`, so a *drip* stream (partial tokens / keepalives) that produces any chunk within each 60s window is **never** aborted by `chunkTimeout`. That is intentional — the drip case is bounded only by the 300s total timeout. The default `chunkTimeout` specifically covers the *wholly silent* case.
- **Risk — slow-first-token streams:** a reasoning model that emits its first chunk after >60s of silence would be aborted by a default `chunkTimeout` even though the 300s total would have allowed it. This is the counterpoint to Step 2's "total timeout covers stuck." Mitigations, in order: (a) the affordance is now **opt-out-able** via `chunkTimeout: false` (the clean answer for a legitimately quiet provider — do NOT tell them to set `timeout: false`, which would also disable the total-timeout backstop); (b) the default is conservative at 60s; (c) `resolveChunkTimeout` honors any explicit provider `chunkTimeout` verbatim. **Do not** present `timeout: false` as the mitigation for the chunk watchdog — it is a separate opt-out.

  > Note the `timeout: false` vs `chunkTimeout: false` distinction explicitly: they disable two DIFFERENT bounds. A user disabling the total timeout (`timeout: false`) still gets the 60000 chunk watchdog; a user disabling the watchdog (`chunkTimeout: false`) still gets the 300000 total. Documenting this asymmetry correctly is part of the fix.

- **Alternative considered — omit a chunkTimeout default:** would keep blast radius minimal (no chance of cutting a slow-first-token stream). Rejected because the *silent* hang is a real, common symptom and the 300s total alone means a silently-stuck stream still burns 5 minutes before failing — unacceptable for interactive UX. The `false` opt-out covers the legitimately-silent niche.

**Files:**
- `packages/opencode/src/config/provider.ts` (chunkTimeout schema + description, ~line 100-103).
- `packages/opencode/src/provider/provider.ts` (edit ~1419-1425, 1470; keep `delete options["chunkTimeout"]` — do not pass the internal key to the SDK factory).

### Step 4 — Fix subagent cancel bridging in `tool/task.ts`

**What:** Add the missing import, then capture the bridge in the Effect generator and use it in `onAbort` instead of raw `Effect.runPromise`:

```ts
import { EffectBridge } from "@/effect/bridge"
// ...
const bridge = yield* EffectBridge.make() // inside the generator, near `const cancel = ops.cancel(...)`
// ...
function onAbort() {
  if (cancelled) return
  cancelled = true
  bridge.promise(cancel).catch((error) => log.warn("subagent cancel failed", { error: String(error) }))
}
```

**Why:** `EffectBridge.make()` returns `Effect<Shape>` where each method wraps the effect with `attachWith(effect, { instance, workspace })` + `Effect.provide(ctx)` (`bridge.ts:57-59`), then `restore(instance, workspace, ...)` re-installs the legacy `Instance.context` / `WorkspaceContext` AsyncLocalStorage (`bridge.ts:15-21,62-63`). This reconstructs the exact context the delayed `runPromise` would otherwise drop, so `ops.cancel` → `SessionPrompt.cancel` / `SessionRunState.cancel` can resolve its `InstanceState` without the `No context found for instance` defect. The `@/effect/bridge` import is REQUIRED — it does not exist in this file today.

**API selection — `bridge.promise(...)` (single recommended approach):** `bridge.promise(cancel).catch(...)` returns a `Promise` we can `.catch(...)` on, which **preserves the existing "subagent cancel failed" warning contract** exactly (same `.catch`, same `log.warn`) while adding the context bridging. It is the minimal, behavior-preserving change and matches the already-`.catch`ed shape in `v2/session.ts`. (`bridge.fork(cancel)` is functionally equivalent for context-bridging — `wrap` is identical — but it does not return a promise to `.catch`, so failures must be wrapped in `Effect.catch` *inside* the effect before forking. **Do not use `fork` here**; keep `promise`. This satisfies the repo note *"use `EffectBridge.make()` + `.fork(effect)` to preserve the Effect runtime context"* in intent — bridging the runtime — while keeping the explicit warning.)

**Files:** `packages/opencode/src/tool/task.ts` (~line 163-174) — add import + bridge.

### Step 5 — Harmonize the V2 subagent abort in `v2/session.ts`

**What:** Apply the identical fix at line 544. Add the import, capture `const bridge = yield* EffectBridge.make()` in the `subagent()` generator, and replace `Effect.runPromise(cancelChild).catch(...)` with `bridge.promise(cancelChild).catch(...)`.

**Why:** `v2/session.ts:539-544` has the **same unbridged `Effect.runPromise`** problem the task asked me to check. It already has the `.catch` warning (that part was previously fixed, per the notes), but the cancel effect still runs outside instance context — so a V2-driven subagent's `SessionPrompt.cancel` can still throw `No context found for instance`. Harmonizing both call sites ensures V1 (`tool/task.ts`) and V2 (`v2/session.ts`) subagents behave identically (this is exactly the "V1/V2 subagent parity" invariant the repo documents under `agent/subagent-permissions.ts`).

**Files:** `packages/opencode/src/v2/session.ts` (~line 539-546) — add `import { EffectBridge } from "@/effect/bridge"` (required; not present) + bridge.

### Step 6 — Characterization + behavioral tests

**Why:** Rule 3 mandates characterization tests before any refactor, and these steps change the shared provider path (high blast radius) plus two cancel call sites. Write tests that lock the *new* (desired) behavior AND confirm existing explicit-config behavior is preserved.

**A. New `describe` block in `test/provider/provider.test.ts`, or a dedicated `test/provider/fetch-timeout.test.ts`:**

1. **Resolver unit tests (pure, fast)**:
   - `resolveHttpTimeout`: `undefined` → `DEFAULT_HTTP_TIMEOUT` (300000); `null` → default; `false` → `false` (opt-out preserved); `30000` → `30000` (explicit numeric respected).
   - `resolveChunkTimeout`: `undefined` → `DEFAULT_CHUNK_TIMEOUT` (60000); `false` → `false` (new opt-out); `15000` → `15000`; `0`/`-5` → default.
2. **Integration — default timeout aborts a never-resolving fetch.** In a live test, build a provider whose `fetch` is stubbed to return a `new Promise(() => {})` (never resolves). Assert the request rejects by the deadline. Because a 300s live wait is impractical, drive the short path as follows (preferred): `customFetch` reads the deadline from `resolveHttpTimeout(options["timeout"])`; test `customFetch`-level behavior with an explicit small provider `timeout` (e.g. `timeout: 50`) plus the never-resolving fetch — asserts the abort timer is *installed and enforced*. Combined with the resolver unit test for `undefined→300000`, this gives full coverage without a live 300s wait.
3. **Integration — explicit `timeout: false` installs no total-timeout abort.** Concrete assertion: stub `fetch` to capture `init.signal`, then assert (a) the signal did not abort within a ~100ms wait on a never-resolving body, OR (b) if the signal is an `AbortSignal`, check `signal.reason` is NOT a `TimeoutError` (`DOMException` with name `TimeoutError`) — a `timeout:`-derived signal surfaces `reason` as the `TimeoutError`. Assert the underlying `AbortSignal.timeout` was NOT attached. (With `chunkTimeout: false` in the same provider options, the request should be entirely unbounded — see Step 3.)
4. **Integration — explicit numeric timeout respected (config-merge tests).** Existing tests set `timeout: 30000`/`60000` (provider.test.ts:375-392, 1076-1095, 1768-1782) and assert it lands on `providers[...].options.timeout`. Keep them green — these are **config-merge tests** (they verify the schema/merge path preserves explicit values); they do NOT exercise runtime timeout enforcement. That gap is covered by tests 1-3 above.
5. **chunkTimeout behavior.** Stub fetch to return `text/event-stream` response feeding chunks:
   - *Silent stream:* a ReadableStream that never enqueues → aborts after the window (assert rejection / `reader.cancel` called). Use an explicit small `chunkTimeout` (e.g. 50ms) in the provider options to keep the test fast.
   - *Drip within window:* enqueue a chunk every 10ms with `chunkTimeout: 50ms` → completes successfully (documented drip-evasion: this is expected to pass, locking "drip stream is not aborted by chunkTimeout").
   - *`chunkTimeout: false` (new):* a silent stream with `chunkTimeout: false` → does NOT abort within a short wait (watchdog suppressed).

**B. `test/tool/task.test.ts` — subagent cancel bridging:**

1. **Keep existing test green** `"execute cancels child session when abort signal fires"` (line 290-338) — it uses `stubOps` whose `cancel` is a pure `Effect.sync`, so it passes today; after Step 4 it must still pass (regression on the abort→cancel wiring).
2. **New characterization test — cancel that requires service context now runs (no "No context found").** Extend `stubOps` (or a local override) so `ops.cancel` yields a service that reads instance context (e.g. `yield* SessionStatus.Service.getStatus(sessionID)` or `yield* InstanceRef`), which under unbridged `Effect.runPromise` throws `No context found for instance`. Assert that aborting the parent now (a) invokes cancel and (b) does **not** produce the "No context found" defect / the promise resolves or the cancel effect completes. If the cancel is fire-and-forget, assert the `cancelled` deferred resolves *and* that any `Effect.catch`/warning path logs normally rather than with a "No context found" message.

**C. Validation catches (document for implementer):**
- Run `bun typecheck` from `packages/opencode` (never `tsc` directly). Trust `bun typecheck` (tsgo) over LSP for `@/` alias resolution.
- Run the full suite from the package dir (`packages/opencode`), since Effect/mock state leaks across files and some tests are order-dependent; do not rely on isolation-only passes.
- Full suite command: `cd packages/opencode && bun test` (repo-root test is a guard and must not be run).

**Files:**
- `packages/opencode/test/provider/provider.test.ts` (add resolver + customFetch timeout/chunk tests) — or new `packages/opencode/test/provider/fetch-timeout.test.ts` if a cleaner home is preferred.
- `packages/opencode/test/tool/task.test.ts` (add bridged-cancel characterization test).

## Architecture decisions

### Chosen approach
- **Total timeout default = 300000 (`DEFAULT_HTTP_TIMEOUT`)** — make the *documented* default truthful. This is the single highest-leverage change: it bounds every hung request via the one shared `customFetch` (main + subagent + side-channels all covered), preserves explicit `false` opt-out, and needs no schema change for `timeout`. Low-design-risk, high-blast-radius but behavior is pure addition (previously the request could run forever; now it's bounded at exactly the documented value).
- **chunkTimeout default = 60000 (`DEFAULT_CHUNK_TIMEOUT`) + `false` opt-out** — companion liveness watchdog for fully-silent streams. Catches the "server accepted but sends nothing" hang 5× faster than the total timeout. Explicit provider `chunkTimeout` wins over the default; **`chunkTimeout: false` disables the watchdog** (schema `Union([PositiveInt, Literal(false)])`, symmetric with `timeout`).
- **Cancel via `EffectBridge.make()` + `bridge.promise(cancel).catch(...)`** — reconstructs instance/workspace ALS so subagent cancel runs within context; keeps the existing failure-warning contract. Applied to **both** `tool/task.ts` and `v2/session.ts` for V1/V2 parity. The `@/effect/bridge` import is added to both files (missing today).

### Alternatives considered
- **Lower total default (60s).** Rejected as the *default*: would cut off legitimate long reasoning streams (single-token reasoning in GLM-5.2-class models) and would require editing the documented default + schema description — a separate, breaking-ish decision. 60s belongs as a user-configured value or as the chunk liveness bound (which we default to), not as the total.
- **No chunkTimeout default (total timeout only).** Considered to minimize blast radius (avoids any chance of aborting a slow-first-token stream). Rejected: the silent hang is a primary symptom, and waiting the full 300s total for a silently-stuck stream is poor UX. The `chunkTimeout: false` opt-out covers the legitimately-silent niche. Users who want a quiet reasoning provider set `chunkTimeout: false` (NOT `timeout: false`).
- **Use `Effect.fork(cancel)` (the `.fork` idiom).** Functionally equivalent context bridging (`wrap` is identical), but it returns a `Fiber`, not a promise to `.catch`; errors must be handled inside the effect before forking. **Rejected as the chosen approach** to keep the existing explicit "subagent cancel failed" warning via `bridge.promise(cancel).catch(...)`, which also matches `v2/session.ts`. Commit to `bridge.promise`.
- **Test-gated constants (make `DEFAULT_*` overridable for tests).** Rejected for production purity; instead we test the pure resolvers directly and use small explicit timeouts in integration tests to drive the abort path live.
- **Per-model / reasoning-model differentiated total timeout.** Rejected for this iteration: over-engineering. The chunkTimeout default already gives reasoning models 60s of headroom *plus* the 300s total; if reasoning models need more, they set `chunkTimeout: false` or a larger explicit value, or use `timeout: false` for the total — a future per-provider config can handle this.

### Trade-offs / risks
- **Blast radius:** `customFetch` is the shared provider path for every LLM call. The change is behaviorally additive (bounded instead of infinite), but any provider with a legitimately >300s silent-first-chunk or >60s-chunk-gap stream could now abort. Mitigated by the two independent opt-outs (`timeout: false` for the total, `chunkTimeout: false` for the watchdog) and the explicit-value-wins resolver design.
- **Drip-evasion is by design:** a drip stream that emits within each window is never aborted by `chunkTimeout`; the 300s total is the backstop. Documented in code + tests so it is not "fixed" later.
- **Cancel is fire-and-forget:** `bridge.promise(...)` runs unawaited; failures are logged (warning preserved). No blocking, no unhandled rejection (`.catch` attached).

## Open questions
1. **Should the plan gate the default `chunkTimeout` behind providers known to be slow-first-token (reasoning models)?** Current decision is uniform 60s default + `false` opt-out. If product wants reasoning/dedupe-aware handling, this becomes a follow-up per-provider default.
2. **Bridge idiom — RESOLVED:** `bridge.promise(cancel).catch(...)` is the single recommended approach for both `tool/task.ts` and `v2/session.ts` (matches the existing `.catch` pattern and preserves the warning). `fork` is equivalent for context-bridging but would require wrapping the effect in `Effect.catch` first; not used. (See Step 4.)
3. **Chunk default value (60s):** confirm as reasonable vs a larger/smaller liveness bound (e.g. 120s) before implementation. 60s chosen as an interactive-UX-friendly bound.
4. **Test home:** whether to add `describe` blocks to the existing `provider.test.ts` vs a new `provider/fetch-timeout.test.ts`. Minor; either satisfies the characterization requirement.
5. **(Nit, optional) `config/provider.ts` `timeout` field has a duplicated `.annotate()`** — lines 91-99 wrap the same description annotation twice (`Schema.Union(...).annotate({ description })` then `.annotate({ description })` again). Harmless (identical text), but the implementer may clean it up to a single annotation while touching this schema in Step 3.

## Files changed (summary)
- `packages/opencode/src/config/provider.ts` — extend `chunkTimeout` schema to `Union([PositiveInt, Literal(false)])` + update description to name the 60000 default and the `false` opt-out (Step 3); optionally deduplicate the `timeout` `.annotate()`.
- `packages/opencode/src/provider/provider.ts` — add `DEFAULT_HTTP_TIMEOUT`, `DEFAULT_CHUNK_TIMEOUT`, `resolveHttpTimeout`, `resolveChunkTimeout`; use them in `customFetch` (lines ~1422-1431, 1419-1425, 1470).
- `packages/opencode/src/tool/task.ts` — add `import { EffectBridge } from "@/effect/bridge"` + bridge the subagent cancel (`bridge.promise(cancel).catch(...)`, ~line 163-174).
- `packages/opencode/src/v2/session.ts` — add `import { EffectBridge } from "@/effect/bridge"` + bridge `cancelChild` (~line 539-546).
- `packages/opencode/test/provider/provider.test.ts` — resolver + timeout/chunkTimeout behavioral tests.
- `packages/opencode/test/tool/task.test.ts` — bridged-cancel characterization test.

Implementation validated via `bun typecheck` from `packages/opencode`, then full `bun test` from the same dir.