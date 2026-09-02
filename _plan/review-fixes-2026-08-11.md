# Review Fixes — Implementation Plan

**Date:** 2026-08-11  
**Scope:** Minimal, focused fixes for 13 verified code review issues across 8 files. No breaking changes.

---

## Goal

Address verified code review findings in the opencode-personal repository with minimal, surgical changes that preserve existing behavior. Fixes are grouped by file to keep diffs reviewable and to respect the project's "split by responsibility, not by layer" style.

---

## Steps

### 1. `packages/opencode/src/tool/webfetch.ts` — SSRF + IPv6 coverage

**What:** Fix DNS rebinding and incomplete private-IP detection.  
**Why:** The DNS guard at `:71-78` checks the resolved IP, but `HttpClientRequest.get(params.url)` at `:117` re-resolves DNS via the HTTP client, bypassing the check. Additionally, `isPrivateIPv6` at `:30-33` misses several private/reserved IPv6 ranges.

**Changes:**
- Replace `HttpClientRequest.get(params.url)` with a pinned request:
  - Build a new URL using `resolvedAddress.address` as the host (preserving scheme, port, path).
  - Set the original hostname in the `Host` header so virtual-hosting targets still work.
  - Pass the pinned URL to `HttpClientRequest.get(pinnedUrl)`.
- Extend `isPrivateIPv6` to cover:
  - `::ffff:0:0/96` (IPv4-mapped IPv6 with `0` in the IPv4 part — currently only `::ffff:` + full IPv4 is handled via `isPrivateIPv4`).
  - `100::/8` (discard-only).
  - `2001:db8::/32` (documentation).
- Update `isPrivateIP` so IPv4-mapped addresses that fall through to the IPv6 branch are still classified correctly.

**Test considerations:**
- Unit-test `isPrivateIPv6` with the new prefixes.
- Unit-test `isPrivateIP` for `::ffff:0:0.0.0.0`, `::ffff:10.0.0.1`, `100::1`, `2001:db8::1`.
- Integration-test the pinned URL flow with a mock DNS resolver that returns a private IP for the hostname but a public IP for the second resolution (simulated via fetch mock).

---

### 2. `packages/opencode/src/tool/apply_patch.ts` — move_path boundary guard

**What:** Apply the directory-escape guard to `hunk.move_path`.  
**Why:** A malicious or hallucinated `move_path` can escape the project directory because the `startsWith` guard at `:97` only applies to `hunk.path`. The `path.resolve()` at `:96` already uses `AppFileSystem.resolve` (symlink resolution is already done), but `movePath` at `:203` lacks any containment check.

**Changes:**
- After computing `movePath` at `:203`, apply `startsWith(instance.directory + path.sep)` before proceeding. If it escapes, push to `failedHunks` and `break`.

**Dependencies:** None.  
**Test considerations:**
- Add a test case where `hunk.path` is inside the project but `hunk.move_path` escapes via `../`.

---

### 3. `packages/opencode/src/tool/write.ts` — symlink path hardening + boundary check

**What:** Add missing `startsWith` containment check and resolve symlinks on the final file path.  
**Why:** `write.ts` uses `path.join()` and has NO `startsWith` guard at all, unlike `edit.ts` which already has both `AppFileSystem.resolve` (symlink resolution) and the `startsWith` guard at `:82-85`. A symlink inside the project can bypass a missing guard, and paths outside the project are currently accepted unconditionally.

**Changes:**
- After computing `filePath` at `:47-49`, resolve symlinks via `AppFileSystem.resolve(path.resolve(...))` (matching `edit.ts` pattern).
- Add `startsWith(instance.directory + path.sep)` containment check after resolution. If it escapes, fail the write.

**Dependencies:** None.  
**Test considerations:**
- Create a symlink inside the project pointing outside, then verify `write.ts` rejects the path.
- Verify that paths outside the project without symlinks are also rejected.

---

### 4. `packages/opencode/src/tool/task.ts` — empty-string fallback + dead code removal + style cleanup

**What:** Fix empty-string fallback, remove dead `EffectBridge` code, style cleanup.  
**Why:** The text fallback at `:206` uses `??`, which does not trigger on empty strings. `EffectBridge.make()` at `:160` and its `runCancel` binding are dead code — line `:169` uses `Effect.runPromise(cancel)` directly. The `result.parts.length` check should be integrated here before the fallback to differentiate "had parts but no text" from "zero parts".

