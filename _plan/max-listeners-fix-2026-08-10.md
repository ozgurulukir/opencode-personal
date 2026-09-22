# Goal

**Status:** ✅ EXECUTED (reviewed 2026-09-22) — landed in `cce27b0` (`combineSignals` replaces `AbortSignal.any`; evidence `util/abort.ts:13`) plus `EventEmitter.defaultMaxListeners = 100` at `src/index.ts:50`; related `7e9466e`, `f888efc`.

Fix the `MaxListenersExceededWarning` memory leak in the opencode server caused by `AbortSignal.any()` accumulating internal EventTarget listeners on abort signals that are never aborted.

## Problem

When running `opencode serve`, the console shows:

```
MaxListenersExceededWarning: Possible EventTarget memory leak detected. 101 event listeners added to [Z8]. MaxListeners is undefined.
```

The stack trace points to `~effect/Effect/evaluate` → `runLoop`. This is a warning (not a crash) but indicates a real memory leak: `AbortSignal.any()` adds internal EventTarget listeners to each constituent signal, and these listeners are only cleaned up with `{ once: true }` for the signal that actually fires. When a signal is reused across many `AbortSignal.any()` calls without being aborted, listeners accumulate indefinitely.

## Root Cause Analysis

### Leak mechanism

`AbortSignal.any()` (Node/Bun API) adds internal EventTarget listeners to each constituent signal. These listeners are only cleaned up with `{ once: true }` for the signal that actually fires. When a signal is reused across many `AbortSignal.any()` calls without being aborted, listeners accumulate indefinitely.

### The only `AbortSignal.any()` call site in production

A full search of `node_modules/ai/`, `node_modules/@ai-sdk/*`, and `packages/opencode/src/` confirms: the **only** `AbortSignal.any()` call in the entire production dependency tree is at `packages/opencode/src/provider/provider.ts:1432`.

The AI SDK does NOT use `AbortSignal.any()`. Its `mergeAbortSignals()` helper (`ai/src/util/merge-abort-signals.ts`) manually wires listeners with `{ once: true }` — it is clean.

### Primary leak site: `packages/opencode/src/provider/provider.ts:1421-1461`

```ts
options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
  const fetchFn = customFetch ?? fetch
  const opts = init ?? {}
  const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
  const signals: AbortSignal[] = []

  if (opts.signal) signals.push(opts.signal)
  if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
  if (options["timeout"] !== undefined && options["timeout"] !== null && options["timeout"] !== false)
    signals.push(AbortSignal.timeout(options["timeout"]))

  const combined = signals.length === 0 ? null : signals.length === 1 ? signals[0] : AbortSignal.any(signals)
  if (combined) opts.signal = combined

  const res = await fetchFn(input, { ...opts, timeout: false })
  if (!chunkAbortCtl) return res
  return wrapSSE(res, chunkTimeout, chunkAbortCtl)
}
```

This custom `fetch` is set on the AI SDK provider options and is called on EVERY HTTP request the provider makes. `opts.signal` comes from the AI SDK's `streamText` call, which receives `abortSignal` from `llm.ts:387`.

### Signal chain (traced through source)

1. **`llm.ts:440-443`** — Creates per-turn `AbortController` via `Effect.acquireRelease`. The controller is aborted when the Effect scope closes (turn ends).
2. **`llm.ts:387`** — Passes `ctrl.signal` as `abortSignal` to `streamText`.
3. **AI SDK `streamText.ts:587-592`** — `mergeAbortSignals(abortSignal, timeoutSignal, stepSignal, chunkSignal)` creates a NEW `AbortController`, adds `{ once: true }` listeners to each constituent. Returns the new controller's signal.
4. **Provider `doStream`** (e.g., `openai-chat-language-model.ts:431`) — Passes the merged signal to `postJsonToApi` as `abortSignal`.
5. **`postToApi` (`provider-utils/src/post-to-api.ts:106`)** — Calls `fetch(url, { signal: abortSignal })`.
6. **Custom `fetch` in `provider.ts:1421`** — Intercepts the fetch call. `opts.signal` is the AI SDK's merged signal. Calls `AbortSignal.any([opts.signal, chunkTimeout, requestTimeout])`.
7. **Real `fetch`** — Receives the `AbortSignal.any()` result as the signal.

