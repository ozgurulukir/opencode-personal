import path from "path"
import { Effect, Layer, Context, Option, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { Flag } from "@opencode-ai/core/flag/flag"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import type { MessageV2 } from "./message-v2"
import type { MessageID } from "./schema"

const log = Log.create({ service: "instruction" })
const MAX_INSTRUCTION_BYTES = 64 * 1024

const FILES = [
  "AGENTS.md",
  ...(Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT ? [] : ["CLAUDE.md"]),
]

function extract(messages: MessageV2.WithParts[]) {
  const paths = new Set<string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
        if (part.state.time.compacted) continue
        const loaded = part.state.metadata?.loaded
        if (!loaded || !Array.isArray(loaded)) continue
        for (const p of loaded) {
          if (typeof p === "string") paths.add(p)
        }
      }
    }
  }
  return paths
}

export interface Interface {
  readonly clear: (messageID: MessageID) => Effect.Effect<void>
  readonly systemPaths: () => Effect.Effect<Set<string>, AppFileSystem.Error>
  readonly system: () => Effect.Effect<string[], AppFileSystem.Error>
  readonly find: (dir: string) => Effect.Effect<string | undefined, AppFileSystem.Error>
  readonly resolve: (
    messages: MessageV2.WithParts[],
    filepath: string,
    messageID: MessageID,
  ) => Effect.Effect<{ filepath: string; content: string }[], AppFileSystem.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Instruction") {}

export const layer: Layer.Layer<
  Service,
  never,
  AppFileSystem.Service | Config.Service | Global.Service | HttpClient.HttpClient
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const fs = yield* AppFileSystem.Service
    const global = yield* Global.Service
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
    const globalFiles = [
      path.join(global.config, "AGENTS.md"),
      ...(!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT ? [path.join(global.home, ".claude", "CLAUDE.md")] : []),
    ]

    const state = yield* InstanceState.make(
      Effect.fn("Instruction.state")(() =>
        Effect.succeed({
          // Track which instruction files have already been attached for a given assistant message.
          claims: new Map<MessageID, Set<string>>(),
          remote: new Map<string, { content: string; at: number }>(),
          oversize: new Set<string>(),
        }),
      ),
    )

    // Non-git projects report worktree === "/" (project.ts). That would make the
    // upward walk climb to the filesystem root and pick up e.g. ~/AGENTS.md, so
    // the walk is clamped to the project directory in that case. Shared by the
    // automatic AGENTS.md discovery and config.instructions-relative globbing so
    // both stay within the workspace.
    const projectStop = Effect.fnUntraced(function* () {
      const ctx = yield* InstanceState.context
      return ctx.worktree === "/" ? ctx.directory : ctx.worktree
    })

