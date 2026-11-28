import path from "path"
import z from "zod"
import { Global } from "@opencode-ai/core/global"
import { Effect, Layer, Context } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Flock } from "@opencode-ai/core/util/flock"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "mcp.auth" })

export const Tokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  scope: z.string().optional(),
})
export type Tokens = z.infer<typeof Tokens>

export const ClientInfo = z.object({
  clientId: z.string(),
  clientSecret: z.string().optional(),
  clientIdIssuedAt: z.number().optional(),
  clientSecretExpiresAt: z.number().optional(),
})
export type ClientInfo = z.infer<typeof ClientInfo>

export const Entry = z.object({
  tokens: Tokens.optional(),
  clientInfo: ClientInfo.optional(),
  codeVerifier: z.string().optional(),
  oauthState: z.string().optional(),
  serverUrl: z.string().optional(),
  resourceUrl: z.string().optional(),
})
export type Entry = z.infer<typeof Entry>

const filepath = path.join(Global.Path.data, "mcp-auth.json")

export interface Interface {
  readonly all: () => Effect.Effect<Record<string, Entry>>
  readonly get: (mcpName: string) => Effect.Effect<Entry | undefined>
  readonly getForUrl: (mcpName: string, serverUrl: string) => Effect.Effect<Entry | undefined>
  readonly set: (mcpName: string, entry: Entry, serverUrl?: string) => Effect.Effect<void>
  readonly remove: (mcpName: string) => Effect.Effect<void>
  readonly updateTokens: (mcpName: string, tokens: Tokens, serverUrl?: string) => Effect.Effect<void>
  readonly updateClientInfo: (mcpName: string, clientInfo: ClientInfo, serverUrl?: string) => Effect.Effect<void>
  readonly updateCodeVerifier: (mcpName: string, codeVerifier: string) => Effect.Effect<void>
  readonly clearCodeVerifier: (mcpName: string) => Effect.Effect<void>
  readonly updateOAuthState: (mcpName: string, oauthState: string) => Effect.Effect<void>
  readonly getOAuthState: (mcpName: string) => Effect.Effect<string | undefined>
  readonly clearOAuthState: (mcpName: string) => Effect.Effect<void>
  readonly isTokenExpired: (mcpName: string) => Effect.Effect<boolean | null>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/McpAuth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    // A failed token write must be loud and observed, never silently
    // swallowed: each write logs the failure, then defects at this explicit
    // boundary. The interface deliberately stays data-level — widening the
    // error channel would ripple through every update* flow; the defect is the
    // raw fs error, so the HTTP errorLayer renders it as an internal-error
    // response rather than a structured NamedError one. The write goes through
    // a sibling temp file + rename so concurrent readers never observe a
    // truncated file and a crash cannot leave partial JSON.
    const writeOrDie = (mcpName: string, data: Record<string, Entry>) =>
      Effect.gen(function* () {
        const tmp = `${filepath}.tmp`
        yield* fs.writeJson(tmp, data, 0o600)
        yield* fs.rename(tmp, filepath)
      }).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => log.error("failed to write mcp-auth.json", { mcpName, error: String(error) })),
        ),
        Effect.orDie,
      )

    // Serialize the whole-file read-modify-write under a cross-process flock:
    // MCP state init connects all servers with unbounded concurrency and the
    // OAuth dance persists clientInfo/tokens mid-connect, so unlocked writers
    // interleave and the last whole-file write silently drops the other
    // server's entry.
    const locked = Effect.fn("McpAuth.locked")(function* (mutate: Effect.Effect<void>) {
      yield* Effect.scoped(Effect.gen(function* () {
        yield* Flock.effect(filepath)
        yield* mutate
      }))
    })

    const all = Effect.fn("McpAuth.all")(function* () {
      return yield* fs.readJson(filepath).pipe(
        Effect.map((data) => data as Record<string, Entry>),
        Effect.catch(() => Effect.succeed({} as Record<string, Entry>)),
      )
    })

    const get = Effect.fn("McpAuth.get")(function* (mcpName: string) {
      const data = yield* all()
      return data[mcpName]
    })

    const getForUrl = Effect.fn("McpAuth.getForUrl")(function* (mcpName: string, serverUrl: string) {
      const entry = yield* get(mcpName)
      if (!entry) return undefined
      if (!entry.serverUrl) return undefined
      if (entry.serverUrl !== serverUrl) return undefined
      return entry
    })

    const set = Effect.fn("McpAuth.set")(function* (mcpName: string, entry: Entry, serverUrl?: string) {
      yield* locked(
        Effect.gen(function* () {
          const data = yield* all()
          if (serverUrl) entry.serverUrl = serverUrl
          data[mcpName] = entry
          yield* writeOrDie(mcpName, data)
        }),
      )
    })

    const remove = Effect.fn("McpAuth.remove")(function* (mcpName: string) {
      yield* locked(
        Effect.gen(function* () {
          const data = yield* all()
          delete data[mcpName]
          yield* writeOrDie(mcpName, data)
        }),
      )
    })

    const updateField = <K extends keyof Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string, value: NonNullable<Entry[K]>, serverUrl?: string) {
        yield* locked(
          Effect.gen(function* () {
            const data = yield* all()
            const entry = data[mcpName] ?? {}
            entry[field] = value
            if (serverUrl) entry.serverUrl = serverUrl
            data[mcpName] = entry
            yield* writeOrDie(mcpName, data)
          }),
        )
      })

    const clearField = <K extends keyof Entry>(field: K, spanName: string) =>
      Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string) {
        yield* locked(
          Effect.gen(function* () {
            const data = yield* all()
            const entry = data[mcpName]
            if (!entry) return
            delete entry[field]
            yield* writeOrDie(mcpName, data)
          }),
        )
      })

    const updateTokens = updateField("tokens", "updateTokens")
    const updateClientInfo = updateField("clientInfo", "updateClientInfo")
    const updateCodeVerifier = updateField("codeVerifier", "updateCodeVerifier")
    const updateOAuthState = updateField("oauthState", "updateOAuthState")
    const clearCodeVerifier = clearField("codeVerifier", "clearCodeVerifier")
    const clearOAuthState = clearField("oauthState", "clearOAuthState")

    const getOAuthState = Effect.fn("McpAuth.getOAuthState")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      return entry?.oauthState
    })

    const isTokenExpired = Effect.fn("McpAuth.isTokenExpired")(function* (mcpName: string) {
      const entry = yield* get(mcpName)
      if (!entry?.tokens) return null
      if (!entry.tokens.expiresAt) return false
      return entry.tokens.expiresAt < Date.now() / 1000
    })

    return Service.of({
      all,
      get,
      getForUrl,
      set,
      remove,
      updateTokens,
      updateClientInfo,
      updateCodeVerifier,
      clearCodeVerifier,
      updateOAuthState,
      getOAuthState,
      clearOAuthState,
      isTokenExpired,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as McpAuth from "./auth"
