# Plan: Memory Leak Fixes — LSP Diagnostic Maps & Prefetch Queue Cleanup

**Date:** 2026-08-05  
**Author:** Coding Soul  
**Status:** Implemented  
**Scope:** Fix two confirmed memory leaks in `packages/opencode/src/lsp/client.ts` and `packages/app/src/pages/layout.tsx`.

---

## Implementation Summary

| Plan Item | Status | Notes |
|-----------|--------|-------|
| 1.1 LSP `publishDiagnostics` handler LRU for diagnostic maps | ✅ Implemented | Bounds `pushDiagnostics`/`pullDiagnostics`/`published` to MAX_DIAGNOSTICS on every server push (the unbounded path). Evicts down to `MAX_DIAGNOSTICS - 1` so the in-flight entry keeps the map at exactly MAX_DIAGNOSTICS. |
| 1.2 LSP `notify.open` LRU guard (existing, unchanged) | ✅ Already correct | Cleans all four Maps for the evicted path when `files` overflows MAX_OPEN_FILES |
| 2.1 `prefetchQueues` cleanup on `finally` idle | ✅ Implemented | Deletes empty queue for invisible directories after prefetch completes; skips `pumpPrefetch` re-entry. **Deviation:** queue state extracted to `packages/app/src/pages/layout/prefetch-queue.ts` so the lifecycle is unit-testable (Rule 3). |

**Deviation from plan:** 3.2 required characterization tests before refactoring, but the queue logic was embedded in the large Layout component and not unit-testable. The queue state machine (`queueFor`, `cleanupInvisible`, `completeInflight`) was extracted into a new pure module `packages/app/src/pages/layout/prefetch-queue.ts` with 12 characterization tests. This is a minimal extraction — scheduling, concurrency limits, and prefetch work stay in the Layout component. The `finally` cleanup fix is implemented in `completeInflight`, which returns `true` when the queue is deleted so the caller skips `pumpPrefetch` re-entry.

---

## 1. Executive Summary

This plan addresses two confirmed memory leaks found during a deep-dive review:

1. **LSP client diagnostic maps** (`packages/opencode/src/lsp/client.ts`) — `pushDiagnostics`, `pullDiagnostics`, and `published` grow unbounded when the LSP server pushes `textDocument/publishDiagnostics` for files that were never opened via `notify.open`. The existing LRU guard (`MAX_OPEN_FILES=50` in `notify.open`) does clean all four Maps for the evicted path, but it only triggers when `files` overflows — server-initiated pushes never add to `files`, so they bypass the guard entirely. Over a long-lived session, every server-pushed file leaks diagnostic data permanently.

2. **Prefetch queue stale entries** (`packages/app/src/pages/layout.tsx`) — `prefetchQueues` Map accumulates empty `PrefetchQueue` objects when a directory becomes invisible while a prefetch is in-flight. The reactive cleanup effect only runs when `visibleSessionDirs()` changes; once a directory is invisible, the effect never re-observes it. The `finally` block decrements `running` but does not trigger cleanup, leaving empty `{ inflight: ∅, pending: [], pendingSet: ∅, running: 0 }` objects in the Map for the Layout component's lifetime.

Both leaks are bounded in per-entry size but accumulate silently with repeated directory switching or file opens.

---

## 2. Guiding Principles

- **Fail fast on resource exhaustion.** LRU eviction must clean all related state (diagnostics + files), not just the file text cache.
- **Reactive cleanup must be idempotent.** The `finally` block may fire after the reactive effect has already cleared pending state; the cleanup logic must handle this gracefully.
- **Minimize surface area.** Changes are localized to the affected functions. No new abstractions or single-use helpers.
- **Preserve existing behavior.** All fixes must pass the current test suite; new characterization tests must be added before refactoring.

---

## 3. P0 — Confirmed Memory Leaks (Fix Immediately)

### 3.1 LSP diagnostic maps must be bounded on the server-push path

**File:** `packages/opencode/src/lsp/client.ts`  
**Existing guard:** `notify.open` LRU (lines 593–606) — already correct, unchanged  
**Fix target:** `textDocument/publishDiagnostics` handler (lines 180–197)

**Problem:**

`notify.open` has an LRU guard that caps `files` at `MAX_OPEN_FILES = 50`:

