# Fix tool layer review findings

**Date:** 2026-08-13  
**Package:** `packages/opencode`  
**Scope:** `src/tool/*.ts`, `test/tool/*.test.ts`

---

## Goal

Fix six code review findings in the tool layer: one high-severity symlink escape gap in `apply_patch.ts`, two medium-severity defect-handling / documentation gaps, and three low-severity cleanups (charset parsing, test fixture convention, duplicate imports). All changes are local to the tool layer; no schema, API, or behavior changes beyond the security fix and defect propagation.

---

## Steps

### 1. H1 — apply_patch.ts symlink escape gap

**What:** Replace `AppFileSystem.resolve(path.resolve(...))` with `resolvePath(path.resolve(...))` in `apply_patch.ts` so symlink escapes are caught by `fs.realpathSync` before the containment check.

**Why:** `path.resolve` normalizes `..` but does not resolve symlinks. A symlink inside the project pointing outside (e.g. `project/link -> /etc`) currently passes `projectContainmentError()`. `edit.ts` and `write.ts` already use `resolvePath`; `apply_patch.ts` was missed. The tool AGENTS.md (`src/tool/AGENTS.md:77`) explicitly requires `realpathSync` for `apply_patch.ts` too.

**Files to modify:**
- `packages/opencode/src/tool/apply_patch.ts`
  - Line 18: add `resolvePath` to the existing `projectContainmentError` import from `./file-path`
  - Line 97: change `AppFileSystem.resolve(path.resolve(instance.directory, hunk.path))` → `resolvePath(path.resolve(instance.directory, hunk.path))`
  - Line 215: change `AppFileSystem.resolve(path.resolve(instance.directory, hunk.move_path))` → `resolvePath(path.resolve(instance.directory, hunk.move_path))`

**Nuance verified:** `resolvePath` in `file-path.ts:13-26` already catches `realpathSync` errors for non-existent files and resolves the parent directory instead. This correctly handles patches that add new files (the file does not exist yet, but the parent directory is realpathed to catch symlinks in the path).

**Tests to add:**
- `packages/opencode/test/tool/apply_patch.test.ts` — new test "rejects symlink pointing outside project":
  1. `await using outside = await tmpdir()`
  2. `await using fixture = await tmpdir({ git: true })`
  3. Create a symlink inside the fixture pointing outside: `fs.symlinkSync(outside.path, path.join(fixture.path, "evil-link"), "junction")`
  4. Attempt to apply a patch targeting `evil-link/secret.txt`
  5. Assert `result.metadata.failedHunks.length > 0` and the error contains `"Path escapes project directory"`

---

### 2. M1 — Defect-catching in apply_patch.ts

**What:** Replace `Effect.catchCause` with `Effect.catch` (or `Effect.catchIf`) in the two `Bom.readFile` call sites so defects (OOM, interruption) propagate instead of being recorded as failed hunks.

**Why:** `Effect.catchCause` catches every `Cause`, including defects. This masks real system failures. `Bom.readFile` is an `Effect.fn` that yields `fs.readFile`; its error channel carries typed filesystem errors. We only want to catch those, letting defects fall through.

**Files to modify:**
- `packages/opencode/src/tool/apply_patch.ts`
  - Line 2: change `import { Cause, Effect, Schema } from "effect"` → `import { Effect, Schema } from "effect"` (Cause no longer needed after switching to `Effect.catch`)
  - Lines 164-173 (update case): replace `Effect.catchCause((cause) => { ... })` with `Effect.catch((error) => { ... })`
  - Lines 256-265 (delete case): same replacement

**Implementation detail:** `Effect.catch` receives the typed error directly (no `Cause.squash` needed). The handler body stays the same — record the failed hunk and return `Effect.succeed(undefined)`. Defects will now propagate as unhandled defects rather than being swallowed.

---

### 3. M2 — LockRegistry scope documentation

**What:** Add a one-line comment at `edit.ts:57` documenting that `editLocks` is per-instance, not module-global.

**Why:** The old `Map<string, Semaphore>` was module-global. The new `LockRegistry` is created inside the `Tool.define` factory generator, so it is per-tool-instance. Behavior is acceptable (serializes read-modify-write within an instance), but the scope change is undocumented.

**Files to modify:**
- `packages/opencode/src/tool/edit.ts`
  - Line 57: add comment `// Per-instance: cross-instance edits are not serialized.`

**AGENTS.md check:** `src/tool/AGENTS.md` currently has no explicit statement about global vs per-instance lock scope, so no doc update is needed.

---

### 4. L1 — webfetch.ts charset quote stripping

**What:** Strip quotes from the captured charset label before passing to `TextDecoder`.

**Why:** `/charset=([^\s;]+)/i` captures quoted values like `"utf-8"`. `TextDecoder` rejects quoted labels, silently falling back to utf-8. Stripping quotes makes quoted charsets decode correctly.

**Files to modify:**
- `packages/opencode/src/tool/webfetch.ts`
  - Line 295: change `const label = match?.[1]?.trim() ?? "utf-8"` → `const label = match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "utf-8"`

