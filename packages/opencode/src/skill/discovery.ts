import { NodePath } from "@effect/platform-node"
import { Effect, Layer, Path, Schema, Context, Schedule } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { guardedFetch } from "@/util/network"

const skillConcurrency = 4
const fileConcurrency = 8
/** Cap both the index and each downloaded skill file; skill URLs come from (possibly remote) config. */
export const MAX_SKILL_BYTES = 2 * 1024 * 1024

/** A fetch failure that will never succeed on retry (SSRF rejection, 4xx, size cap, bad body). */
class PermanentFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PermanentFetchError"
  }
}

class IndexSkill extends Schema.Class<IndexSkill>("IndexSkill")({
  name: Schema.String,
  files: Schema.Array(Schema.String),
}) {}

class Index extends Schema.Class<Index>("Index")({
  skills: Schema.Array(IndexSkill),
}) {}

export interface Interface {
  readonly pull: (url: string) => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SkillDiscovery") {}

export const layer: Layer.Layer<Service, never, AppFileSystem.Service | Path.Path> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const log = Log.create({ service: "skill-discovery" })
      const fs = yield* AppFileSystem.Service
      const path = yield* Path.Path
      const cache = path.join(Global.Path.cache, "skills")

      // All fetches go through the SSRF guard and are byte-capped: skill URLs can
      // originate from untrusted (including remote well-known) config.
      const fetchBytes = async (url: string, what: string, maxBytes: number): Promise<Uint8Array> => {
        let res: Response
        try {
          res = await guardedFetch(url, what)
        } catch (error) {
          // SSRF/scheme/DNS rejections from the guard are permanent — never retry them.
          throw new PermanentFetchError(
            `fetch guard rejected ${what} from ${url}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        if (!res.ok) {
          const err = `failed to fetch ${what} from ${url}: ${res.status}`
          // 408/429/5xx are transient; other 4xx (e.g. 404) are permanent.
          if (res.status === 408 || res.status === 429 || res.status >= 500) throw new Error(err)
          throw new PermanentFetchError(err)
        }
        const length = res.headers.get("content-length")
        if (length) {
          const size = Number(length)
          if (Number.isFinite(size) && size > maxBytes) {
            throw new PermanentFetchError(
              `Response size for ${what} from ${url} (${size} bytes) exceeds maximum allowed size of ${maxBytes} bytes`,
            )
          }
        }
        if (!res.body) throw new PermanentFetchError(`missing response body for ${what} from ${url}`)
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let bytes = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > maxBytes) {
              await reader.cancel()
              throw new PermanentFetchError(
                `Response size for ${what} from ${url} exceeds maximum allowed size of ${maxBytes} bytes`,
              )
            }
            chunks.push(value)
          }
        } finally {
          reader.releaseLock?.()
        }
        const out = new Uint8Array(bytes)
        let offset = 0
        for (const chunk of chunks) {
          out.set(chunk, offset)
          offset += chunk.byteLength
        }
        return out
      }

      const retry = <A, E>(effect: Effect.Effect<A, E>) =>
        effect.pipe(
          Effect.retry({
            while: (error) => !(error instanceof PermanentFetchError),
            times: 2,
            schedule: Schedule.exponential(200).pipe(Schedule.jittered),
          }),
        )

      const safePath = (base: string, target: string): string | null => {
        const dest = path.resolve(base, target)
        const rel = path.relative(base, dest)
        if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null
        return dest
      }

      const download = Effect.fn("Discovery.download")(function* (url: string, dest: string) {
        if (yield* fs.exists(dest).pipe(Effect.orDie)) return true

        return yield* retry(Effect.tryPromise(() => fetchBytes(url, "skill file", MAX_SKILL_BYTES))).pipe(
          Effect.flatMap((body) => fs.writeWithDirs(dest, body)),
          Effect.as(true),
          Effect.catch((err) =>
            Effect.sync(() => {
              log.error("failed to download", { url, err })
              return false
            }),
          ),
        )
      })

      const pull = Effect.fn("Discovery.pull")(function* (url: string) {
        const base = url.endsWith("/") ? url : `${url}/`
        const index = new URL("index.json", base).href
        const host = base.slice(0, -1)

        log.info("fetching index", { url: index })

        const data = yield* retry(
          Effect.tryPromise(async () => {
            const body = await fetchBytes(index, "skill index", MAX_SKILL_BYTES)
            try {
              return Schema.decodeUnknownSync(Index)(JSON.parse(new TextDecoder().decode(body)))
            } catch (error) {
              throw new PermanentFetchError(
                `invalid skill index at ${index}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }),
        ).pipe(
          Effect.catch((err) =>
            Effect.sync(() => {
              log.error("failed to fetch index", { url: index, err })
              return null
            }),
          ),
        )

        if (!data) return []

        const list = data.skills.filter((skill) => {
          if (!skill.files.includes("SKILL.md")) {
            log.warn("skill entry missing SKILL.md", { url: index, skill: skill.name })
            return false
          }
          return true
        })

        const dirs = yield* Effect.forEach(
          list,
          (skill) =>
            Effect.gen(function* () {
              const root = safePath(cache, skill.name)
              if (!root) {
                log.warn("path traversal blocked in skill name", { skill: skill.name })
                return null
              }

              if (skill.files.some((file) => !safePath(root, file))) {
                log.warn("path traversal blocked in file path", { skill: skill.name })
                return null
              }

              yield* Effect.forEach(
                skill.files,
                (file) => download(new URL(file, `${host}/${skill.name}/`).href, safePath(root, file)!),
                {
                  concurrency: fileConcurrency,
                },
              )

              const md = path.join(root, "SKILL.md")
              return (yield* fs.exists(md).pipe(Effect.orDie)) ? root : null
            }),
          { concurrency: skillConcurrency },
        )

        return dirs.filter((dir): dir is string => dir !== null)
      })

      return Service.of({ pull })
    }),
  )

export const defaultLayer: Layer.Layer<Service> = layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(NodePath.layer),
)

export * as Discovery from "./discovery"
