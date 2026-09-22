# Fix `@opencode-ai/diff-wasm` Async API Consumers

**Status:** ✅ EXECUTED (reviewed 2026-09-22) — landed in `d83ad7c` (async API + binary embed), `aa27a80` (JS fallback + tests), `547bf2d` (retry-once hygiene), `c9b2f1d` (bindings refresh); evidence `packages/diff-wasm/src/index.ts:66` (async `diffLines`), all consumer call sites migrated.

## Summary

`packages/diff-wasm/src/index.ts` now exposes `async` versions of `diffLines`, `createTwoFilesPatch`, and `structuredPatch` (WASM init is async). `parsePatch` and `applyPatch` remain sync (delegating to the `diff` npm package). Seven consumer files call the now-async functions and must be updated to propagate `async`/`await` up their call chains.

---

## Prerequisite Verification

Before modifying any consumer, confirm the WASM package changes are in place:

- [ ] `packages/diff-wasm/src/index.ts`: `diffLines`, `createTwoFilesPatch`, `structuredPatch` are `async` and call `await ensureWasm()` before delegating to the Rust/WASM bindings.
- [ ] `packages/diff-wasm/src/index.ts`: `parsePatch` and `applyPatch` remain synchronous (delegating to `jsParsePatch` / `jsApplyPatch` from the `diff` npm package).
- [ ] `packages/diff-wasm/package.json`: `"diff"` dependency is still listed (required by the sync functions).

---

## Blast-Radius Verification (Pre-Coding)

Trace the callers of each Tier 2 service method to confirm the async boundary stops at the service interface and that upstream callers absorb the change transparently.

### `File.read` (`packages/opencode/src/file/index.ts:505`)

**Confirmed callers (all Effect-style, absorb async transparently):**

| Caller | File | Line | Pattern |
|--------|------|------|---------|
| HTTP API handler | `server/routes/instance/httpapi/handlers/file.ts` | 10 | `yield* File.Service.use((svc) => svc.read(...))` |
| Project bootstrap | `project/bootstrap.ts` | 27 | `yield* File.Service` |
| Debug CLI | `cli/cmd/debug/file.ts` | 33 | `yield* File.Service.use((svc) => svc.read(args.path))` |

**Verdict:** All callers use `yield* File.Service` / `File.Service.use`. Making `read` async inside its `Effect.fn` callback propagates through Effect's async handling — no caller changes needed.

### `diffFull` (`packages/opencode/src/snapshot/index.ts:801`)

**Confirmed callers (all Effect-style, absorb async transparently):**

| Caller | File | Line | Pattern |
|--------|------|------|---------|
| Session summary | `session/summary.ts` | 99, 110 | `yield* snapshot.diffFull(from, to)` |
| Session processor | `session/session.ts` | 687 | `yield* snapshot.diffFull(from, to)` |

**Verdict:** All callers use `yield* snapshot.diffFull(...)`. The `diffFull` Effect.fn already supports async internally — no caller changes needed.

### VCS chain (`packages/opencode/src/project/vcs.ts`)

**Call chain (all `Effect.fnUntraced`, absorb async transparently):**

```
emptyPatch (line 17)
  → nativePatch (line 116, calls emptyPatch at line 129)
    → patchForItem (line 138, calls nativePatch at line 151)
      → files (line 154, calls patchForItem at line 168)
        → diffAgainstRef (line 189, calls files at line 193)
        → track (line 206, calls files at line 207, diffAgainstRef at line 208)
```

**Confirmed external callers:**

| Caller | File | Line | Pattern |
|--------|------|------|---------|
| Session revert | `session/revert.ts` | 75 | `yield* snap.track()` |
| Session processor | `session/processor.ts` | 122, 473, 500 | `yield* snapshot.track()` |
| VCS internal | `project/vcs.ts` | 368, 375 | `yield* track(...)`, `yield* diffAgainstRef(...)` |

**Verdict:** All callers use `yield*` with Effect services. Making `emptyPatch` async and propagating through `nativePatch` → `patchForItem` → `files` → `diffAgainstRef` / `track` works transparently within Effect's async model.

