# Fix SDK-regen typecheck failures in `opencode`

- **Date:** 2026-08-13
- **Author:** strategic planning agent
- **Status:** plan (not yet implemented)

## Goal

Restore a clean `bun typecheck` in the `opencode` package after the JS SDK was regenerated
(commit `d498ab2`, `chore(sdk): regenerate v2 client with chunkTimeout false opt-out and schema drift`)
via `packages/sdk/js/script/build.ts` (`@hey-api/openapi-ts`). The `pre-push` hook runs typecheck and
currently fails. This is a **type-contract fix, not a behavior change** — the runtime behavior of the
TUI sync store and the httpapi SDK test is unchanged.

The scope is limited to how `opencode` **consumes** the regenerated SDK. The regenerated files under
`packages/sdk/js/src/v2/gen/` are **not** touched.

## Root cause (verified)

The regeneration changed the SDK contract two ways:

1. **New `Event` union members.** `types.gen.ts` now includes `EventMessagePartUpdatedBatch`
   (`type: "message.part.updated.batch"`, `properties: { sessionID; parts: Array<Part>; time }`) and
   `EventMessageUpdatedBatch` (`type: "message.updated.batch"`, `properties: { sessionID; infos: Array<Message> }`)
   in the `Event` union (`types.gen.ts:54,56`) and the `SyncEvent` union (`types.gen.ts:803,805,838,840`).
   The TUI event handler subscribes to the SDK `Event` type
   (`src/cli/cmd/tui/context/event.ts:1,9` → `subscribe(handler: (event: Event) => void)`), so a switch case
   on `"message.part.updated.batch"` now type-checks without a cast. The `@ts-expect-error` guarding it is
   now unused → TS2578.

2. **Optional `RequestResult.response`.** The generated client (`@hey-api/client-fetch` ) keeps
   `response?: Response` for the default `responseStyle: "fields"` / `throwOnError: false` path
   (`packages/sdk/js/src/v2/gen/client/types.gen.ts:109-127`). The test's `SdkResult = { response: Response; ... }`
   (required `response`) no longer matches, breaking `capture()`, `expectStatus()`, and 5 direct `.response.status`
   read-sites.

### Files verified (do NOT redo exhaustively)

- `packages/opencode/src/cli/cmd/tui/context/sync.tsx:288` — the only `@ts-expect-error` in the file
  (grep: 1 match). It sits directly above `case "message.part.updated.batch"`.
- `packages/opencode/test/server/httpapi-sdk.test.ts` — `SdkResult` at line 31; `capture()` at 125-133;
  `expectStatus()` at 145-150; direct `.response.status` reads at lines 321, 326, 340, 342, 344.
- `packages/opencode/src/cli/cmd/tui/context/event.ts` — subscribe handler is typed `(event: Event) => void`
  from `@opencode-ai/sdk/v2`.
- Sibling httpapi tests (`httpapi-ui.test.ts`, `httpapi-workspace.test.ts`, etc.) use raw `fetch` and a real
  `Response` object — they do **not** use the SDK client result shape, so they are unaffected by the regen
  (grep over `test/server/*.test.ts` for `.response.status` confirmed only `httpapi-sdk.test.ts` reads the SDK `RequestResult`).

## Steps

### Step 1 — `sync.tsx`: drop the unused `@ts-expect-error` and the cast

**Files:** `packages/opencode/src/cli/cmd/tui/context/sync.tsx:288-311`

**Why:** The regen added `message.part.updated.batch` to the `Event` union, so the guard is unused (TS2578) and
the `as unknown as` cast on `event` is no longer needed. The switch now narrows `event` to
`EventMessagePartUpdatedBatch`, whose `properties.parts` is `Array<Part>` — structurally identical to what the
handler already consumes (`Part` is already imported at `sync.tsx:5`).

**Change:**
1. Delete the directive comment at line 288
   (`// @ts-expect-error — SDK Event types don't include message.part.updated.batch`).
2. Delete the narrowed-via-cast local `const e = event as unknown as { properties: { parts: Part[] } }`
   at line 290.
