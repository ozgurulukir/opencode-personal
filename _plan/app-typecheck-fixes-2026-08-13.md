# Fix 12 typecheck errors in `packages/app`

**Date:** 2026-08-13

**Status:** ✅ EXECUTED (reviewed 2026-09-22) — landed in `4f1fe2f` (fix(app): adapt to regenerated SDK contract); touched exactly the planned 5 files (dialog-connect-provider.tsx, terminal.tsx, event-reducer.test.ts, context/sync.tsx, pages/layout.tsx). Supersedes the `Status: Plan (approval pending)` line below.
**Status:** Plan (approval pending)
**Scope:** `packages/app` only. Do NOT touch SDK regenerated files (`packages/sdk/js/src/v2/gen/`) or the `opencode` package.

## Goal

A JS SDK regeneration (commit `d498ab2`) changed the SDK client contract:

- `response` / `request` fields on client results became **optional** (`response?: Response | undefined`) under `responseStyle: "fields"`.
- `Todo.status` / `Todo.priority` narrowed from `string` to **literal unions** (`"pending" | "in_progress" | "completed" | "cancelled"`; `"high" | "medium" | "low"`).

The `opencode` package was adapted in commit `a4e2e8d`, but `packages/app` was missed. On Windows the errors are masked by a stale `.tsbuildinfo`; on a clean box (Linux) or after deleting it, they surface. Goal: make `bun typecheck` exit 0 from `packages/app` (`tsgo -b` build mode) so the repo pre-push `turbo typecheck` gate passes from a clean build-info state.

There are **12 real errors across 5 files.**

## Steps

### Step 0 — Verify clean build-info state before diagnosing (understanding)

Reproduce the errors on a clean build-info baseline so we are fixing the real contract errors, not masking stale cache.

**Why:** The `.tsbuildinfo` can hide the SDK-contract errors on Windows; a "green" typecheck there is meaningless.

**Files changed:** none (operational).

```
cd packages/app
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue tsconfig.tsbuildinfo, node_modules/.cache, .tsbuildinfo   # any stale build-info
bun typecheck        # expect the 12 errors to surface
```

Confirm exactly 12 errors in 5 files before proceeding.

### Step 1 — Category 1: `store.methodIndex` is `number | undefined`, SDK `method` requires `number`

**File:** `packages/app/src/components/dialog-connect-provider.tsx` (lines **517**, **580**)

**Root cause:** the SolidJS store at line 67-72 declares `methodIndex: undefined as undefined | number` (line 68). It is written by `dispatch({ type: "method.select" })` (line 86) and reset to `undefined` by `method.reset` (line 93). The SDK `provider.oauth.callback` param `method` requires `number`.

Both call sites are in OAuth flows that only run **after** a method has been selected:
- Line 517 (`OAuthCodeView.handleSubmit`): user submits the OAuth code callback.
- Line 580 (`OAuthAutoView` `onMount`): auto-callback on mount.

**Decision:** Use the **`!` non-null assertion**, consistent with the existing use of `store.methodIndex!` in this very file at line 121 (`methods().at(store.methodIndex!)`), and matching the precedent pattern in `opencode`'s `httpapi-sdk.test.ts` (see Step 5 references). This preserves behavior exactly and signals "a method is guaranteed selected here".

- Line 517: `method: store.methodIndex,` → `method: store.methodIndex!,`
- Line 580: `method: store.methodIndex,` → `method: store.methodIndex!,`

**Rationale vs alternatives:**
- Early-return guard (`if (store.methodIndex === undefined) return`): also valid and type-safe, but diverges from the established `!`-usage in this file and adds control flow; the OAuth views cannot be reached without a selected method, so a guard would be defensive boilerplate.
- `?? 0` default: **rejected** — silently sends an arbitrary method index (`0`) that could target the wrong provider flow; violates "preserve behavior" and least-surprise.
- `as any` / `as number`: **rejected** per constraints.
- Changing the store type to plain `number`: **rejected** — `methodIndex === undefined` is used as a real "no method selected" state check throughout (`lines 230, 367, 644, 654`); collapsing it to `0` would break those checks.

**Files changed:** `src/components/dialog-connect-provider.tsx` (2 edits)

### Step 2 — Category 2: optional `response` on LLM/session result in `terminal.tsx`

**File:** `packages/app/src/components/terminal.tsx` (lines **480**, **500**, **501**, **502**, **504**)

**Root cause:** `client.pty.get` / `client.pty.connectToken` results now have `response?: Response | undefined` (optional).

**Decision:** Use justified **`!` non-null assertion** — the response is present once the HTTP request completes on all tested success (and 4xx/405-error) handling paths. This is the **exact precedent** from commit `a4e2e8d` in `packages/opencode/test/server/httpapi-sdk.test.ts`:
- `httpapi-sdk.test.ts:128` — `status: result.response!.status, // response is present once the HTTP request completes (all tested paths)`
- `httpapi-sdk.test.ts:147, 321, 326, 340, 342, 344` — `result.response!.status`, `health.response!.status`, etc.

