import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Global } from "@opencode-ai/core/global"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Flock } from "@opencode-ai/core/util/flock"
import * as Log from "@opencode-ai/core/util/log"

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

const _Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export const Info = Object.assign(_Info, { zod: zod(_Info) })
export type Info = Schema.Schema.Type<typeof _Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const decode = Schema.decodeUnknownOption(Info)

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.OPENCODE_AUTH_CONTENT) {
        try {
          const parsed: unknown = JSON.parse(process.env.OPENCODE_AUTH_CONTENT)
          if (parsed && typeof parsed === "object") {
            // Validate through the same Info schema as the disk path so
            // set()/remove() never persist an unvalidated shape to auth.json.
            return Record.filterMap(parsed as Record<string, unknown>, (value) =>
              Result.fromOption(decode(value), () => undefined),
            )
          }
        } catch (err) {
          Log.Default.warn("failed to parse OPENCODE_AUTH_CONTENT, falling back to auth.json", { error: err })
        }
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      return Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    // Write to a sibling temp file then rename so concurrent readers never
    // observe a truncated file and a crash cannot leave partial JSON.
    const writeAtomic = (target: string, data: unknown) =>
      Effect.gen(function* () {
        const tmp = `${target}.tmp`
        yield* fsys.writeJson(tmp, data, 0o600)
        yield* fsys.rename(tmp, target)
      })

    // Serialize the whole-file read-modify-write across concurrent writers
    // (CLI login vs server-side OAuth refresh): unlocked writers interleave
    // and the last whole-file write silently drops the other writer's entry.
    // A live-but-stuck flock holder can time acquisition out after 5 minutes
    // as an untyped defect (not the AuthError below); crashed holders
    // self-heal via the stale takeover instead.
    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(file)
          const data = yield* all()
          if (norm !== key) delete data[key]
          delete data[norm + "/"]
          data[norm] = info
          yield* writeAtomic(file, data)
        }),
      ).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(file)
          const data = yield* all()
          delete data[key]
          delete data[norm]
          yield* writeAtomic(file, data)
        }),
      ).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as Auth from "."
