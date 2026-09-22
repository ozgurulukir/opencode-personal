# Implementation Plan: Fix Codebase Review Issues

**Date:** 2026-08-11  

**Status:** ✅ EXECUTED (reviewed 2026-09-22) — landed in `aa27a80` (SSRF guard, symlink resolve, permission snapshot, ripgrep regex-error handling at `file/ripgrep.ts:407`, ReDoS cap, malformed-JSON pass-through, wildcard doc) plus `a52a6b8` / PR #138 (SSRF hardening).
**Scope:** Security and correctness fixes for `packages/opencode`  
**Priority order:** Critical → Major → Minor → Nit

---

## Goal

Address 8 issues identified in the 2026-08-11 codebase review: 1 critical SSRF vulnerability, 3 major security/correctness bugs (symlink bypass, permission race, ripgrep error masking), 3 minor performance/robustness issues (double diff, LLM regex, JSON.parse), and 1 nit for documentation. All fixes follow repo conventions: no semicolons, 120 char printWidth, prefer `const`, avoid `try/catch` where possible, use Bun APIs when possible.

---

## Steps

### 1. Critical — Add SSRF guard to `webfetch.ts`

**File:** `packages/opencode/src/tool/webfetch.ts`  
**Lines:** 33–35 (scheme check), 74 (fetch execution)

**What to change:**
- After the scheme check (line 33–35), parse the URL and resolve the hostname to an IP address using `dns.lookup()` or `dns.promises.lookup()`.
- Reject requests to private/reserved IP ranges before fetching:
  - Loopback: `127.0.0.0/8`, `::1`, `localhost`
  - Link-local: `169.254.0.0/16`, `fe80::/10`
  - Private: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fd00::/8`
  - Cloud metadata: `169.254.169.254`
- Return a clear error message like `"SSRF guard: requests to private/internal IPs are not allowed"`.
- Use `dns.lookup` (callback-style) wrapped in `Effect.tryPromise`, or `Effect.tryPromise` with `dns.promises.lookup`.

**Why it matters:**  
A compromised or hallucinating LLM can probe internal services, cloud metadata endpoints (AWS IMDS at `169.254.169.254`), and localhost services. The current `always: ["*"]` permission ask never blocks, so the only defense is URL validation.

**Test considerations:**
- Add tests in `packages/opencode/test/tool/webfetch.test.ts` that verify rejection of `http://127.0.0.1/`, `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.1/`, `http://192.168.1.1/`, `http://[::1]/`.
- Add a test that verifies legitimate external URLs still pass.
- Use `Effect.catch` to assert the error message in tests.

---

### 2. Major — Resolve symlinks before `assertExternalDirectoryEffect` in `apply_patch.ts` and `edit.ts`

**Files:**
- `packages/opencode/src/tool/apply_patch.ts` — lines 96, 172
- `packages/opencode/src/tool/edit.ts` — lines 82–85

**What to change:**
- Replace `path.resolve(instance.directory, hunk.path)` with `AppFileSystem.resolve(path.resolve(instance.directory, hunk.path))` in `apply_patch.ts` (lines 96 and 172).
- Replace `path.join(instance.directory, params.filePath)` with `AppFileSystem.resolve(path.resolve(instance.directory, params.filePath))` in `edit.ts` (lines 82–84).
- `AppFileSystem.resolve` calls `realpathSync` which resolves symlinks. For non-existent paths it returns the normalized path (acceptable — the permission check still works on the resolved parent directory).
- Import `AppFileSystem` from `@opencode-ai/core/filesystem` if not already imported.

**Why it matters:**  
`path.resolve` does not resolve symlinks. A symlink inside the project pointing outside (e.g., `project/evil -> /etc`) bypasses the external-directory permission prompt and allows editing/reading files outside the project boundary.

**Test considerations:**
- In `apply_patch.test.ts` and `edit.test.ts`, create a symlink inside the temp project directory that points outside, then verify the tool triggers the external-directory permission prompt (or is blocked).
- Use `fs.symlinkSync` in test setup. Clean up in `afterEach`.

---

### 3. Major — Fix permission race in `reply("always")`

**File:** `packages/opencode/src/permission/index.ts`  
**Lines:** 270–287