**Tests to add:**
- `packages/opencode/test/tool/webfetch.test.ts` — new test "decodes quoted charset correctly":
  - Create a custom `HttpClient.make()` mock that returns `HttpClientResponse.fromWeb()` with a `Response` having the `content-type: text/html; charset="utf-8"` header, following the existing pattern in `webfetch.test.ts` (lines 67-77, 97-104).
  - Do NOT use the `beforeEach` `globalThis.fetch` override — it bypasses the Effect `HttpClient` layer.
  - Assert the body decodes correctly (same as unquoted utf-8)

---

### 5. L2 — Test tmpdir fixture convention

**What:** Migrate `file-path.test.ts` and `file-read.test.ts` from manual `fs.mkdtempSync` helpers to the repo's `tmpdir` fixture.

**Why:** The repo convention is `await using tmp = await tmpdir()` from `test/fixture/fixture.ts`. These two files still use ad-hoc `tmpProject()` / `tmpFile()` helpers with synchronous `fs.mkdtempSync`.

**Files to modify:**
- `packages/opencode/test/tool/file-path.test.ts`
  - Change `import fs from "fs"` → `import * as fs from "fs/promises"` (async fixture requires promise-based fs)
  - Remove `tmpProject()` helper (lines 10-15)
  - Import `tmpdir` from `../fixture/fixture`
  - Convert all `test("...", () => { ... })` callbacks to `async () => { ... }`
  - Replace `const { project } = tmpProject()` with `await using tmp = await tmpdir()` and use `tmp.path`
  - For symlink tests ("resolves symlinks inside the project pointing outside" and "handles nonexistent files under a symlinked parent"), use a second `tmpdir()` fixture for the outside target:
    ```ts
    await using outside = await tmpdir()
    await using fixture = await tmpdir({ git: true })
    fs.symlinkSync(outside.path, path.join(fixture.path, "evil-link"), "junction")
    ```
  - Use `await fs.writeFile` / `await fs.readFile` etc. instead of sync variants (the fixture is async)

- `packages/opencode/test/tool/file-read.test.ts`
  - Change `import fs from "fs"` → `import * as fs from "fs/promises"` (async fixture requires promise-based fs)
  - Remove `tmpFile()` helper (lines 13-18)
  - Import `tmpdir` from `../fixture/fixture`
  - Convert all test callbacks to `async () => { ... }`
  - Replace inline `fs.mkdtempSync` calls with `await using tmp = await tmpdir()`
  - Use async `fs` APIs

**Pattern to follow:** `apply_patch.test.ts` already uses `await using fixture = await tmpdir()` correctly.

---

### 6. L3 — Duplicate import lines

**What:** Combine two separate imports from the same module into one line.

**Files to modify:**
- `packages/opencode/src/tool/websearch.ts`
  - Lines 10-11: replace
    ```ts
    import { PositiveInt } from "@opencode-ai/core/schema"
    import { NonNegativeInt } from "@opencode-ai/core/schema"
    ```
    with
    ```ts
    import { PositiveInt, NonNegativeInt } from "@opencode-ai/core/schema"
    ```

---

## Verification

1. **Typecheck:** `bun run --cwd packages/opencode typecheck`
2. **Tests (full suite):** `cd packages/opencode && bun test`
   - Must run from `packages/opencode`, not repo root (root test script is a guard that exits 1)
3. **Targeted tests:** `cd packages/opencode && bun test test/tool/apply_patch.test.ts test/tool/webfetch.test.ts test/tool/file-path.test.ts test/tool/file-read.test.ts`
4. **Lint:** `bun run --cwd packages/opencode lint`

---

## Risk notes

- **H1 (symlink escape):** Low risk. `resolvePath` is already used by `edit.ts` and `write.ts` with the same contract. The only nuance is non-existent files — verified that `resolvePath` handles this by realpathing the parent directory. The new test covers the symlink-escape case explicitly.
- **M1 (defect catching):** Low risk. `Effect.catch` only catches typed errors; defects now propagate. The only behavioral change is that a defect during `Bom.readFile` will fail the tool with a defect instead of recording a failed hunk. This is the intended behavior — defects should not be silently swallowed.
- **M2 (LockRegistry comment):** Zero risk. Documentation-only change.
- **L1 (charset quotes):** Low risk. The `.replace` is a no-op for unquoted charsets; it only strips matching quotes. The new test locks the behavior.
- **L2 (tmpdir fixture):** Low risk. The fixture is already used by every other test in `test/tool/`. The only change is making test callbacks `async` and using async `fs` APIs, which is standard.
- **L3 (duplicate imports):** Zero risk. Pure formatting.

---

## Open questions

None. All findings have clear fixes and the codebase already contains the patterns to follow (`resolvePath` usage in `edit.ts`/`write.ts`, `tmpdir` fixture in `apply_patch.test.ts`, `Effect.catch` in other tool files).