    const relative = Effect.fnUntraced(function* (instruction: string) {
      const ctx = yield* InstanceState.context
      if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
        const stop = path.resolve(yield* projectStop())
        return yield* fs
          .globUp(instruction, ctx.directory, stop)
          .pipe(Effect.map((matches) => matches.filter((item) => AppFileSystem.contains(stop, path.resolve(item)))))
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      }
      const stop = path.resolve(global.config)
      return yield* fs
        .globUp(instruction, stop, stop)
        .pipe(Effect.map((matches) => matches.filter((item) => AppFileSystem.contains(stop, path.resolve(item)))))
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
    })

    const read = Effect.fnUntraced(function* (filepath: string) {
      return yield* fs.readFileString(filepath).pipe(Effect.catch(() => Effect.succeed("")))
    })

    type CacheEntry = { mtime: number; content: string }
    const fileCache = new Map<string, CacheEntry>()
    const FILE_CACHE_MAX = 100

    const evictLRU = () => {
      if (fileCache.size <= FILE_CACHE_MAX) return
      const oldest = fileCache.keys().next().value
      if (oldest !== undefined) fileCache.delete(oldest)
    }

    const statInfo = Effect.fnUntraced(function* (filepath: string) {
      const info = yield* fs.stat(filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!info) return undefined
      const mtime = "mtime" in info ? info.mtime.pipe(Option.getOrUndefined)?.getTime() : undefined
      const size = "size" in info ? Number(info.size) : undefined
      return { mtime, size }
    })

    const readCached = Effect.fnUntraced(function* (filepath: string) {
      const info = yield* statInfo(filepath)
      if (info?.size !== undefined && info.size > MAX_INSTRUCTION_BYTES) {
        const s = yield* InstanceState.get(state)
        if (!s.oversize.has(filepath)) {
          s.oversize.add(filepath)
          log.warn("instruction file exceeds size limit", {
            filepath,
            size: info.size,
            limit: MAX_INSTRUCTION_BYTES,
          })
        }
        fileCache.delete(filepath)
        return ""
      }

      const mtime = info?.mtime
      if (mtime === undefined) {
        fileCache.delete(filepath)
        return yield* read(filepath)
      }
      const cached = fileCache.get(filepath)
      if (cached && cached.mtime >= mtime) {
        // Move to end (most recently used) by re-inserting
        fileCache.delete(filepath)
        fileCache.set(filepath, cached)
        return cached.content
      }
      const content = yield* read(filepath)
      if (content) {
        fileCache.set(filepath, { mtime, content })
        evictLRU()
      } else fileCache.delete(filepath)
      return content
    })

    // Remote instructions are cached briefly so a multi-step session does not
    // hammer the configured URLs on every LLM step, while still picking up
    // content updates after the TTL elapses. Failed fetches are not cached, so a
    // transient outage does not drop instructions for the whole session (they
    // retry on the next step). The map doubles as an LRU via re-insertion.
    const REMOTE_TTL_MS = 60_000
    const REMOTE_CACHE_MAX = 50

    const fetch = Effect.fnUntraced(function* (url: string) {
      const s = yield* InstanceState.get(state)
      const cached = s.remote.get(url)
      const now = Date.now()
      if (cached && now - cached.at < REMOTE_TTL_MS) {
        // Move to end (most recently used) by re-inserting
        s.remote.delete(url)
        s.remote.set(url, cached)
        return cached.content
      }

      const res = yield* http.execute(HttpClientRequest.get(url)).pipe(
        Effect.timeout(5000),
        Effect.catch(() => Effect.succeed(null)),
      )
      if (!res) return ""

      class OversizedRemoteInstruction extends Error {
        constructor(readonly size: number) {
          super("remote instruction exceeds size limit")
        }
      }

      const body = yield* res.stream.pipe(
        Stream.runFoldEffect(
          () => ({ chunks: [] as Uint8Array[], size: 0 }),
          (acc, chunk) => {
            const size = acc.size + chunk.byteLength
            if (size > MAX_INSTRUCTION_BYTES) return Effect.fail(new OversizedRemoteInstruction(size))
            return Effect.succeed({ chunks: [...acc.chunks, chunk], size })
          },
        ),
        Effect.catch((error) => {
          if (error instanceof OversizedRemoteInstruction) {
            if (!s.oversize.has(url)) {
              s.oversize.add(url)
              log.warn("remote instruction exceeds size limit", {
                url,
                size: error.size,
                limit: MAX_INSTRUCTION_BYTES,
              })
            }
          }
          return Effect.succeed(null)
        }),
      )
      if (!body) {
        s.remote.delete(url)
        return ""
      }

      const bytes = new Uint8Array(body.size)
      let offset = 0
      for (const chunk of body.chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      const content = new TextDecoder().decode(bytes)
      if (!content) {
        s.remote.delete(url)
        return ""
      }
      s.remote.delete(url)
      s.remote.set(url, { content, at: now })
      if (s.remote.size > REMOTE_CACHE_MAX) {
        const oldest = s.remote.keys().next().value
        if (oldest !== undefined) s.remote.delete(oldest)
      }
      return content
    })

    const clear = Effect.fn("Instruction.clear")(function* (messageID: MessageID) {
      const s = yield* InstanceState.get(state)
      s.claims.delete(messageID)
    })

    const systemPaths = Effect.fn("Instruction.systemPaths")(function* () {
      const config = yield* cfg.get()
      const ctx = yield* InstanceState.context
      const paths = new Set<string>()

      for (const file of globalFiles) {
        if (yield* fs.existsSafe(file)) {
          paths.add(path.resolve(file))
          break
        }
      }

      // Project-level instructions must not leak in from outside the workspace.
      // See projectStop() — non-git projects would otherwise climb to the root.
      if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
        for (const file of FILES) {
          const matches = yield* fs.findUp(file, ctx.directory, yield* projectStop())
          if (matches.length > 0) {
            matches.forEach((item) => paths.add(path.resolve(item)))
            break
          }
        }
      }

      if (config.instructions) {
        for (const raw of config.instructions) {
          if (raw.startsWith("https://") || raw.startsWith("http://")) continue
          const instruction = raw.startsWith("~/") ? path.join(global.home, raw.slice(2)) : raw
          const matches = yield* (
            path.isAbsolute(instruction)
              ? fs.glob(path.basename(instruction), {
                  cwd: path.dirname(instruction),
                  absolute: true,
                  include: "file",
                })
              : relative(instruction)
          ).pipe(Effect.catch(() => Effect.succeed([] as string[])))
          matches.forEach((item) => paths.add(path.resolve(item)))
        }
      }

      return paths
    })

    const system = Effect.fn("Instruction.system")(function* () {
      const config = yield* cfg.get()
      const paths = yield* systemPaths()
      const urls = (config.instructions ?? []).filter(
        (item) => item.startsWith("https://") || item.startsWith("http://"),
      )

      const files = yield* Effect.forEach(Array.from(paths), readCached, { concurrency: 8 })
      const remote = yield* Effect.forEach(urls, fetch, { concurrency: 4 })

      return [
        ...Array.from(paths).flatMap((item, i) =>
          files[i] ? [`<instructions source="${item}">\n${files[i]}\n</instructions>`] : [],
        ),
        ...urls.flatMap((item, i) =>
          remote[i] ? [`<instructions source="${item}">\n${remote[i]}\n</instructions>`] : [],
        ),
      ]
    })

    const find = Effect.fn("Instruction.find")(function* (dir: string) {
      for (const file of FILES) {
        const filepath = path.resolve(path.join(dir, file))
        if (yield* fs.existsSafe(filepath)) return filepath
      }
      return undefined
    })

    const resolve = Effect.fn("Instruction.resolve")(function* (
      messages: MessageV2.WithParts[],
      filepath: string,
      messageID: MessageID,
    ) {
      const sys = yield* systemPaths()
      const already = extract(messages)
      const results: { filepath: string; content: string }[] = []
      const s = yield* InstanceState.get(state)
      const root = path.resolve(yield* InstanceState.directory)

      const target = path.resolve(filepath)
      let current = path.dirname(target)

      // Walk upward from the file being read and attach nearby instruction files once per message.
      while (current.startsWith(root) && current !== root) {
        const found = yield* find(current)
        if (!found || found === target || sys.has(found) || already.has(found)) {
          current = path.dirname(current)
          continue
        }

        let set = s.claims.get(messageID)
        if (!set) {
          set = new Set()
          s.claims.set(messageID, set)
        }
        if (set.has(found)) {
          current = path.dirname(current)
          continue
        }

        set.add(found)
        const content = yield* readCached(found)
        if (content) {
          results.push({ filepath: found, content: `<instructions source="${found}">\n${content}\n</instructions>` })
        }

        current = path.dirname(current)
      }

      return results
    })

    return Service.of({ clear, systemPaths, system, find, resolve })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(Config.defaultLayer),
  Layer.provide(Global.layer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
)

export function loaded(messages: MessageV2.WithParts[]) {
  return extract(messages)
}

export * as Instruction from "./instruction"
