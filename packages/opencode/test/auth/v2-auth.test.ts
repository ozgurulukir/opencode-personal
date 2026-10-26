import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { AuthV2, ServiceID, ApiKeyCredential } from "../../src/v2/auth"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const node = CrossSpawnSpawner.defaultLayer
const it = testEffect(Layer.mergeAll(AuthV2.defaultLayer, node))

describe("AuthV2", () => {
  it.live("active finds active account when specified", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* AuthV2.Service
        const serviceA = ServiceID.make("service-a")

        const account1 = yield* auth.create({
          serviceID: serviceA,
          credential: new ApiKeyCredential({ type: "api", key: "key-1" }),
          description: "account 1",
          active: true,
        })

        const account2 = yield* auth.create({
          serviceID: serviceA,
          credential: new ApiKeyCredential({ type: "api", key: "key-2" }),
          description: "account 2",
          active: false,
        })

        const activeAcc = yield* auth.active(serviceA)
        expect(activeAcc).toBeDefined()
        expect(activeAcc?.id).toBe(account1.id)

        yield* auth.activate(account2.id)

        const newActive = yield* auth.active(serviceA)
        expect(newActive?.id).toBe(account2.id)
      }),
    ),
  )

  it.live("active falls back to first matching account if active pointer is invalid or omitted", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* AuthV2.Service
        const serviceB = ServiceID.make("service-b")

        const account1 = yield* auth.create({
          serviceID: serviceB,
          credential: new ApiKeyCredential({ type: "api", key: "key-1" }),
          description: "account 1",
          active: false,
        })

        const activeAcc = yield* auth.active(serviceB)
        expect(activeAcc).toBeDefined()
        expect(activeAcc?.id).toBe(account1.id)
      }),
    ),
  )

  it.live("active returns undefined when no accounts exist for service", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const auth = yield* AuthV2.Service
        const serviceC = ServiceID.make("service-c")

        const activeAcc = yield* auth.active(serviceC)
        expect(activeAcc).toBeUndefined()
      }),
    ),
  )
})
