// Tests for the reference-counted file-lock registry (tool/lock.ts).
// Verifies serialization, that entries are evicted when idle (no unbounded
// growth), and that concurrent access to the same key serializes.

import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LockRegistry } from "../../src/tool/lock"

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe("LockRegistry", () => {
  test("runs the effect under a per-key lock", async () => {
    const registry = new LockRegistry()
    const order: string[] = []
    const effect = registry.withLock(
      "a",
      Effect.sync(() => {
        order.push("run")
      }),
    )
    await run(effect)
    expect(order).toEqual(["run"])
  })

  test("serializes concurrent holders of the same key", async () => {
    const registry = new LockRegistry()
    let maxConcurrent = 0
    let concurrent = 0
    const work = registry.withLock(
      "k",
      Effect.gen(function* () {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        yield* Effect.sleep(20)
        concurrent--
      }),
    )
    await run(Effect.all([work, work, work], { concurrency: "unbounded" }))
    // The per-key semaphore must never allow two in-flight holders.
    expect(maxConcurrent).toBe(1)
  })

  test("evicts entries once idle (bounded growth)", async () => {
    const registry = new LockRegistry()
    for (let i = 0; i < 50; i++) {
      await run(registry.withLock(`file-${i}`, Effect.succeed(1)))
    }
    // After all complete, the internal map must be empty (each entry released & evicted).
    const size = (registry as unknown as { locks: Map<string, unknown> }).locks.size
    expect(size).toBe(0)
  })

  test("releases and evicts after a normal run", async () => {
    const registry = new LockRegistry()
    await run(registry.withLock("k", Effect.succeed(1)))
    const size = (registry as unknown as { locks: Map<string, unknown> }).locks.size
    expect(size).toBe(0)
  })
})