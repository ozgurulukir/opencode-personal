// A reference-counted, bounded per-key semaphore registry. Replaces the
// module-level `Map<string, Semaphore>` that grew without bound as distinct
// file paths were edited. Entries are evicted as soon as they become idle
// (refs drop to 0 after the guarded effect completes), so the registry only
// holds locks for paths with an in-flight operation. The `max` bound is a
// defense-in-depth cap: when full, idle entries are evicted first; if every
// entry is busy the registry is allowed to exceed the cap temporarily rather
// than risk deadlock or a race on a live semaphore.

import { Effect, Semaphore } from "effect"

type Entry = { readonly sem: Semaphore.Semaphore; refs: number }

export class LockRegistry {
  private readonly locks = new Map<string, Entry>()

  constructor(private readonly max = 1000) {}

  withLock<A, E, R>(key: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        let entry = this.locks.get(key)
        if (!entry) {
          if (this.locks.size >= this.max) {
            for (const [k, e] of this.locks) {
              if (e.refs === 0) {
                this.locks.delete(k)
                if (this.locks.size < this.max) break
              }
            }
          }
          entry = { sem: Semaphore.makeUnsafe(1), refs: 0 }
          this.locks.set(key, entry)
        }
        entry.refs++
        return entry
      }),
      (entry) => entry.sem.withPermits(1)(effect),
      (entry) =>
        Effect.sync(() => {
          entry.refs--
          if (entry.refs === 0 && this.locks.get(key) === entry) this.locks.delete(key)
        }),
    )
  }
}