**What to change:**
- Build a new array for the DB write instead of mutating the shared `approved` array in place.
- Replace the in-place `approved.push(...)` loop with:
  ```ts
  const newRules = existing.info.always.map((pattern) => ({
    permission: existing.info.permission,
    pattern,
    action: "allow",
  }))
  const snapshot = [...approved, ...newRules]
  db.insert(PermissionTable)
    .values({ project_id: ctx.project.id, data: snapshot })
    .onConflictDoUpdate({ target: PermissionTable.project_id, set: { data: snapshot } })
    .run()
  ```
- Keep the in-memory `approved.push(...)` if needed for the local binding, but do NOT use the mutated array for the DB write. The comment at lines 270–273 claims in-place mutation is required to maintain the link to `state.approved`, but the DB write is the actual persistence boundary — the race happens because two fibers can interleave their pushes before either writes.
- Alternatively, wrap the push + DB write in a serialized critical section (e.g., a mutex), but the copy-on-write approach is simpler and sufficient.

**Why it matters:**  
Concurrent `reply("always")` calls can interleave their `approved.push(...)` operations. The database upsert reads `approved` after the push, so two racing replies can produce a merged ruleset containing entries from both, even if they were for different patterns. This leaks permission rules across concurrent approvals.

**Test considerations:**
- Add a test in `permission-task.test.ts` or a new `permission-reply.test.ts` that fires two concurrent `reply("always")` calls for different patterns and verifies the persisted ruleset contains only the expected entries for each call.
- Use `Effect.fork` + `Effect.yieldNow` to ensure both replies register concurrently before either completes.

---

### 4. Major — Inspect ripgrep stderr for regex parse errors

**File:** `packages/opencode/src/file/ripgrep.ts`  
**Lines:** 403–410

**What to change:**
- After collecting `stderr` (line 397), inspect it before deciding whether exit code 2 means "partial" or "regex error".
- Ripgrep regex parse errors typically contain strings like `"regex parse error"`, `"invalid regex"`, or `"error parsing regex"`.
- If `code === 2` and `stderr` contains regex parse error markers, return `Effect.fail(error(stderr, code))` instead of `{ items: code === 1 ? [] : items, partial: code === 2 }`.
- If `code === 2` and stderr does NOT contain regex errors, keep the existing `partial: true` behavior (inaccessible paths).
- Example logic:
  ```ts
  const isRegexError = /regex parse error|invalid regex|error parsing regex/i.test(stderr)
  if (code === 2 && isRegexError) {
    return yield* Effect.fail(error(stderr, code))
  }
  ```

**Why it matters:**  
Ripgrep uses exit code 2 for both regex parse failures and inaccessible paths. The current code treats all code-2 exits as `partial: true` and discards stderr. Invalid regexes from the LLM surface as benign partial results instead of a clear error, making debugging impossible.

**Test considerations:**
- Add a test in `packages/opencode/test/file/ripgrep.test.ts` that passes an invalid regex pattern and asserts the result is a failure (not `partial: true`).
- Add a test that verifies inaccessible paths still return `partial: true` (simulate by passing a directory with no read permissions, or mock the spawn).

---

### 5. Minor — Compute diff once in `edit.ts`

**File:** `packages/opencode/src/tool/edit.ts`  
**Lines:** 138–145, 165–172

**What to change:**
- For the normal edit path (`params.oldString !== ""`), compute `createTwoFilesPatch` once before the permission ask (line 138–145), store it in `diff`, and reuse the same `diff` variable after the write instead of recomputing at lines 165–172.
- Remove the second `createTwoFilesPatch` call at lines 165–172.
- The `diff` variable is already declared at line 87 and used for the permission prompt metadata. After the write, the same `diff` string is still valid for the result.

**Why it matters:**  
`createTwoFilesPatch` is called twice with identical arguments on every edit. This is unnecessary CPU work, especially for large files.

**Test considerations:**
- Existing `edit.test.ts` tests should continue to pass. The diff output is identical; only the computation count changes.
- Add a test that verifies the `diff` in the result matches the `diff` shown in the permission prompt metadata.

---

### 6. Minor — Cap LLM-generated regex in `edit.replacer.ts`

**File:** `packages/opencode/src/tool/edit.replacer.ts`  
**Lines:** 197–208