### How listeners accumulate

The AI SDK's `mergeAbortSignals` creates a fresh controller per `streamText` call. Its signal is passed to the custom `fetch` as `opts.signal`. The custom `fetch` calls `AbortSignal.any([opts.signal, ...])` which adds an internal EventTarget listener to `opts.signal`.

**The critical question: when does `opts.signal` get aborted?**

- If the turn completes normally (assistant finishes), `ctrl.abort()` fires in `llm.ts:442` → the AI SDK's merged signal aborts → `{ once: true }` cleans up the AI SDK's listener on `ctrl.signal`. But the `AbortSignal.any()` listener on the merged signal is NOT cleaned up because `AbortSignal.any()` uses internal listeners that are only removed when the signal aborts.
- If the fetch succeeds (200 OK), the combined `AbortSignal.any()` signal is **never aborted**. The internal listeners on `opts.signal` persist.
- If the AI SDK makes multiple fetch calls per turn (e.g., for separate API calls, retries, or internal operations), each call adds another listener to `opts.signal`.

**The leak path**: `AbortSignal.any()` adds an internal listener to `opts.signal` (the AI SDK's merged signal). On a successful fetch, the combined signal is never aborted, so the internal listener is never removed. If the AI SDK makes multiple fetch calls per turn, listeners accumulate on the merged signal. When the turn ends and `ctrl.abort()` fires, the merged signal aborts and cleans up its own listeners — but the `AbortSignal.any()` internal listeners on the merged signal are already leaked (they were added to the merged signal, which is now aborted and GC'd, but the listeners themselves were never removed).

**Uncertainty about `[Z8]`**: The `[Z8]` in the warning is likely a Bun-internal object name (Bun uses Zig for its internals; `[Z` prefix is characteristic of Zig-generated class names). It may be an internal `AbortSignal` implementation class. The exact identity of `[Z8]` should be confirmed by reproducing the warning and inspecting the object. However, since `AbortSignal.any()` is the only call site in the entire dependency tree, and the warning mentions "event listeners" (which is the exact mechanism `AbortSignal.any()` uses), the causal link is strong.

### Dead code: `packages/opencode/src/util/abort.ts`

```ts
export function abortAfter(ms: number) { ... }        // lines 11-19, zero external callers
export function abortAfterAny(ms: number, ...signals: AbortSignal[]) { ... }  // lines 28-34, one test caller
```

`abortAfterAny` has exactly ONE caller: `test/memory/abort-leak-webfetch.ts`. Zero production callers. `abortAfter` is only used internally by `abortAfterAny`. Both are dead code and use `AbortSignal.any()` with the same leak pattern.

### Existing band-aids

- `packages/opencode/src/index.ts:50`: `EventEmitter.defaultMaxListeners = 100`
- `packages/opencode/src/cli/cmd/tui/worker.ts:24`: Same band-aid

These raise the warning threshold from 10 to 100 but don't fix the underlying leak. The warning still fires at 101+ listeners.

## Steps

### Step 1: Reproduce the leak and identify `[Z8]`

**What:** Before changing any code, reproduce the warning and identify what `[Z8]` is.

**How:**
1. Run `opencode serve` with `--print-logs` to capture stderr
2. Make many turns (50+) in a session against a real LLM provider
3. When the warning appears, add temporary debug logging to `provider.ts:1432` to inspect the signals being combined:
   ```ts
   if (signals.length > 1) {
     console.error("[debug] AbortSignal.any combining", signals.length, "signals", {
       signalTypes: signals.map(s => Object.prototype.toString.call(s)),
       signalAborted: signals.map(s => s.aborted),
     })
   }
   ```
4. Check if `[Z8]` is a Bun-internal `AbortSignal` class by inspecting `Object.prototype.toString.call(signal)` for the signals involved

**Why:** The review correctly notes that the root cause analysis is speculative without confirming which signal is accumulating listeners. This step validates the hypothesis before implementing a fix.

**Files changed:** None (temporary debug logging, reverted after confirmation)

### Step 2: Add `combineSignals()` helper with explicit cleanup to `packages/opencode/src/util/abort.ts`