---

## Architecture Decision: `async`/`await` vs `Effect.tryPromise`

**Binding rule:** Use `async`/`await` inside `Effect.gen` / `Effect.fn` callbacks for all files in this plan.

**Rationale:**
- The existing codebase uses both patterns, but the files being modified (`tool/write.ts`, `tool/edit.ts`, `tool/apply_patch.ts`, `snapshot/index.ts`, `file/index.ts`, `project/vcs.ts`) already use `async`/`await` inside `Effect.gen` in adjacent code paths.
- `Effect.tryPromise` is preferred for explicit error-channel handling when wrapping non-Effect async APIs. Here, the async functions (`diffLines`, `createTwoFilesPatch`, `structuredPatch`) are already Effect-aware (they return `Promise<T>` and are called from within `Effect.fn` callbacks). `async`/`await` is more readable for sequential calls and matches the surrounding style.
- WASM init failures (`ensureWasm()` rejection) will surface as thrown errors inside the `async` callback, which Effect captures into the error channel automatically.

---

## Error-Handling Consideration

The now-async WASM functions can reject if `ensureWasm()` fails (e.g., corrupted WASM binary, missing file). This is a **new failure mode** compared to the previous sync calls.

**Handling strategy:**
- Inside `Effect.fn` / `Effect.gen` callbacks, a rejected `await` propagates as an effect failure automatically — no explicit `try`/`catch` needed unless we want to recover.
- For the tool layer (`write.ts`, `edit.ts`, `apply_patch.ts`): a WASM init failure should surface as a tool execution error. The existing `.pipe(Effect.orDie)` on tools will convert it to a defect, which the agent loop handles with an error message. **No change needed.**
- For the service layer (`snapshot/index.ts`, `file/index.ts`, `vcs.ts`): a WASM init failure should surface as a service error. Callers already handle `Effect.fail` from these services. **No change needed.**
- If graceful degradation is desired (e.g., fall back to `diff` npm package), that would require `Effect.catch` at each call site — **defer this decision**; the current plan treats WASM init failure as a hard error.

---

## Dependency Cleanup Note

The `diff` npm package in `packages/diff-wasm/package.json` is **still required** because `parsePatch` and `applyPatch` delegate to `jsParsePatch` and `jsApplyPatch` from `diff`. The async functions (`diffLines`, `createTwoFilesPatch`, `structuredPatch`) are fully WASM-native and do **not** delegate to `diff` internally.

**Decision:** Keep `"diff": "catalog:"` in `packages/diff-wasm/package.json` dependencies. Do not remove.

---

## Files to Modify

### Tier 1 — Leaf tool consumers (no upstream callers within the repo)

These are the lowest-level callers. Fixing them first prevents cascading rework.

#### 1. `packages/opencode/src/tool/write.ts`

- **What:** `createTwoFilesPatch` call at line 59 inside `WriteTool.execute`.
- **Change:** Make the `Effect.gen` callback `async` and `await` the `createTwoFilesPatch(...)` call before passing `diff` to `ctx.ask`.
- **Why:** `diff` is used in permission metadata and `todo.autoclose`; both need the resolved string, not a Promise.

#### 2. `packages/opencode/src/tool/edit.ts`

- **What:** Three `createTwoFilesPatch` calls (lines 99, 137, 164) and one `diffLines` call (line 176) inside `EditTool.execute`.
- **Change:** Make the `Effect.gen` callback `async` and `await` all four calls. The `diffLines` loop (lines 176–179) must iterate over the resolved array.
- **Why:** `diff` is used for permission ask, `todo.autoclose`, and `filediff` metadata. All three `createTwoFilesPatch` calls produce the same `diff` variable that is reused downstream.

#### 3. `packages/opencode/src/tool/apply_patch.ts`

