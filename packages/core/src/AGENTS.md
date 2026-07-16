# Core

## `effect-zod.ts` — Effect Schema ASTs are immutable, so walkCache is always valid

The `walkCache` WeakMap in `effect-zod.ts:15` memoizes Zod derivations by AST node identity. Since Effect Schema AST nodes are immutable after construction, a cached Zod copy never goes stale — even if the schema reference is passed around, the underlying AST doesn't mutate. This means `zodObject()`'s `.zod` static shortcut (line 44) is safe: the cached Zod is always equivalent to a fresh `walk()`.

## `Effect.runSyncExit` on async transforms surfaces as defects, not silent errors

`decode()` (line 115) uses `Effect.runSyncExit` for transform decoding. If a transformation is async/Effectful, `runSyncExit` throws a `Cause` defect — it does NOT silently return the original value. The `Option.getOrElse(exit.value, () => value)` fallback only fires when the transform succeeds but returns `Option.none()`, which is the "no transformation needed" signal from Effect Schema internals.