In `terminal.tsx` the entire point is inspecting the HTTP status (`404`/`200`/`405`/`403`), so `response` must be present to reach the status checks. `throwOnError: false` (lines 479, 491) means a non-2xx does NOT throw and returns the result object — the `response` field is populated on these paths.

- Line 480: `.then((result) => result.response.status === 404)` → `.then((result) => result.response!.status === 404)`
- Line 500: `if (result.response.status === 200 && ...)` → `if (result.response!.status === 200 && ...)`
- Line 501: `if (result.response.status === 404 || result.response.status === 405) return` → `if (result.response!.status === 404 || result.response!.status === 405) return`
- Line 502: `if (result.response.status === 403)` → `if (result.response!.status === 403)`
- Line 504: `throw new Error(\`...${result.response.status}\`)` → `throw new Error(\`...${result.response!.status}\`)`

**Rationale vs alternatives:** `!` keeps the `=== 404` / `=== 200` / `=== 405` / `=== 403` checks working with minimal diff and matches the established `a4e2e8d` convention. Adding `.headers`/`.ok` fallbacks or restructuring into a helper would be over-engineering for a status-only inspection. `as any` rejected.

**Files changed:** `src/components/terminal.tsx` (5 edits)

### Step 3 — Category 3: stale `Todo.status` / `Todo.priority` literal casts in test fixtures

**File:** `packages/app/src/context/global-sync/event-reducer.test.ts` (lines **579**, **584**)

**Root cause:** the fixtures cast `as Todo` objects whose literal values are no longer valid against the narrowed SDK type:
- `Todo.status`: now `"pending" | "in_progress" | "completed" | "cancelled"` (confirmed in `packages/sdk/js/src/v2/gen/types.gen.ts:260`)
- `Todo.priority`: now `"high" | "medium" | "low"` (confirmed in `types.gen.ts:264`)
- Fixture uses `status: "open"` and `priority: "0"` — both invalid. The `as Todo` assertion is no longer pure (it would need to cross a now-narrower type), producing a typecheck error.

**Decision:** Update the two fixtures to **valid literals** (`status: "pending"`, `priority: "medium"`), keeping the existing `as Todo` shape so the test types stay intact with minimal diff. The `Todo` type is already imported at the top of the file (line 2: `import type { ... Todo } from "@opencode-ai/sdk/v2/client"`).

- Line 579: `{ content: "old", status: "open", priority: "0" } as Todo` → `{ content: "old", status: "pending", priority: "medium" } as Todo`
- Line 584: `{ content: "new", status: "open", priority: "0" } as Todo` → `{ content: "new", status: "pending", priority: "medium" } as Todo`