**What:** Replace the dead `abortAfter` and `abortAfterAny` functions with a new `combineSignals()` helper that returns both a signal and a `cleanup()` function. The caller MUST invoke `cleanup()` when the combined signal is no longer needed.

**Why:** The original `combineSignals` proposal (v1 of this plan) had the same no-abort leak as `AbortSignal.any()` — listeners were only removed on abort, which never happens for successful fetches. The fix must guarantee cleanup after the fetch completes, regardless of success or failure.

**Implementation:**

```ts
/**
 * Combines multiple AbortSignals into one, with explicit cleanup.
 *
 * Unlike AbortSignal.any(), this returns a cleanup function that the caller
 * MUST invoke when the combined signal is no longer needed. This prevents
 * memory leaks when signals are reused across many calls without being aborted.
 *
 * Call cleanup() after the operation that uses the combined signal completes
 * (success or failure). Cleanup removes all event listeners from constituent
 * signals, preventing listener accumulation.
 */
export function combineSignals(signals: AbortSignal[]): {
  signal: AbortSignal
  cleanup: () => void
} {
  if (signals.length === 0) return { signal: new AbortController().signal, cleanup: () => {} }
  if (signals.length === 1) return { signal: signals[0], cleanup: () => {} }

  const controller = new AbortController()
  const onAbort = () => {
    controller.abort(signals.find((s) => s.aborted)?.reason)
    cleanup()
  }
  const cleanup = () => {
    for (const signal of signals) {
      signal.removeEventListener("abort", onAbort)
    }
  }

  if (signals.some((s) => s.aborted)) {
    controller.abort(signals.find((s) => s.aborted)?.reason)
    return { signal: controller.signal, cleanup }
  }

  for (const signal of signals) {
    signal.addEventListener("abort", onAbort, { once: true })
  }

  return { signal: controller.signal, cleanup }
}
```

**Files changed:** `packages/opencode/src/util/abort.ts` — full rewrite

### Step 3: Replace `AbortSignal.any()` in `packages/opencode/src/provider/provider.ts` with cleanup-guaranteed approach

**What:** Replace `AbortSignal.any(signals)` with `combineSignals(signals)` and call `cleanup()` in a `finally` block after the fetch completes.

**Why:** This is the primary leak site. The `finally` block guarantees cleanup regardless of whether the fetch succeeds, fails, or throws — the combined signal is only needed during the fetch request itself.

**Change:**

```ts
options["fetch"] = async (input: any, init?: BunFetchRequestInit) => {
  const fetchFn = customFetch ?? fetch
  const opts = init ?? {}
  const chunkAbortCtl = typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined
  const signals: AbortSignal[] = []

  if (opts.signal) signals.push(opts.signal)
  if (chunkAbortCtl) signals.push(chunkAbortCtl.signal)
  if (options["timeout"] !== undefined && options["timeout"] !== null && options["timeout"] !== false)
    signals.push(AbortSignal.timeout(options["timeout"]))

  const { signal: combined, cleanup } = signals.length <= 1
    ? { signal: signals[0] ?? null, cleanup: () => {} }
    : combineSignals(signals)
  if (combined) opts.signal = combined

  try {
    // ... existing body stripping logic (lines 1435-1451) unchanged ...

    const res = await fetchFn(input, {
      ...opts,
      // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
      timeout: false,
    })

    if (!chunkAbortCtl) return res
    return wrapSSE(res, chunkTimeout, chunkAbortCtl)
  } finally {
    cleanup()
  }
}
```

**Safety analysis of `cleanup()` in finally:**
- `cleanup()` removes the `onAbort` event listeners from constituent signals
- The fetch has already completed (`await fetchFn(...)` has resolved or thrown) — the combined signal is no longer needed for request cancellation
- `wrapSSE` uses `chunkAbortCtl` directly (not the combined signal), so removing listeners from `chunkAbortCtl.signal` is safe — `wrapSSE` will still abort `chunkAbortCtl` directly
- If the fetch throws, `cleanup()` still runs in the `finally` block — no leak on error paths

**Files changed:** `packages/opencode/src/provider/provider.ts` — lines 1421-1461, plus add import of `combineSignals`

### Step 4: Remove dead code

**What:** Delete `packages/opencode/test/memory/abort-leak-webfetch.ts`.