- **What:** `createTwoFilesPatch` calls in the `"add"` branch (line 106), `"update"` branch (lines 159, 211), and `diffLines` calls in `"add"` (line 110) and `"update"` (line 163) branches inside `ApplyPatchTool.execute`.
- **Change:** Make the inner `run` Effect.fn callback `async` and `await` each `createTwoFilesPatch` and `diffLines` call. The `diff` and `additions`/`deletions` values are consumed immediately after each call, so sequential `await` is natural.
- **Why:** `diff` feeds `fileChanges` array and `totalDiff`; `additions`/`deletions` feed per-file metadata.

### Tier 2 — Service-layer consumers (called by Tier 1 indirectly or by other services)

#### 4. `packages/opencode/src/snapshot/index.ts`

- **What:** `structuredPatch` call at line 738 inside `diffFull`'s inner `patch` helper: `formatPatch(structuredPatch(...))`.
- **Change:** Make the `patch` helper `async` and `await structuredPatch(...)`, then pass the resolved result to `formatPatch(...)`. Because `patch` is called inside a `for` loop over `rows` (line 740–755), the loop body must `await` it. The enclosing `diffFull` Effect.fn is already `async`-compatible (Effect.gen), so propagation stops here.
- **Why:** `patch()` result feeds `result.push({ patch: ... })` which becomes the `FileDiff[]` returned to callers.
- **Blast radius:** Callers (`session/summary.ts:99,110`, `session/session.ts:687`) use `yield* snapshot.diffFull(...)` — Effect absorbs the async change transparently. No caller changes needed.

#### 5. `packages/opencode/src/file/index.ts`

- **What:** `structuredPatch` call at line 562 inside `File.read` Effect.fn: `const patch = structuredPatch(...)` followed by `formatPatch(patch)` at line 566.
- **Change:** Make the `read` Effect.fn callback `async` and `await structuredPatch(...)`, then `formatPatch(resolvedPatch)`. The `patch` and `diff` fields on the returned `Content` object need the resolved values.
- **Why:** `read` is a core service method; callers expect `Content.patch` and `Content.diff` to be populated strings.
- **Blast radius:** Callers (`server/routes/instance/httpapi/handlers/file.ts:10`, `project/bootstrap.ts:27`, `cli/cmd/debug/file.ts:33`) use `yield* File.Service.use(...)` — Effect absorbs the async change transparently. No caller changes needed.

#### 6. `packages/opencode/src/project/vcs.ts`

- **What:** `structuredPatch` call inside `emptyPatch` (line 17): `formatPatch(structuredPatch(...))`. `emptyPatch` is called from `nativePatch` (line 129), which is called from `patchForItem` (line 151), which is called from `files` (line 168), which is called from `diffAgainstRef` (line 203) and `track` (line 208).
- **Change:** Make `emptyPatch` `async` and `await structuredPatch(...)`. Propagate `async` through `nativePatch` → `patchForItem` → `files` → `diffAgainstRef` / `track`. All of these are already inside `Effect.fnUntraced` / `Effect.gen` blocks, so `await` works naturally.
- **Why:** `emptyPatch` produces the fallback patch string when native git patch is truncated or unavailable. The returned string flows into `FileDiff.patch` for the VCS diff UI.
- **Blast radius:** Callers (`session/revert.ts:75`, `session/processor.ts:122,473,500`, `project/vcs.ts:368,375`) use `yield*` with Effect services. The async change propagates transparently. No caller changes needed.

### Tier 3 — UI consumer (highest-level caller)

#### 7. `packages/ui/src/components/session-diff.ts`

- **What:** `structuredPatch` call at lines 79–87 inside the `patch` function, which is called by `normalize` (line 102). `normalize` is exported and consumed by UI components.
- **Change:** Make `patch` `async` and `await structuredPatch(...)`. Make `normalize` `async` and `await patch(diff)`. All callers of `normalize` in the UI layer must be updated to `await` it.
- **Why:** This is the user-facing diff viewer. The async change bubbles up to every component that renders file diffs.

**Known callers of `normalize()` (must be updated):**

