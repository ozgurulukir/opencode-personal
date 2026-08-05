# Layout Prefetch Queue

## `prefetchQueues` cleanup must run in the prefetch `finally`, not just the reactive effect

The reactive cleanup effect (`layout.tsx`) only runs when `visibleSessionDirs()` changes. Once a directory is invisible, the effect never re-observes it, so an empty queue left by a completed prefetch stays in the Map forever. The `finally` block must also clean up: after decrementing `running`, if the directory is invisible and the queue is empty, delete it AND skip the `pumpPrefetch` re-entry — `pumpPrefetch` calls `queueFor(directory)` first, which would re-create a fresh empty queue, reintroducing the leak.

## Queue state lives in `prefetch-queue.ts` so the lifecycle is unit-testable

The queue state machine (`queueFor`, `cleanupInvisible`, `completeInflight`) is extracted to `src/pages/layout/prefetch-queue.ts` (pure, no SolidJS). `completeInflight` returns `true` when it deletes the queue so the caller skips re-pumping. Scheduling, concurrency limits, and the actual prefetch work stay in the Layout component. Add lifecycle tests there, not by mounting the Layout component.
