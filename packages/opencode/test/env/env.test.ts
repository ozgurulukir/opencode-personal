import { test, expect } from "bun:test"
import { Effect } from "effect"
import { Env } from "@/env"
import { provideInstance, tmpdir } from "../fixture/fixture"

test("set and remove update process.env and are visible to other directories", async () => {
  await using dirA = await tmpdir()
  await using dirB = await tmpdir()
  const key = "OPENCODE_ENV_TEST_SHARED"
  const original = process.env[key]
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const env = yield* Env.Service
        // Materialize directory B's snapshot before the change.
        yield* provideInstance(dirB.path)(env.all())

        yield* provideInstance(dirA.path)(env.set(key, "v1"))
        expect(process.env[key]).toBe("v1")
        expect(yield* provideInstance(dirB.path)(env.get(key))).toBe("v1")

        yield* provideInstance(dirA.path)(env.remove(key))
        expect(process.env[key]).toBeUndefined()
        expect(yield* provideInstance(dirB.path)(env.get(key))).toBeUndefined()
      }).pipe(Effect.scoped, Effect.provide(Env.defaultLayer)),
    )
  } finally {
    if (original === undefined) delete process.env[key]
    else process.env[key] = original
  }
})
