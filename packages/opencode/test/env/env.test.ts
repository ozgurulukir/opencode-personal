import { test, expect } from "bun:test"
import { Env } from "../../src/env"
import { tmpdir } from "../fixture/fixture"
import { WithInstance } from "../../src/project/with-instance"
import { makeRuntime } from "../../src/effect/run-service"

const runtime = makeRuntime(Env.Service, Env.defaultLayer)

test("Env.set updates state and process.env", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const key = "TEST_ENV_VAR_SET_KEY"
      const val = "test_value_123"

      runtime.runSync((svc) => svc.set(key, val))

      const retrieved = runtime.runSync((svc) => svc.get(key))
      expect(retrieved).toBe(val)
      expect(process.env[key]).toBe(val)

      runtime.runSync((svc) => svc.remove(key))
      const afterRemove = runtime.runSync((svc) => svc.get(key))
      expect(afterRemove).toBeUndefined()
      expect(process.env[key]).toBeUndefined()
    },
  })
})