**Changes:**
- Keep `Effect.runPromise(cancel).catch(...)` at `:169` (matches V2's pattern at `session.ts:544`, preserves V1/V2 parity).
- Remove the dead `EffectBridge.make()` call at `:160` and its unused import.
- Change `text ?? "Subagent completed..."` at `:206` to `text || "Subagent completed..."` so empty strings fall back. Before the fallback, check `result.parts.length === 0` to differentiate "had parts but no text" from "zero parts":
  - `result.parts.length === 0` → fallback message: `"Subagent produced no output parts."`
  - `result.parts.length > 0` but no text part → fallback message: `"Subagent completed without producing a text response."` (existing message, preserved)
- Convert the `let depth` / `while` loop at `:116-127` to an early-return recursive helper or a `for` loop with `const` to satisfy the style guide.

**Dependencies:** Step 6 (constant rename) must be done first if the error message references the constant name.  
**Test considerations:**
- Verify abort cancellation still works end-to-end.
- Verify empty-string text falls back correctly.
- Verify `result.parts.length === 0` path produces `"Subagent produced no output parts."`.
- Verify `result.parts.length > 0` with no text part produces `"Subagent completed without producing a text response."`.

---

### 5. `packages/opencode/src/v2/session.ts` — empty-string fallback + style cleanup

**What:** Fix empty-string fallback, remove `let` in depth check.  
**Why:** The text fallback at `:575` has the same `??` issue. The depth loop at `:507-508` uses `let`. The `assistant.content` check should be integrated here before the fallback to differentiate "had parts but no text" from "zero parts".

**Changes:**
- Change the depth error at `:512` from `Effect.die()` to `Effect.fail()` (matching V1). This is the chosen direction because V1 is the established pattern and `Effect.fail()` + `Effect.orDie` on the caller is the existing idiom.
- Change `textPart?.text ?? "Subagent completed..."` at `:575` to `textPart?.text || "Subagent completed..."`. Before the fallback, check `assistant.content.length === 0` to differentiate "had parts but no text" from "zero parts":
  - `assistant.content.length === 0` → fallback message: `"Subagent produced no output parts."`
  - `assistant.content.length > 0` but no text part → fallback message: `"Subagent completed without producing a text response."` (existing message, preserved)
- Convert the `let depth` / `while` loop at `:507-518` to a `for` loop or recursive helper using `const`.

**Dependencies:** None — this step aligns V2 to V1 independently.  
**Test considerations:**
- Run `test/v2/session.test.ts` to confirm subagent depth behavior is unchanged.
- Verify empty-string text falls back correctly.
- Verify `assistant.content.length === 0` path produces `"Subagent produced no output parts."`.
- Verify `assistant.content.length > 0` with no text part produces `"Subagent completed without producing a text response."`.

---

### 6. `packages/opencode/src/agent/subagent-permissions.ts` — naming clarity

**What:** Rename `MAX_SUBAGENT_DEPTH` to clarify semantics without changing behavior.  
**Why:** The constant is `3`, and the check `depth >= MAX_SUBAGENT_DEPTH` allows 2 nesting levels (parent → child). The name implies "max depth = 3" but the runtime behavior is "max nesting levels = 2". Renaming to `MAX_SUBAGENT_NESTING_LEVELS` with the same value `3` preserves the existing behavior (2 nesting levels allowed) while making the semantics clearer.

**Changes:**
- Rename `MAX_SUBAGENT_DEPTH` to `MAX_SUBAGENT_NESTING_LEVELS = 3` (value unchanged, just a rename).
- Update all references in `task.ts` and `v2/session.ts`.
- Update the error message to say "nesting levels" instead of "depth" for clarity.
- Update `packages/opencode/src/v2/AGENTS.md` if it references the old constant name.

**Dependencies:** None, but must be done before Steps 4 and 5 if they reference the constant name.  
**Test considerations:**
- Update any tests that assert on the exact error message string.

---

### 7. `packages/diff-wasm/src/index.ts` — WASM retry + cast hygiene

**What:** Stop retrying WASM init forever, improve `as any` casts, differentiate fallback paths.  
**Why:** `wasmReady = null` on error (`:28`) causes every subsequent call to retry import + init, which is wasteful and can mask persistent failures. The `as any` casts at `:132` and `:144` bypass type safety without explanation.

**Changes:**
- Introduce a `wasmFailed = false` flag. On first failure, set `wasmFailed = true` and keep `wasmReady` as the rejected promise. Subsequent calls skip `ensureWasm()` entirely and go straight to the JS fallback.
- Replace `jsFormatPatch(diff as any)` with `jsFormatPatch(diff as unknown as Parameters<typeof jsFormatPatch>[0])` plus a comment: `// ParsedDiff is structurally compatible with diff's internal format`.
- Replace `jsApplyPatch(source, patch as any, options)` with the same `as unknown as` pattern.

**Dependencies:** None.  
**Test considerations:**
- Verify that after a simulated WASM init failure, the second call does not attempt to re-import.

---

### 8. `packages/opencode/src/permission/index.ts` — comment accuracy

**What:** Update the stale race-condition comment to clarify JS single-threading safety.  
**Why:** The current comment at `:270-273` already says: "Build a snapshot for the DB write instead of mutating the shared `approved` array in place... so concurrent calls cannot interleave pushes." The plan's proposed rewrite is only marginally different. The comment should clarify that JavaScript is single-threaded, so the snapshot is an optimization for atomic DB writes and to prevent mid-transaction mutation by concurrent Effect yields (which can interleave via async boundaries), not a traditional race-condition guard.

**Changes:**
- Rewrite the comment to state: "Build a snapshot for the DB write so the upsert is atomic and so the in-memory `approved` array is not mutated mid-transaction by concurrent Effect yields. JavaScript is single-threaded, so this is not a traditional race-condition guard, but Effect's cooperative scheduling can interleave yields between push and upsert."

**Dependencies:** None.  
**Test considerations:** None (comment-only change).

---

## Architecture Decisions

### SSRF Pinning Strategy
**Chosen:** Pin the resolved IP in the request URL and set the `Host` header to the original hostname.  
**Rationale:** Minimal change, no new dependencies, preserves virtual-hosting behavior.  
**Alternatives considered:**
- Custom DNS resolver in Effect HTTP client — more invasive, requires deeper changes to `HttpClient` layer plumbing.
- Proxy through a local resolver — adds a runtime dependency and operational complexity.

### Depth Error Handling Alignment
**Chosen:** Align V2 to V1 (`Effect.fail()` + `Effect.orDie` on caller).  
**Rationale:** V1 is the established pattern across the codebase. `Effect.die()` in V2 was an inconsistency, not a deliberate design choice.  
**Alternatives considered:**
- Change V1 to `Effect.die()` — would affect more callers and test fixtures.

### Symlink Resolution Approach
**Chosen:** Use `AppFileSystem.resolve(path.resolve(...))` (matching the existing `edit.ts` pattern).  
**Rationale:** `AppFileSystem.resolve` wraps `realpathSync` with an ENOENT-safe fallback for non-existent paths, so it already handles symlink resolution for existing paths without additional plumbing.  
**Alternatives considered:**
- Call `fs.realpathSync` directly — redundant since `AppFileSystem.resolve` already wraps it; would require duplicating the ENOENT fallback logic.
- Reject all paths containing symlinks at the project root — too restrictive for legitimate monorepo layouts.

### WASM Retry Policy
**Chosen:** Permanent failure flag after first init failure.  
**Rationale:** WASM init failures are almost always structural (missing file, bad build). Retrying on every call adds latency and I/O with no benefit.  
**Alternatives considered:**
- Exponential backoff retry — adds complexity for a case that should never recover at runtime.

---

## Open Questions

1. **SSRF pinning and proxies:** If the user's environment routes traffic through an HTTP proxy, `HttpClientRequest.setUrl` with a pinned IP may bypass proxy hostname rules. Should we detect proxy config and skip pinning, or is this out of scope for the tool's threat model?
2. **`write.ts` missing boundary check:** The current `write.ts` has NO `startsWith` guard at all. Is this intentional (trusting the caller to pass absolute paths inside the project), or a bug? The fix adds the guard, but if there are legitimate use-cases for writing outside the project via `write.ts`, we may need a permission-based opt-out.

---

## File Change Summary

| File | Issues | Lines touched |
|------|--------|---------------|
| `packages/opencode/src/tool/webfetch.ts` | #1, #4 | `:30-33`, `:71-78`, `:117` |
| `packages/opencode/src/tool/apply_patch.ts` | #3, #6 | `:203` |
| `packages/opencode/src/tool/write.ts` | #6 | `:47-49` |
| `packages/opencode/src/tool/task.ts` | #2, #5, #7, #10 | `:116-127`, `:160-169`, `:206` |
| `packages/opencode/src/v2/session.ts` | #5, #7, #10 | `:507-518`, `:512`, `:575` |
| `packages/opencode/src/agent/subagent-permissions.ts` | #9 | `:4` |
| `packages/diff-wasm/src/index.ts` | #8, #11, #12 | `:17-33`, `:132-145` |
| `packages/opencode/src/permission/index.ts` | #13 | `:270-273` |

---

## Execution Order

1. `subagent-permissions.ts` rename (#9) — unblocks Steps 4 and 5.
2. `webfetch.ts` (#1, #4) — independent.
3. `apply_patch.ts` (#3, #6) — independent.
4. `write.ts` (#6) — independent, small.
5. `task.ts` (#2, #5, #7, #10) — depends on Step 1.
6. `v2/session.ts` (#5, #7, #10) — depends on Step 1.
7. `diff-wasm/src/index.ts` (#8, #11, #12) — independent.
8. `permission/index.ts` (#13) — independent, comment-only.