3. Rewrite the loop to read `event.properties.parts` directly (replacing `e.properties.parts`):
   ```tsx
   case "message.part.updated.batch": {
     for (const part of event.properties.parts) {
       const existing = store.part[part.messageID]
       if (!existing) {
         setStore("part", part.messageID, [part])
         continue
       }
       const r = Binary.search(existing, part.id, (p: Part) => p.id)
       if (r.found) {
         setStore("part", part.messageID, r.index, reconcile(part))
       } else {
         setStore(
           "part",
           part.messageID,
           produce((draft: Part[]) => {
             draft.splice(r.index, 0, part)
           }),
         )
       }
     }
     break
   }
   ```
   `Part` is imported, so no new imports. No other `@ts-expect-error` exists in the file (verified by grep),
   so this is the only directive change.

**Note on `message.updated.batch`:** This event is now in the `Event` union but has **no** matching case in the
`sync.tsx` switch. A TS `switch` over a discriminated union does **not** enforce exhaustiveness, so an unhandled
member is not a type error — leaving it unhandled does not break typecheck. Adding a `message.updated.batch`
handler would be a *behavioral* change (and is outside the "type-contract fix only" constraint), so it is **out of
scope** here. See Open Questions.

### Step 2 — `httpapi-sdk.test.ts`: make `response` optional and update the helpers + read-sites

**Files:** `packages/opencode/test/server/httpapi-sdk.test.ts`

**Why:** The regenerated client returns `response?: Response` on the default `responseStyle: "fields"` /
`throwOnError: false` path. All `capture()` / `expectStatus()` / direct-read call sites use client methods
without `throwOnError`, so they resolve to that optional-response shape and must be updated to compile.

**Changes (8 edit points, all small):**

1. **Line 31** — make `response` optional:
   ```ts
   type SdkResult = { response?: Response; data?: unknown; error?: unknown }
   ```
   This remains structurally assignable from the client's `RequestResult<...>` (its members are all optional and
   assignable to `unknown`/`Response`), and `SdkResult` continues to describe the `data`/`error` fields used by
   `capture()`.

2. **Line 128** (`capture`) — the `status` must stay a `number` (`Captured` at line 32 and the `statuses()`
   aggregator at line 169 depend on it). The response is guaranteed present for the completed HTTP requests the
   test exercises, so use a non-null assertion with a justification:
   ```ts
   status: result.response!.status, // response is present once the HTTP request completes (all tested paths)
   ```

3. **Lines 145-150** (`expectStatus`) — widen the parameter from `() => Promise<{ response: Response }>` to
   `() => Promise<SdkResult>`, then assert with `!`:
   ```ts
   function expectStatus(request: () => Promise<SdkResult>, status: number) {
     return call(request).pipe(
       Effect.tap((result) => Effect.sync(() => expect(result.response!.status).toBe(status))),
       Effect.asVoid,
     )
   }
   ```
   Call sites (lines 328, 348-351) already pass client methods returning `RequestResult`, so widening the
   parameter fixes assignment. `!` is justified: status assertions only run on completed requests, and an
   absent response deliberately fails the `toBe(...)`.

4. **Direct read-sites at lines 321, 326, 340, 342, 344** — same treatment. Because `expect(x).toBe(n)`
   accepts `unknown`, either `!` or `?.` compiles; use `!` consistently (response present on success):
   - line 321 `expect(health.response!.status).toBe(200)`
   - line 326 `expect(log.response!.status).toBe(200)`
   - line 340 `expect(file.response!.status).toBe(200)`
   - line 342 `expect(session.response!.status).toBe(200)`
   - line 344 `expect(listed.response!.status).toBe(200)`

**Rejected alternatives (documented):**
- `result.response?.status` alone in `capture()` produces `number | undefined`, which violates
  `Captured.status: number` and would need a magic sentinel (`?? 0`) that muddies intent; `!` keeps the exact
  `number` type. This is the accepted repo pattern for "guaranteed present on success" (justified non-null).
- `statusPayload`/`status(...)` typed helper was considered but is more churn than the `!`-per-site approach and
  buys nothing extra here since there are only 7 status-affecting sites under one test file.

### Step 3 — Full verification (no other files broke)

**Files:** none to change; run the checks below.

**Why:** Confirm the regenerated contract did not surface additional failures beyond `sync.tsx` and
`httpapi-sdk.test.ts`, and that the fixes are complete.

