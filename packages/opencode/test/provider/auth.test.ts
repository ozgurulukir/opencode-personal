import { expect, test } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import { Effect, Layer } from "effect"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import { ProviderAuth } from "@/provider/auth"
import { ProviderID } from "../../src/provider/schema"
import { Plugin } from "@/plugin"
import { Auth } from "@/auth"

const providerID = ProviderID.make("hardened-auth")

const hook = {
  auth: {
    provider: "hardened-auth",
    methods: [
      {
        type: "oauth",
        label: "OAuth",
        authorize: async (inputs?: Record<string, string>) => {
          if (inputs?.mode === "throw") throw new Error("authorize exploded")
          return {
            url: "https://example.com/auth",
            method: "auto" as const,
            instructions: "sign in",
            callback: async () => {
              if (inputs?.mode === "throw-callback") throw new Error("callback exploded")
              return { type: "success" as const }
            },
          }
        },
      },
    ],
  },
} as unknown as Hooks

const layer = ProviderAuth.layer.pipe(
  Layer.provide(Auth.defaultLayer),
  Layer.provide(
    Layer.succeed(
      Plugin.Service,
      Plugin.Service.of({
        list: () => Effect.succeed([hook]),
        trigger: (_name, _input, output) => Effect.succeed(output),
        init: () => Effect.void,
      }),
    ),
  ),
)

async function withAuth<T, E>(fn: (svc: ProviderAuth.Interface) => Effect.Effect<T, E>) {
  await using tmp = await tmpdir()
  return provideTestInstance({
    directory: tmp.path,
    fn: async () => Effect.runPromise(ProviderAuth.Service.use(fn).pipe(Effect.provide(layer))),
  })
}

test("authorize maps plugin exceptions to ValidationFailed", async () => {
  const error = await withAuth((svc) =>
    Effect.flip(svc.authorize({ providerID, method: 0, inputs: { mode: "throw" } })),
  )
  expect(error).toBeInstanceOf(ProviderAuth.ValidationFailed)
  if (ProviderAuth.ValidationFailed.isInstance(error)) {
    expect(error.data.field).toBe("authorize")
  }
})

test("callback consumes the pending authorization so it cannot be replayed", async () => {
  const error = await withAuth((svc) =>
    Effect.gen(function* () {
      yield* svc.authorize({ providerID, method: 0 })
      yield* svc.callback({ providerID, method: 0 })
      return yield* Effect.flip(svc.callback({ providerID, method: 0 }))
    }),
  )
  expect(error).toBeInstanceOf(ProviderAuth.OauthMissing)
})

test("callback maps plugin exceptions to OauthCallbackFailed", async () => {
  const error = await withAuth((svc) =>
    Effect.gen(function* () {
      yield* svc.authorize({ providerID, method: 0, inputs: { mode: "throw-callback" } })
      return yield* Effect.flip(svc.callback({ providerID, method: 0 }))
    }),
  )
  expect(error).toBeInstanceOf(ProviderAuth.OauthCallbackFailed)
  if (error instanceof ProviderAuth.OauthCallbackFailed) {
    expect(error.cause).toBeInstanceOf(Error)
  }
})