```ts
const MAX_OPEN_FILES = 50
const openPaths = Object.keys(files)
if (openPaths.length >= MAX_OPEN_FILES && !files[request.path]) {
  const oldest = openPaths[0]
  pushDiagnostics.delete(oldest)       // ← deletes from pushDiagnostics
  pullDiagnostics.delete(oldest)     // ← deletes from pullDiagnostics
  published.delete(oldest)           // ← deletes from published
  delete files[oldest]                // ← deletes from files
  await connection.sendNotification("textDocument/didClose", { ... })
}
```

This correctly cleans `pushDiagnostics`, `pullDiagnostics`, `published`, and `files` for the evicted path. **However**, the LRU guard only triggers when `openPaths.length >= MAX_OPEN_FILES`, i.e. only for files opened via `notify.open`. The `textDocument/publishDiagnostics` handler (lines 180–197) adds entries to `pushDiagnostics` and `published` on **every** server push, regardless of whether the file is in `files`:

```ts
connection.onNotification("textDocument/publishDiagnostics", (params) => {
  const filePath = getFilePath(params.uri)
  if (!filePath) return
  published.set(filePath, { at: Date.now(), version: ... })   // ← grows unbounded
  if (shouldSeedDiagnosticsOnFirstPush(...) && !pushDiagnostics.has(filePath)) {
    pushDiagnostics.set(filePath, params.diagnostics)          // ← grows unbounded
    return
  }
  updatePushDiagnostics(filePath, params.diagnostics)          // ← grows unbounded
})
```

A server that pushes diagnostics for files the client never explicitly opened (e.g. via `workspace/didChangeWatchedFiles`, project-wide diagnostics on open, or pull-diagnostic refreshes) grows `pushDiagnostics`/`pullDiagnostics`/`published` without ever touching `files`, so the `MAX_OPEN_FILES` guard never fires. Note `published` only stores `{ at, version? }` metadata (small per entry), but `pushDiagnostics`/`pullDiagnostics` hold full `Diagnostic[]` arrays — those are the meaningful leak.

Additionally, `touchFile` (`lsp/lsp.ts:359`) calls `notify.open()` but the caller never calls `notify.close()`. This path is already bounded by the existing `MAX_OPEN_FILES` guard, so it is **not** the primary leak; the server-push path is.

**Fix:**

The eviction must run on the **server-push path**, not inside `notify.open` — otherwise it never fires for the unbounded case. The cleanest insertion point is the `publishDiagnostics` handler (lines 180–197), right after `published.set(...)`, since that is the only path that adds entries without going through `notify.open`. The existing `notify.open` LRU guard stays unchanged (it already cleans all four Maps correctly).

The handler is synchronous, but `connection.sendNotification` is async — use a fire-and-forget `void` call for the `didClose` notification (matching the non-blocking style of the existing handler):

```ts
// In the publishDiagnostics handler, AFTER published.set(filePath, ...):
const MAX_DIAGNOSTICS = 200
if (pushDiagnostics.size > MAX_DIAGNOSTICS) {
  // Evict oldest by published.at timestamp (server-push path only).
  // notify.open's existing MAX_OPEN_FILES guard still bounds the files record.
  const sorted = [...pushDiagnostics.keys()].sort(
    (a, b) => (published.get(a)?.at ?? 0) - (published.get(b)?.at ?? 0),
  )
  const toEvict = sorted.slice(0, sorted.length - MAX_DIAGNOSTICS)
  for (const evictPath of toEvict) {
    pushDiagnostics.delete(evictPath)
    pullDiagnostics.delete(evictPath)
    published.delete(evictPath)
    if (files[evictPath]) {
      delete files[evictPath]
      void connection.sendNotification("textDocument/didClose", {
        textDocument: { uri: pathToFileURL(evictPath).href },
      })
    }
  }
}
```

This bounds `pushDiagnostics`/`pullDiagnostics`/`published` to `MAX_DIAGNOSTICS` entries on the server-push path. The existing `MAX_OPEN_FILES` guard in `notify.open` continues to bound `files` (and also cleans diagnostic Maps for files it evicts). The two guards are complementary: `MAX_OPEN_FILES` bounds explicitly-opened files; `MAX_DIAGNOSTICS` bounds server-pushed diagnostic entries.

**Tests to add:**