**Change:** No code change — run:
1. `bun typecheck` from `packages/opencode` → exit 0.
2. `bun test test/server/httpapi-sdk.test.ts` from `packages/opencode` → passes (runtime preserved).
3. (Optional sanity) `bun run lint` from repo root if workflow requires it.

## Architecture Decisions

- **No `as any`.** The `sync.tsx` cast was `as unknown as` and is *removed* in favor of real discriminated-union
  narrowing. The test file uses justified non-null assertions (`!`), never `as any`, per repo AGENTS.md
  ("avoid `as any`; prefer narrow types / non-null assertions with justification").
- **NonNull assertion for status reads** rather than optional chaining or a sentinel: the `Captured.status: number`
  contract requires a `number`, and the response is guaranteed on the completed-request paths these tests
  exercise. Where `SdkResult` is produced by `capture`, the optional-`response` type is preserved in the type;
  the `!` is scoped to the status read only.
- **Switch exhaustiveness:** leaving `message.updated.batch` unhandled in `sync.tsx` is intentional — TS does not
  force exhaustiveness on a `switch`, and adding a handler is a behavior change outside this task's scope.
- **Generaled files untouched:** all fixes live in `opencode`'s consumption of the SDK, never in
  `packages/sdk/js/src/v2/gen/`.

### Alternatives considered

- *Add a `message.updated.batch` handler in `sync.tsx`.* Rejected for this task: it is a behavior change, not a
  type-contract fix. Noted as a follow-up because AGENTS.md recommends checking batch handlers when batch events
  exist (`message.part.updated.batch` already has one; `message.updated` still only handles single updates).
- *Optional chaining `?.` at all status sites.* Compiles fine for the direct `expect(...).toBe()` reads, but does
  not work for `capture()` (which must emit a `number`). Using `!` uniformly keeps the codebase consistent and
  honest about the "response present on success" invariant.
- *A shared `status()` helper returning `r.response?.status`.* Rejected: the direct read-sites assert inline and
  `capture()` needs a `number`, so a helper would only partially apply and would not reduce churn.

### Trade-offs

- `!` reads are safe under the current happy/failure-path semantics (every tested call completes with an HTTP
  response) but would throw if a future network-only-crash path were ever routed through `capture()`/`expectStatus`.
  This is acceptable and consistent with existing test intent (assert real HTTP status).
- The `SdkResult.response?: Response` change is a small, truthful adjustment of the test's local type to match the
  generated client. It does not weaken assertions because status is still checked via `!` against a real `number`.

## Open Questions

1. **Should `message.updated.batch` get a handler in `sync.tsx`?** It is now typed in the `Event` union but has no
   switch case. Adding one (batch upsert by `properties.infos`) would make the TUI reflect multi-message updates and
   align with the AGENTS.md guidance to pair single/batch handlers. This is a **behavioral** enhancement → propose as
   a separate, follow-up change; it is intentionally not part of this typecheck fix.
2. **Update stale AGENTS.md?** The TUI AGENTS.md note ("`message.part.updated.batch` is not in the SDK Event type
   ... Adding a handler needs `@ts-expect-error` or `as unknown` casts") is now **stale** — the regen added the type.
   The example code in the doc no longer needs a cast. Recommend updating that note after the code change
   (doc-comment fix, separate from the typecheck fix).

## Testing strategy

- **Typecheck:** `bun typecheck` from `packages/opencode` exits 0. This is the gate that the `pre-push` hook
  enforces.
- **Runtime:** `bun test test/server/httpapi-sdk.test.ts` from `packages/opencode` passes. This is the test whose
  helper types changed; it guards against the type fix accidentally altering runtime behavior
  (statuses, data, error-parity assertions).
- **`sync.tsx` coverage:** There is no dedicated test for the `sync.tsx` batch handler (it lives in TUI startup
  wiring). Verification for the `sync.tsx` change is milestone-based: typecheck passing (unused-directive error
  gone) plus TypeScript narrowing proving `event.properties.parts` is well-typed. Confirm no existing TUI
  characterization test asserts the old cast shape before finalizing.
- **Repo rule:** tests are run from `packages/opencode`, never from repo root (guard: `do-not-run-tests-from-root`).
- **Full-suite awareness:** order-dependent failures are documented repo-wide; if `httpapi-sdk.test.ts` passes in
  isolation but fails in the full suite, re-run the full suite to confirm it is the pre-existing shared-state flake
  and not this change.