**What to change:**
- Before constructing the regex, check the word count. If it exceeds a threshold (e.g., `MAX_REGEX_WORDS = 20`), fall back to literal substring matching using `includes` + `indexOf` instead of building a `RegExp`.
- Alternatively, cap the number of words participating in the regex and join the rest as literal text.
- Example:
  ```ts
  const words = find.trim().split(/\s+/)
  if (words.length === 0) return
  if (words.length > MAX_REGEX_WORDS) {
    // Fall back to literal match on the first few words
    const literal = words.slice(0, MAX_REGEX_WORDS).join(" ")
    const idx = line.indexOf(literal)
    if (idx >= 0) yield line.slice(idx, idx + literal.length)
    return
  }
  const pattern = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")
  // ... existing regex logic
  ```
- Define `MAX_REGEX_WORDS` as a module-level constant (e.g., `20`).

**Why it matters:**  
Extremely long find strings with many words produce large regexes that could cause high CPU during matching. The LLM may generate pathological inputs.

**Test considerations:**
- Add a test in `edit.replacer.test.ts` with a find string exceeding the threshold and verify it falls back to literal matching without throwing.
- Add a test with a normal-length find string to verify regex matching still works.

---

### 7. Minor — Wrap `JSON.parse` in `provider.ts`

**File:** `packages/opencode/src/provider/provider.ts`  
**Line:** 1441

**What to change:**
- Wrap the `JSON.parse(opts.body as string)` call in a `try/catch` (or `Effect.catch` if inside an Effect).
- If parsing fails, log the error and fall back to passing `opts.body` through unmodified.
- Example:
  ```ts
  let body: Record<string, unknown>
  try {
    body = JSON.parse(opts.body as string)
  } catch {
    // Malformed JSON — pass through unmodified
    return fetchFn(input, { ...opts, timeout: false })
  }
  ```
- Note: The repo prefers avoiding `try/catch`, but this is a synchronous parse inside an async function where `Effect.tryPromise` would be awkward. A `try/catch` here is acceptable because the fallback is a direct return.

**Why it matters:**  
If `opts.body` is malformed JSON (e.g., already-stringified by a previous transform, or malformed LLM output), `JSON.parse` throws synchronously and crashes the fetch. The body should be passed through unmodified if it cannot be parsed.

**Test considerations:**
- Add a test in `provider.test.ts` that passes a malformed JSON body and verifies the fetch still succeeds (body passed through).
- Add a test that verifies valid JSON bodies still have `id` fields stripped correctly.

---

### 8. Nit — Document wildcard backslash normalization

**File:** `packages/opencode/src/util/wildcard.ts`  
**Lines:** 6–7

**What to change:**
- Add a JSDoc comment to the `match` function explaining that backslashes are normalized to forward slashes on all platforms, making `\` and `/` interchangeable in patterns.
- Document that this is intentional for Windows path compatibility but also affects non-path patterns.

**Why it matters:**  
The behavior is user-friendly for Windows paths but can surprise users who expect backslashes to be literal in patterns. Documenting it prevents confusion.

**Test considerations:**
- No new tests needed. Existing `wildcard.test.ts` already covers the behavior implicitly.

---

## Architecture Decisions

### SSRF Guard Implementation
- **Chosen approach:** Resolve hostname via `dns.lookup` and reject private IPs before fetching.
- **Rationale:** This is the standard SSRF defense. It blocks loopback, link-local, private, and cloud metadata ranges regardless of DNS rebinding.
- **Alternatives considered:**
  - Blocklist of hostnames (`localhost`, `*.local`): insufficient because attackers can use IPs directly.
  - Allowlist of domains: too restrictive for a general-purpose fetch tool.
  - Disable `file://` and `ftp://` schemes: already done (scheme check exists), but doesn't block HTTP to internal IPs.
- **Trade-offs:** `dns.lookup` adds ~1–5ms latency per fetch. This is acceptable for a tool that already does network I/O. IPv6 is handled by checking `::1` and `fd00::/8`.

### Symlink Resolution
- **Chosen approach:** Use `AppFileSystem.resolve` (which calls `realpathSync`) before `assertExternalDirectoryEffect`.
- **Rationale:** `AppFileSystem.resolve` is the repo's standard symlink-resolving path helper. It handles Windows and non-existent paths gracefully.
- **Alternatives considered:**
  - Reject symlinks entirely: too aggressive — legitimate projects use symlinks.
  - Add symlink check inside `assertExternalDirectoryEffect`: better long-term, but the immediate fix is at the call site to minimize blast radius.
