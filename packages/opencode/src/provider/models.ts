import { Global } from "@opencode-ai/core/global"
import path from "path"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Installation } from "../installation"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Flock } from "@opencode-ai/core/util/flock"
import { Hash } from "@opencode-ai/core/util/hash"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { CatalogModelStatus } from "./model-status"

const Cost = Schema.Struct({
  input: Schema.Finite,
  output: Schema.Finite,
  cache_read: Schema.optional(Schema.Finite),
  cache_write: Schema.optional(Schema.Finite),
  context_over_200k: Schema.optional(
    Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      cache_read: Schema.optional(Schema.Finite),
      cache_write: Schema.optional(Schema.Finite),
    }),
  ),
})

export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  family: Schema.optional(Schema.String),
  release_date: Schema.String,
  attachment: Schema.Boolean,
  reasoning: Schema.Boolean,
  // models.dev omits `temperature` for models that do not support it.
  temperature: Schema.optional(Schema.Boolean),
  tool_call: Schema.Boolean,
  interleaved: Schema.optional(
    Schema.Union([
      Schema.Literal(true),
      Schema.Struct({
        field: Schema.Literals(["reasoning_content", "reasoning_details"]),
      }),
    ]),
  ),
  cost: Schema.optional(Cost),
  // `limit` is present on every current models.dev model, but the payload is
  // an unvalidated remote source — treat it as optional and fall back to 0.
  limit: Schema.optional(
    Schema.Struct({
      context: Schema.Finite,
      input: Schema.optional(Schema.Finite),
      output: Schema.Finite,
    }),
  ),
  modalities: Schema.optional(
    Schema.Struct({
      input: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
      output: Schema.Array(Schema.Literals(["text", "audio", "image", "video", "pdf"])),
    }),
  ),
  experimental: Schema.optional(
    Schema.Struct({
      modes: Schema.optional(
        Schema.Record(
          Schema.String,
          Schema.Struct({
            cost: Schema.optional(Cost),
            provider: Schema.optional(
              Schema.Struct({
                body: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
                headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  status: Schema.optional(CatalogModelStatus),
  provider: Schema.optional(
    Schema.Struct({
      npm: Schema.optional(Schema.String),
      api: Schema.optional(Schema.String),
      supportsMaxOutputTokens: Schema.optional(Schema.Boolean),
    }),
  ),
})
export type Model = Schema.Schema.Type<typeof Model>

export const Provider = Schema.Struct({
  api: Schema.optional(Schema.String),
  supportsMaxOutputTokens: Schema.optional(Schema.Boolean),
  name: Schema.String,
  env: Schema.Array(Schema.String),
  id: Schema.String,
  npm: Schema.optional(Schema.String),
  models: Schema.Record(Schema.String, Model),
})

export type Provider = Schema.Schema.Type<typeof Provider>

export interface Interface {
  readonly get: () => Effect.Effect<Record<string, Provider>>
  readonly refresh: (force?: boolean) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ModelsDev") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))

    const source = Flag.OPENCODE_MODELS_URL || "https://models.dev"
    const filepath = path.join(
      Global.Path.cache,
      source === "https://models.dev" ? "models.json" : `models-${Hash.fast(source)}.json`,
    )
    // An explicit OPENCODE_MODELS_PATH overrides the cache file entirely: the
    // user's local catalog is the source of truth and is never written to.
    const customPath = Flag.OPENCODE_MODELS_PATH
    const readPath = customPath ?? filepath
    const ttl = Duration.minutes(5)
    const lockKey = `models-dev:${filepath}`

    const fresh = Effect.fnUntraced(function* () {
      if (customPath) return false
      const stat = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!stat) return false
      const mtime = Option.getOrElse(stat.mtime, () => new Date(0)).getTime()
      return Date.now() - mtime < Duration.toMillis(ttl)
    })

    const fetchApi = Effect.fn("ModelsDev.fetchApi")(function* () {
      return yield* HttpClientRequest.get(`${source}/api.json`).pipe(
        HttpClientRequest.setHeader("User-Agent", Installation.USER_AGENT),
        http.execute,
        Effect.flatMap((res) => res.text),
        Effect.timeout("10 seconds"),
      )
    })

    /**
     * Validates that a parsed payload is a models.dev provider catalog.
     * A truncated or non-JSON body (proxy error page, interrupted write) must
     * never reach the cache file or the catalog.
     */
    const toCatalog = (parsed: unknown): Record<string, Provider> | undefined => {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
      const catalog: Record<string, Provider> = {}
      for (const [key, value] of Object.entries(parsed)) {
        // Validate nested provider/model records too; a parseable but partial
        // response must not be cached and later crash provider normalization.
        const provider = Option.getOrUndefined(Schema.decodeUnknownOption(Provider)(value))
        if (!provider) return undefined
        catalog[key] = provider
      }
      return Object.keys(catalog).length > 0 ? catalog : undefined
    }

    const parseCatalog = (text: string): Record<string, Provider> | undefined => {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return undefined
      }
      return toCatalog(parsed)
    }

    // JSON.parse throws a defect, and Effect.catch only intercepts typed
    // failures — a corrupt cache file would otherwise die the whole service.
    // The text is parsed inside a plain try/catch for that reason.
    const loadFromDisk = Effect.gen(function* () {
      const text = yield* fs.readFileString(readPath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (text === undefined) return undefined
      return parseCatalog(text)
    }).pipe(Effect.catchDefect(() => Effect.succeed(undefined)))

    // Bundled at build time; absent in dev — `tryPromise` covers both.
    const loadSnapshot = Effect.tryPromise({
      // @ts-ignore — generated at build time, may not exist in dev
      try: () => import("./models-snapshot.js").then((m) => m.snapshot),
      catch: () => undefined,
    }).pipe(Effect.catch(() => Effect.succeed(undefined)), Effect.map(toCatalog))

    /**
     * Fetches the catalog and persists it. The payload is parsed and validated
     * BEFORE the write so a malformed response (HTML error page, truncated
     * body) can never poison the on-disk cache for every later run.
     */
    const fetchAndWrite = Effect.fn("ModelsDev.fetchAndWrite")(function* () {
      const text = yield* fetchApi()
      const catalog = parseCatalog(text)
      if (!catalog) {
        yield* Effect.logWarning("models.dev returned an unparseable payload; keeping the existing cache")
        return undefined
      }
      yield* fs.writeWithDirs(filepath, text)
      return catalog
    })

    const populate = Effect.gen(function* () {
      const fromDisk = yield* loadFromDisk
      if (fromDisk) return fromDisk
      const snapshot = yield* loadSnapshot
      if (snapshot) return snapshot
      if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {}
      // Flock is cross-process: concurrent opencode CLIs can race on this cache file.
      const catalog = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          // Another process may have populated the cache while we waited.
          const fromDisk = yield* loadFromDisk
          if (fromDisk) return fromDisk
          return yield* fetchAndWrite()
        }),
      )
      return catalog ?? {}
    }).pipe(Effect.withSpan("ModelsDev.populate"), Effect.orDie)

    const [cachedGet, invalidate] = yield* Effect.cachedInvalidateWithTTL(populate, Duration.infinity)

    const get = (): Effect.Effect<Record<string, Provider>> => cachedGet

    const refresh = Effect.fn("ModelsDev.refresh")(function* (force = false) {
      if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return
      // A user-provided catalog is authoritative; refreshing would write the
      // upstream catalog to a file the user never reads.
      if (customPath) return
      if (!force && (yield* fresh())) return
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Flock.effect(lockKey)
          // Re-check under the lock: another process may have refreshed between
          // our outer check and lock acquisition.
          if (!force && (yield* fresh())) return
          const catalog = yield* fetchAndWrite()
          if (catalog) yield* invalidate
        }),
      ).pipe(
        Effect.tapCause((cause) => Effect.logError("Failed to fetch models.dev", { cause })),
        Effect.ignore,
      )
    })

    if (!Flag.OPENCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
      // Schedule.spaced runs the effect once, then waits between completions.
      yield* Effect.forkScoped(refresh().pipe(Effect.repeat(Schedule.spaced("60 minutes")), Effect.ignore))
    }

    return Service.of({ get, refresh })
  }),
)

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(AppFileSystem.defaultLayer),
)

export * as ModelsDev from "./models"