**Test intent verification** (to ensure valid literals don't change semantics): the test "replaces todo list and calls setSessionTodo on todo.updated" (`event-reducer.test.ts:574`) asserts only replacement semantics:
- `expect(store.todo[sessionID]?.map((x) => x.content)).toEqual(["new"])` (line 596)
- `expect(todos).toEqual([sessionID, "new"])` (line 597)

Neither assertion touches `status` or `priority`, so swapping the literal values to valid ones preserves runtime behavior while satisfying the narrowed type. The `{ ... } as Todo` shape stays, so the test compiles cleanly.

**Rationale vs alternatives:**
- `as unknown as Todo`: **rejected** — the test is intentionally exercising a *valid* todo replacement, not a legacy/unknown-status edge case. The value itself is meaningless to the assertion, so using a real valid literal is cleaner than a double-cast escape hatch.
- Dropping `priority` / removing the cast: riskier — `Todo` fields may be required; keeping the minimal cast avoids churn.

**Files changed:** `src/context/global-sync/event-reducer.test.ts` (2 edits)

### Step 4 — Category 4: optional `response` on messages fetch (`sync.tsx`, `layout.tsx`)

**Files:** `packages/app/src/context/sync.tsx` (line **306**), `packages/app/src/pages/layout.tsx` (line **754**)

**Root cause:** `client.session.messages` result now has optional `response`. Both sites call `messages.response.headers.get("x-next-cursor")`.

**Decision:** Add a justified **`!` non-null assertion**: the call is awaited (with `retry()`) and returns the result object; `response` is present once the HTTP call completes on the happy path (same precedent as `httpapi-sdk.test.ts:340` `session.response!.status`). Pagination could not proceed without a response, so `!` correctly signals the invariant.

- `sync.tsx:306`: `const cursor = messages.response.headers.get("x-next-cursor") ?? undefined` → `const cursor = messages.response!.headers.get("x-next-cursor") ?? undefined`
- `layout.tsx:754`: `const cursor = messages.response.headers.get("x-next-cursor") ?? undefined` → `const cursor = messages.response!.headers.get("x-next-cursor") ?? undefined`

**Rationale vs alternatives:** `!` matches the established convention (Step 2 / Step 5), keeps the `?? undefined` fallback for a missing header, and is the minimal diff. `as any` rejected.

**Files changed:** `src/context/sync.tsx` (1 edit), `src/pages/layout.tsx` (1 edit)

### Step 5 — Testing strategy & verification

**Precedent reference for the `!`-assertion pattern:** commit `a4e2e8d` in `packages/opencode/test/server/httpapi-sdk.test.ts` — lines 128 (with the explanatory comment "response is present once the HTTP request completes (all tested paths)"), 147, 321, 326, 340, 342, 344. Use the same reasoning/comments on any `!` in `packages/app` if a reviewer asks; the pattern is already established in the repo.

1. **Clean build-info, then typecheck (the primary bug-backed gate):**
   ```
   cd packages/app
   Remove-Item -Recurse -Force -ErrorAction SilentlyContinue tsconfig.tsbuildinfo, node_modules/.cache
   bun typecheck      # tsgo -b build mode; MUST exit 0
   ```
   Confirm the previous stale `.tsbuildinfo` masked these errors and that a clean run now passes. Do NOT rely on a pre-existing `.tsbuildinfo` to "pass".

2. **Run the affected `packages/app` test** to confirm the Todo fixture change (Step 3) doesn't break runtime assertions:
   ```
   cd packages/app
   bun test src/context/global-sync/event-reducer.test.ts
   ```
   Expected green; the test asserts content-replacement semantics which are untouched by the `status`/`priority` literal swap.

3. **Run the broader `packages/app` test suite** (tests must not run from repo root — use the package dir). Confirm `terminal`, `sync`, and any dialog/provider-related tests still pass given the `!` assertions. At minimum confirm no test regressions from the status inspection changes.

4. **Repo-wide pre-push gate simulation:** from a clean build-info state, run the repo's typecheck path that the husky `pre-push` hook uses across all packages (turbo typecheck). This is the REAL acceptance gate — it must pass from a clean state, proving the Windows-masked errors are actually resolved and no other package regressed. (Pushing not required; running the command locally is enough to verify.)

### File-change summary

| File | Line(s) | Change |
|------|---------|--------|
| `src/components/dialog-connect-provider.tsx` | 517, 580 | `store.methodIndex` → `store.methodIndex!` (2) |
| `src/components/terminal.tsx` | 480, 500, 501, 502, 504 | `result.response` → `result.response!` (5) |
| `src/context/global-sync/event-reducer.test.ts` | 579, 584 | `status:"open"`,`priority:"0"` → `status:"pending"`,`priority:"medium"` (2) |
| `src/context/sync.tsx` | 306 | `messages.response.headers` → `messages.response!.headers` (1) |
| `src/pages/layout.tsx` | 754 | `messages.response.headers` → `messages.response!.headers` (1) |

**Total: 11 edits fixing 12 typecheck errors** (dialog-connect-provider line 517 + 580 = 2; terminal 5; event-reducer 2; sync 1; layout 1 → 11 directives across 12 error sites — the `result.response` sites in terminal.tsx line 501 use two `!` in one line).

## Architecture Decisions

- **`!` non-null assertion as the default for optional `response`/`method`:** the runtime invariant (response present after a completed HTTP call; method present once selected) is true on all reachable paths, and the repo already established this exact convention in `a4e2e8d` (`httpapi-sdk.test.ts`). It is the minimal diff that satisfies the narrowed types without new control flow.
- **Valid literal updates (not double-casts) for test fixtures:** the narrowed `Todo.status`/`priority` literals changed; keeping `as Todo` but substituting valid values is cleaner than `as unknown as Todo` because the values are inert to the test's assertions and represent a real valid todo.
- **Rejected alternatives:** `as any` (forbidden); `?? 0` default for `methodIndex` (silently wrong method target — violates least-surprise); changing the store type to `number` (breaks the `undefined` sentinel used as "no method selected" at lines 230/367/644/654); `as unknown as Todo` in fixtures (unnecessary — valid literals exist).

**Trade-offs:** Using `!` trades exhaustively-safe null handling for conciseness and matches convention; this is acceptable because every `!` site documented above has a proven invariant. The `?? undefined` cursor fallback (for a missing *header*, not a missing *response*) is preserved.

## Open Questions

- None blocking. If a reviewer prefers an early-return guard over `!` at the two `dialog-connect-provider.tsx` call sites (a legitimate alternative for defensive safety), it can be applied without changing behavior — but the preferred, convention-consistent choice is `!`.