**Why:** This test file is the only caller of `abortAfterAny`, which is being removed. The test uses `AbortSignal.any()` (via `abortAfterAny`) and tests the old leak pattern. A proper regression test for the new approach is in Step 5.

**Files changed:** `packages/opencode/test/memory/abort-leak-webfetch.ts` — delete

### Step 5: Write regression tests for the leak scenario

**What:** Create `packages/opencode/test/util/abort.test.ts` with tests covering:

1. **Empty array** — returns a never-aborted signal, cleanup is a no-op
2. **Single signal** — returns the same signal (identity), cleanup is a no-op
3. **Multiple signals, first aborts** — combined signal aborts with correct reason
4. **Multiple signals, second aborts** — combined signal aborts with correct reason
5. **Already-aborted constituent** — combined signal is immediately aborted
6. **Cleanup removes listeners** — after calling `cleanup()`, constituent signals have no lingering `onAbort` listeners (verify via `EventEmitter.listenerCount` on the underlying EventTarget)
7. **No MaxListenersExceededWarning with cleanup** — create a long-lived `AbortController`, call `combineSignals([longLived.signal, AbortSignal.timeout(100)])` 200 times, calling `cleanup()` after each, verify no warning is emitted
8. **MaxListenersExceededWarning WITHOUT cleanup (regression guard)** — same as #7 but WITHOUT calling `cleanup()`, verify the warning IS emitted (proves the test can detect the leak)
9. **Cleanup is idempotent** — calling `cleanup()` multiple times does not throw

**Why:** Tests #7 and #8 are the critical regression guards. #7 verifies the fix works. #8 verifies the test can detect the leak (without this, a false-negative test would give false confidence).

**Files changed:** `packages/opencode/test/util/abort.test.ts` — new file

### Step 6: Run existing test suite

**What:** Run `bun test` from `packages/opencode` to ensure no regressions.

**Why:** The change is localized but affects the provider fetch path which is exercised by many integration tests.

**Command:** `bun test` (from `packages/opencode`)

### Step 7 (Follow-up, separate PR): Remove band-aids

**What:** Remove `EventEmitter.defaultMaxListeners = 100` from:
- `packages/opencode/src/index.ts:50`
- `packages/opencode/src/cli/cmd/tui/worker.ts:24`

**Why:** These mask other potential listener leaks. Should be done AFTER confirming the fix works in production.

**⚠️ Risk note:** If the fix is ineffective, removing the band-aids will re-trigger the warning at 10 listeners (the Node.js default) instead of 100. This would make the warning more visible but also more noisy. Only remove after confirming the fix eliminates the leak.

**Files changed:** `packages/opencode/src/index.ts`, `packages/opencode/src/cli/cmd/tui/worker.ts`

## Architecture Decisions

### Chosen approach: `combineSignals()` returning `{ signal, cleanup }` with caller-guaranteed cleanup

**Rationale:**
- The `cleanup()` function is the key difference from v1 of this plan — it guarantees listener removal after the fetch completes, regardless of success or failure
- The `finally` block in the custom `fetch` ensures cleanup runs on all code paths
- The combined signal is only needed during the fetch request itself — after `await fetchFn(...)` resolves, the signal is no longer relevant
- `wrapSSE` uses `chunkAbortCtl` directly, not the combined signal, so removing listeners from `chunkAbortCtl.signal` is safe

### Why the v1 `combineSignals` was wrong

The v1 proposal returned just an `AbortSignal` and relied on `{ once: true }` + `controller.signal.addEventListener("abort", cleanup)` for cleanup. Both of these only fire on abort. For successful fetches (the common case), the combined signal is never aborted, so listeners are never removed — exactly the same leak as `AbortSignal.any()`.

### Alternatives considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **A: `combineSignals` with `cleanup()` in finally (CHOSEN)** | Guarantees cleanup on all paths, minimal change, no AI SDK dependency | Requires caller discipline (must call `cleanup()`) | ✅ |
| B: Abort the combined controller after fetch | Same effect as cleanup, simpler API | Requires returning controller or separate abort function; semantically misleading (abort after success) | ❌ |
| C: Patch the AI SDK to not reuse signals | Fixes at the source | Fragile, depends on AI SDK internals, breaks on updates | ❌ |
| D: Just raise defaultMaxListeners higher | Trivial | Masks the leak, doesn't fix memory growth | ❌ |