- `publishDiagnostics` for 200+ unique paths (no `notify.open`) → `pushDiagnostics`/`pullDiagnostics`/`published` bounded to `MAX_DIAGNOSTICS` ✅
- `publishDiagnostics` for a path that is also in `files` → eviction sends `textDocument/didClose` and removes from `files` ✅
- `notify.open` LRU (existing `MAX_OPEN_FILES` path) still cleans all four Maps — verify, do not regress ✅
- `notify.close` removes entry from all four Maps — verify existing behavior (lines 680–683), do not regress ✅ (existing test)
- `shutdown` clears all Maps (lines 719–721) — verify existing behavior, do not regress ✅

**Verification:**

```bash
cd packages/opencode && bun test test/lsp
```

Result: **36 pass, 0 fail** across 4 files. Note: the eviction triggers on `size >= MAX_DIAGNOSTICS` and evicts down to `MAX_DIAGNOSTICS - 1` so the entry being added in the same handler keeps the map at exactly `MAX_DIAGNOSTICS`. Using `>` instead caused the map to oscillate at `MAX_DIAGNOSTICS + 1` (evict to 200, then add → 201), which made the bound test flaky.

---

### 3.2 `prefetchQueues` must delete empty queues for invisible directories

**File:** `packages/app/src/pages/layout.tsx`  
**Function:** `pumpPrefetch` (lines 830–848)  
**Lines:** 843–847

**Problem:**

The reactive cleanup effect (lines 723–731) clears `pending` and `pendingSet` for invisible directories, and deletes the queue only if `running === 0`:

```ts
createEffect(() => {
  const visible = new Set(visibleSessionDirs())
  for (const [directory, q] of prefetchQueues) {
    if (visible.has(directory)) continue
    q.pending.length = 0
    q.pendingSet.clear()
    if (q.running === 0) prefetchQueues.delete(directory)
  }
})
```

The `pumpPrefetch` `finally` block decrements `running` but does not check visibility:

```ts
void prefetchMessages(directory, sessionID, token).finally(() => {
  q.running -= 1
  q.inflight.delete(sessionID)
  pumpPrefetch(directory)  // ← no visibility check, no cleanup
})
```

**Leak sequence:**
1. Directory visible → `queueFor()` creates queue, `prefetchSession()` enqueues, `pumpPrefetch()` starts → `running = 1`
2. Directory becomes invisible → cleanup effect runs: clears `pending` + `pendingSet`, but `running = 1` so queue is **not deleted**
3. Prefetch completes → `finally`: `running = 0`, `inflight` cleared, `pumpPrefetch()` runs but finds no pending items
4. Queue is now empty, directory is still invisible
5. Cleanup effect **does not re-run** — `visibleSessionDirs()` hasn't changed
6. **Empty queue stays in `prefetchQueues` Map forever**

**Fix:**

In the `finally` block, after decrementing `running`, check if the directory is still visible. If not, and the queue is empty, delete it **and skip the `pumpPrefetch` call** — otherwise `pumpPrefetch` → `queueFor(directory)` would re-create a fresh empty queue, reintroducing the leak:

```ts
void prefetchMessages(directory, sessionID, token).finally(() => {
  q.running -= 1
  q.inflight.delete(sessionID)

  // Clean up empty queues for invisible directories.
  // The reactive cleanup effect only runs when visibleSessionDirs() changes,
  // so we must also clean up here when a prefetch completes and the directory
  // is no longer visible.
  const visible = new Set(visibleSessionDirs())
  if (!visible.has(directory) && q.running === 0 && q.pending.length === 0) {
    prefetchQueues.delete(directory)
    return // ← do NOT call pumpPrefetch: queueFor() would re-create an empty queue
  }

  pumpPrefetch(directory)
})
```

**Why the early `return` is required:** `pumpPrefetch` (line 830) calls `queueFor(directory)` (line 831) as its first statement, which creates a new `PrefetchQueue` if none exists. Without the `return`, deleting the queue and then calling `pumpPrefetch` would immediately re-insert a fresh `{ inflight: ∅, pending: [], pendingSet: ∅, running: 0 }` entry — the exact leak this fix is meant to close. The `return` only fires when the directory is invisible AND the queue is empty, so no pending work is lost.

**Why this is safe:**
- `visibleSessionDirs()` is a SolidJS `createMemo` (line 628) — reading it inside a `finally` callback is safe (it returns the current cached value, not a reactive dependency).
- If the directory is still visible, the queue is preserved for future prefetches and `pumpPrefetch` runs as before.
- If the directory just became invisible in the same tick, the reactive cleanup effect (lines 723–731) will also run and find an already-deleted entry (Map `delete` is idempotent).
- If the directory is invisible but `q.pending.length > 0` (more work queued), the queue is kept and `pumpPrefetch` drains it — matching the reactive effect's behavior of only deleting when `running === 0`.