- **Trade-offs:** `realpathSync` on non-existent paths returns the normalized path, which may not fully resolve symlinks in parent directories. This is acceptable because the permission prompt still guards the resolved parent directory.

### Permission Race Fix
- **Chosen approach:** Copy-on-write (`[...approved, ...newRules]`) for the DB write.
- **Rationale:** Simpler than introducing a mutex. The in-memory `approved` array can still be mutated for local binding consistency, but the DB write uses a snapshot.
- **Alternatives considered:**
  - Serialize with a mutex: more complex, requires new Effect dependency.
  - Keep in-place mutation: preserves the existing comment's intent but doesn't fix the race.
- **Trade-offs:** The local `approved` binding still accumulates rules from concurrent calls (matching the original comment's intent), but the DB write is atomic per-call. This means in-memory state may diverge from DB state under extreme concurrency, but the divergence is bounded and self-healing on next read.

### Ripgrep Error Masking
- **Chosen approach:** Inspect stderr for regex parse error markers when exit code is 2.
- **Rationale:** Ripgrep does not distinguish regex errors from path errors via exit code alone. Stderr inspection is the only reliable way.
- **Alternatives considered:**
  - Always treat code 2 as failure: breaks legitimate use cases where some paths are inaccessible.
  - Parse stderr JSON: ripgrep stderr is plain text, not JSON.
- **Trade-offs:** The regex error marker strings are based on ripgrep's current English output. If ripgrep changes its error messages, this may need updating. The marker set is small and stable.

---

## Open Questions

1. **SSRF: DNS rebinding protection** — `dns.lookup` resolves once at request time. A DNS rebinding attack could return a public IP on first lookup and a private IP on second. Should we cache the IP for the request lifetime, or is a single lookup sufficient?
   - **Recommendation:** Single lookup is sufficient for now. DNS rebinding requires the attacker to control DNS and timing; the 1–5s TTL of most DNS records makes rebinding between lookup and connect difficult but not impossible. If this becomes a concern, add IP pinning.

2. **Permission race: `approved` array divergence** — The copy-on-write fix means the in-memory `approved` array can accumulate rules from concurrent calls while the DB writes snapshots. Is this divergence acceptable, or should we also update the in-memory array atomically?
   - **Recommendation:** Accept the divergence. The in-memory array is a cache; the DB is the source of truth. On next service init, the DB state is reloaded.

3. **Ripgrep: error marker localization** — Ripgrep error messages may be localized if `LC_MESSAGES` is set. Should we handle non-English error messages?
   - **Recommendation:** No. Ripgrep's regex parse errors are emitted in English regardless of locale (they come from the `regex` crate, not ripgrep's own i18n). The markers are stable.

4. **Edit.ts diff reuse: BOM/formatting changes** — If `format.file(filePath)` modifies the file after write, the diff computed before the write may not match the final file content. Does this affect the result?
   - **Recommendation:** The existing code already recomputes diff after write to capture formatting changes. We should keep the post-write diff for the final result but reuse the pre-write diff for the permission prompt. The permission prompt only needs a preview; the final result should reflect the actual written content.

---

## File Summary

| Issue | File | Lines | Change Type |
|-------|------|-------|-------------|
| 1. SSRF | `src/tool/webfetch.ts` | 33–35, 74 | Add hostname resolution + IP blocklist |
| 2. Symlink | `src/tool/apply_patch.ts` | 96, 172 | Use `AppFileSystem.resolve` |
| 2. Symlink | `src/tool/edit.ts` | 82–85 | Use `AppFileSystem.resolve` |
| 3. Permission race | `src/permission/index.ts` | 270–287 | Copy-on-write for DB write |
| 4. Ripgrep masking | `src/file/ripgrep.ts` | 403–410 | Inspect stderr for regex errors |
| 5. Double diff | `src/tool/edit.ts` | 138–145, 165–172 | Remove second diff computation |
| 6. LLM regex | `src/tool/edit.replacer.ts` | 197–208 | Cap word count, fallback to literal |
| 7. JSON.parse | `src/provider/provider.ts` | 1441 | Wrap in try/catch |
| 8. Wildcard doc | `src/util/wildcard.ts` | 6–7 | Add JSDoc comment |