| Caller | File | Line |
|--------|------|------|
| Session turn diffs | `packages/ui/src/components/session-turn-diffs.tsx` | 61 |
| Session review | `packages/ui/src/components/session-review.tsx` | 190 |
| Apply patch file | `packages/ui/src/components/apply-patch-file.ts` | 63 |

**Note:** The `normalize()` in `packages/ui/src/theme/theme-storage.ts` (line 8) is a different function with the same name — it normalizes theme IDs, not diffs. It does **not** need updating.

---

## No-change files (sync API still valid)

| File | Reason |
|---|---|
| `packages/web/src/components/share/content-diff.tsx` | Uses `parsePatch` only — still sync |
| `packages/opencode/src/cli/cmd/tui/util/revert-diff.ts` | Uses `parsePatch` only — still sync |
| `packages/opencode/src/acp/message-replay.ts` | Uses `applyPatch` only — still sync |

---

## Order of Operations

1. **Prerequisite verification** (above): Confirm WASM package changes and blast radius.
2. **Tier 1 first** (`write.ts`, `edit.ts`, `apply_patch.ts`): These are the most isolated changes. Each file's `Effect.gen` callback becomes `async` with `await` on the diff-wasm calls. No other repo files depend on these internals.
3. **Tier 2 next** (`snapshot/index.ts`, `file/index.ts`, `vcs.ts`): These service methods are called by higher-level code but the async boundary stops at the service interface. Upstream callers already use `yield*` (Effect) or `await` (async), so they absorb the change transparently.
4. **Tier 3 last** (`ui/src/components/session-diff.ts` + its 3 callers): This is the highest-level consumer. `normalize()` becomes async, and all 3 known call sites must `await` it.
5. **Dependency cleanup** (after all code changes pass): Verify whether `diff` can be removed from `packages/diff-wasm/package.json`. (Decision: keep it — `parsePatch` and `applyPatch` still delegate to `diff`.)

---

## Test Strategy

### Per-package test runs

```bash
# diff-wasm package (verify existing async tests still pass)
cd packages/diff-wasm && bun test

# opencode package (tool tests, snapshot tests, file tests, vcs tests, TUI tests)
cd packages/opencode && bun test test/tool/write.test.ts
cd packages/opencode && bun test test/tool/edit.test.ts
cd packages/opencode && bun test test/tool/apply_patch.test.ts
cd packages/opencode && bun test test/snapshot/snapshot.test.ts
cd packages/opencode && bun test test/cli/tui/revert-diff.test.ts

# ui package (session-diff consumers)
cd packages/ui && bun test src/components/session-diff.test.ts
cd packages/ui && bun test src/components/session-turn-diffs.test.ts
cd packages/ui && bun test src/components/session-review.test.ts
cd packages/ui && bun test src/components/apply-patch-file.test.ts
```

### Full suite

```bash
cd packages/opencode && bun test
```

### Typecheck

```bash
cd packages/opencode && bun typecheck
cd packages/ui && bun typecheck
cd packages/web && bun typecheck
```

### Key assertions

- Tool tests (`write.test.ts`, `edit.test.ts`, `apply_patch.test.ts`) verify that diffs are computed correctly and permission metadata contains the expected diff strings.
- Snapshot tests verify `diffFull` returns populated `patch` fields.
- File service tests verify `read` returns `Content.patch` and `Content.diff` for modified files.
- VCS tests verify `diff` returns `FileDiff` with populated `patch` strings.
- UI tests verify diff rendering still works with async `normalize()`.

---

## Open Questions

1. **WASM init failure handling:** The plan treats WASM init failure as a hard error (propagates through Effect's error channel). If graceful degradation (fallback to `diff` npm package) is desired, it would require `Effect.catch` at each call site — defer this decision unless users report WASM init failures in the field.
2. **`session-diff.ts` `patch()` function:** The `patch()` function is also called internally by `normalize()`. If any other code imports `patch()` directly (unlikely — it's not exported), those call sites need updating too.
3. **UI test coverage:** The UI package tests for `session-turn-diffs`, `session-review`, and `apply-patch-file` may not exist or may be integration-level. If they don't exist, add them or verify manually.