### Trade-offs

- **Caller discipline**: The `cleanup()` function MUST be called. The `finally` block in `provider.ts` guarantees this, but future callers of `combineSignals` must follow the same pattern. This is documented in the JSDoc.
- **`AbortSignal.reason` is typed as `any`** in the standard DOM lib (`lib.dom.d.ts`). No `as any` cast is needed — the `.reason` property is already `any`. The v1 plan incorrectly added an `as any` cast.
- **Removing `abortAfter`**: It has zero external callers. If someone needs a timeout-based abort in the future, `AbortSignal.timeout(ms)` is the standard API.

## Open Questions

1. **What exactly is `[Z8]`?** Likely a Bun-internal `AbortSignal` implementation class (Zig-generated). Step 1 (reproduction) should confirm this. If `[Z8]` turns out to be something unrelated to `AbortSignal`, the root cause analysis needs revision.

2. **Does the AI SDK make multiple fetch calls per `streamText` invocation?** The AI SDK's `mergeAbortSignals` is clean (no `AbortSignal.any()`), but if `streamText` internally calls `doStream` multiple times (e.g., for tool call rounds), each call goes through the custom `fetch` and triggers `AbortSignal.any()`. With `maxRetries: 0`, retries shouldn't happen, but multi-step tool execution could cause multiple fetch calls per turn. The `cleanup()` in `finally` handles this correctly — each fetch call cleans up after itself.

3. **Should the band-aid removal (Step 7) be done in the same PR or a follow-up?** Recommendation: follow-up PR after confirming the fix works in production for at least a week. The band-aids are harmless and provide a safety net during the rollout.

## Verification Strategy

1. **Reproduce first** (Step 1): Run `opencode serve`, make 50+ turns, confirm the warning appears. Add debug logging to identify `[Z8]`.

2. **Confirm fix** (after Steps 2-3): Run `opencode serve` with the fix, make 50+ turns, confirm the warning does NOT appear.

3. **Unit tests** (Step 5): `test/util/abort.test.ts` covers all edge cases including the regression guard (test #8 verifies the test can detect the leak).

4. **Existing test suite**: `bun test` from `packages/opencode` — all tests should pass.

5. **Memory monitoring**: Watch heap usage over long-running sessions — should not grow unboundedly.

## Risk Assessment

- **Low risk**: The change is localized to the abort signal combination logic in the custom `fetch` wrapper
- **No behavioral change for the fetch itself**: The combined signal behaves identically — it aborts when any constituent aborts. The `cleanup()` in `finally` runs AFTER the fetch completes, so it cannot affect the fetch outcome.
- **`wrapSSE` is unaffected**: `cleanup()` removes listeners from `chunkAbortCtl.signal`, but `wrapSSE` uses `chunkAbortCtl` (the controller) directly — it will still abort the stream on chunk timeout.
- **Edge case covered**: If a constituent signal is already aborted when `combineSignals` is called, the returned signal is immediately aborted (matching `AbortSignal.any()` behavior).
- **Edge case covered**: `cleanup()` is idempotent — calling it multiple times does not throw (verified by test #9).
- **The `AbortSignal.timeout()` calls** in provider.ts create short-lived signals that self-abort — these are not the leak source but are handled correctly by the new helper.

## Files Summary

| File | Action |
|------|--------|
| `packages/opencode/src/util/abort.ts` | Rewrite: remove `abortAfter`, `abortAfterAny`; add `combineSignals` returning `{ signal, cleanup }` |
| `packages/opencode/src/provider/provider.ts` | Edit: replace `AbortSignal.any()` with `combineSignals()`, add `finally { cleanup() }`, add import |
| `packages/opencode/test/memory/abort-leak-webfetch.ts` | Delete (dead test for removed function) |
| `packages/opencode/test/util/abort.test.ts` | Create: unit tests including regression guard for the leak scenario |
| `packages/opencode/src/index.ts` | Follow-up: remove `defaultMaxListeners = 100` band-aid |
| `packages/opencode/src/cli/cmd/tui/worker.ts` | Follow-up: remove `defaultMaxListeners = 100` band-aid |
