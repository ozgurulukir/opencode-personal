# Core Utilities (`src/util/`)

## `error.ts` — `isInstance` null guard

`typeof null === "object"` in JS, so `"name" in null` throws. `hasName()` (line 8) guards with `error !== null`; `isInstance()` (line 36) must do the same. If adding a new type guard in this file, always check `!== null` before `in` operator.

## `identifier.ts` — module-level mutable state

`lastTimestamp` and `counter` (lines 7-8) are module globals, making tests order-sensitive. The optional `timestamp` parameter on `create()` is the escape hatch for deterministic testing — always use it in tests. Without it, rapid calls in the same millisecond increment the counter, and tests that don't inject timestamps will produce different IDs on each run.

## `binary.ts` — `insert` mutates in-place

`Binary.insert` (line 22) calls `array.splice(left, 0, item)` which mutates the original array and returns the same reference. The return type `T[]` and functional-style name may suggest immutability to callers. If you need a copy, clone before calling.