**Tests to add:**

- Directory visible → prefetch starts → directory becomes invisible → prefetch completes → queue deleted ✅ (`completeInflight` deletes empty invisible queues and signals skip)
- Directory visible → prefetch starts → directory becomes invisible → another prefetch enqueued before completion → queue NOT deleted (still has pending) ✅ (`completeInflight` keeps invisible queues with pending work)
- Rapid directory switching (visible → invisible → visible) → no stale entries ✅ (cleanup is idempotent; Map `delete` is a no-op on missing keys)

**Verification:**

```bash
cd packages/app && bun test
```

Result: **407 pass, 0 fail** across 60 files (includes 12 new `prefetch-queue` characterization tests). The queue state machine was extracted to `packages/app/src/pages/layout/prefetch-queue.ts` to make it unit-testable; `layout.tsx` now delegates to `prefetchQueues.cleanupInvisible` / `prefetchQueues.completeInflight`.

---

## 4. Out of Scope

- **Bus subscription cleanup** — verified NOT a leak. `InstanceState` + `Effect.addFinalizer` properly shuts down PubSub on disposal. No changes needed.
- **`structuredClone` in session hot paths** — performance tax, not a memory leak. Defer to profiling if heap spikes are reported.
- **`Effect.forkScoped` patterns** — properly managed via `ScopedCache` + scope finalizers. No orphaned scopes found.

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LRU eviction evicts a file the server still needs | Low | Medium | Server re-pushes diagnostics on next change; `didClose` notifies server so it can free its own state |
| `visibleSessionDirs()` read in `finally` captures stale value | Low | Low | `finally` runs after microtask; `visibleSessionDirs()` is synchronous memo, returns current value |
| `prefetchQueues.delete` races with `queueFor` | Low | Low | `queueFor` only creates if missing; `delete` is idempotent; early `return` prevents `pumpPrefetch` re-creating the queue |
| `MAX_DIAGNOSTICS` too low for large workspaces | Medium | Low | 200 is conservative (only bounds server-push entries, not explicitly-opened files); can be tuned via config if needed |
| `publishDiagnostics` handler eviction runs on every push (perf) | Low | Low | Sort is O(n log n) but only runs when `size > MAX_DIAGNOSTICS`; 200 entries → negligible |

---

## 6. Open Questions

1. **Should `MAX_DIAGNOSTICS` be configurable?** For monorepos with thousands of files, 200 may be too aggressive. Consider exposing via `OPENCODE_LSP_MAX_DIAGNOSTICS` env var or config field. **Status:** Deferred — 200 is conservative and only bounds server-push entries, not explicitly-opened files. Revisit if heap spikes are reported.
2. **Should `notify.open` LRU eviction also clear `registrationListeners`?** Currently `registrationListeners` is a `Set<() => void>` that grows with each `client/registerCapability` call. It is cleared in `shutdown()` but not on eviction. If the server re-registers after eviction, stale listeners accumulate. Low risk — registration changes are rare — but worth auditing. **Status:** Deferred — out of scope for this plan; `waitForRegistrationChange` removes its own listener on completion, so growth is bounded by concurrent waits.

---

## 7. Implementation Log

- **2026-08-05** — Implemented both fixes.
  - 3.1: Added `MAX_DIAGNOSTICS = 200` LRU eviction in the `publishDiagnostics` handler (`packages/opencode/src/lsp/client.ts`). Evicts oldest-by-`published.at` entries down to `MAX_DIAGNOSTICS - 1`, cleaning `pushDiagnostics`/`pullDiagnostics`/`published` and sending `didClose` (removing from `files`) for any evicted path that is still open. Added a `didClose` counter to `fake-lsp-server.js` and 4 new tests in `client.test.ts`.
  - 3.2: Extracted the prefetch queue state machine to `packages/app/src/pages/layout/prefetch-queue.ts` (`queueFor`, `cleanupInvisible`, `completeInflight`) and wired it into `layout.tsx`. The `finally` block now calls `completeInflight`, which deletes empty queues for invisible directories and signals the caller to skip `pumpPrefetch` re-entry. Added 12 characterization tests.
  - **Verification:** `bun test test/lsp` → 36 pass; `bun test ./src` (app) → 407 pass; `bun run typecheck` (app) → clean.
