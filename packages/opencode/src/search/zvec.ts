import { Effect, Layer } from "effect"
import { createHash } from "node:crypto"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import * as Log from "@opencode-ai/core/util/log"
import { SearchService, type SearchResult, type SearchServiceInterface } from "./search"
import { InstanceState } from "@/effect/instance-state"
import { lazy } from "@/util/lazy"
import type { ZVecCollection } from "@zvec/zvec"

const log = Log.create({ service: "search.zvec" })

// zvec document IDs reject characters like '/', ':' and '.'. Hash opaque IDs to
// hex at the zvec boundary — the human-readable path is kept in the `path` field.
function docId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 24)
}

// Load the platform-specific native binding directly, mirroring the @parcel/watcher
// pattern (src/file/watcher.ts). A template `require` of the per-platform binding
// package is statically analyzable by Bun --compile, so the .node addon is embedded
// into the standalone binary. The @zvec/zvec JS wrapper is intentionally bypassed:
// its runtime `require.resolve` of the optional binding package cannot resolve inside
// the compiled binary's virtual filesystem, which previously caused silent no-ops.

interface ZVecModule {
  readonly ZVecDataType: (typeof import("@zvec/zvec"))["ZVecDataType"]
  readonly ZVecIndexType: (typeof import("@zvec/zvec"))["ZVecIndexType"]
  readonly ZVecMetricType: (typeof import("@zvec/zvec"))["ZVecMetricType"]
  readonly ZVecLogLevel: (typeof import("@zvec/zvec"))["ZVecLogLevel"]
  readonly ZVecCollectionSchema: (typeof import("@zvec/zvec"))["ZVecCollectionSchema"]
  readonly ZVecInitialize: (typeof import("@zvec/zvec"))["ZVecInitialize"]
  readonly ZVecCreateAndOpen: (typeof import("@zvec/zvec"))["ZVecCreateAndOpen"]
  readonly ZVecOpen: (typeof import("@zvec/zvec"))["ZVecOpen"]
}

const zvec = lazy((): ZVecModule | undefined => {
  try {
    const b = require(`@zvec/bindings-${process.platform}-${process.arch}`) as Record<string, any>
    b.initialize({ logLevel: b.LogLevel.ERROR })
    return {
      ZVecDataType: b.DataType,
      ZVecIndexType: b.IndexType,
      ZVecMetricType: b.MetricType,
      ZVecLogLevel: b.LogLevel,
      ZVecCollectionSchema: b.CollectionSchema,
      ZVecInitialize: b.initialize,
      ZVecCreateAndOpen: b.createAndOpen,
      ZVecOpen: b.open,
    }
  } catch (error) {
    log.error("failed to load zvec binding", { error })
    return undefined
  }
})

export class ZvecIndex {
  private collection: ZVecCollection | null = null
  private readonly path: string
  private readonly dimension: number

  constructor(path: string, dimension = 384) {
    this.path = path
    this.dimension = dimension
  }

  private open(): ZVecCollection {
    if (this.collection) return this.collection
    const mod = zvec()
    if (!mod) throw new Error("zvec binding unavailable")
    const schema = new mod.ZVecCollectionSchema({
      name: "workspace_search",
      vectors: {
        name: "embedding",
        dataType: mod.ZVecDataType.VECTOR_FP32,
        dimension: this.dimension,
        indexParams: {
          indexType: mod.ZVecIndexType.HNSW,
          metricType: mod.ZVecMetricType.COSINE,
          m: 24,
          efConstruction: 100,
        },
      },
      fields: [
        { name: "path", dataType: mod.ZVecDataType.STRING },
        { name: "content", dataType: mod.ZVecDataType.STRING },
        { name: "mtime", dataType: mod.ZVecDataType.INT64 },
      ],
    })
    try {
      this.collection = mod.ZVecCreateAndOpen(this.path, schema) as ZVecCollection
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const lower = msg.toLowerCase()
      if (
        lower.includes("already exist") ||
        lower.includes("alreadyexist") ||
        lower.includes("path validate failed") ||
        lower.includes("] exists")
      ) {
        this.collection = mod.ZVecOpen(this.path) as ZVecCollection
      } else {
        throw e
      }
    }
    return this.collection
  }

  index(chunks: Array<{ id: string; path: string; content: string; embedding: number[]; mtime: number }>) {
    return Effect.try({
      try: () => {
        const mod = zvec()
        if (!mod) throw new Error("zvec binding unavailable")
        const col = this.open()
        const mapped = chunks.map((c) => ({
          id: docId(c.id),
          vectors: { embedding: c.embedding },
          fields: { path: c.path, content: c.content, mtime: c.mtime },
        }))
        const BATCH_SIZE = 1000
        for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
          col.upsertSync(mapped.slice(i, i + BATCH_SIZE))
        }
      },
      catch: (e) => new Error(`Zvec index failed: ${e instanceof Error ? e.message : String(e)}`),
    })
  }

  search(query: string, embedding: number[], topK = 10) {
    return Effect.try({
      try: () => {
        const mod = zvec()
        if (!mod) throw new Error("zvec binding unavailable")
        const col = this.open()
        const results = col.querySync({
          fieldName: "embedding",
          vector: new Float32Array(embedding),
          topk: topK,
          outputFields: ["path", "content"],
          params: { indexType: mod.ZVecIndexType.HNSW, ef: 100 },
        })
        return results.map((r) => ({
          id: r.id,
          score: r.score,
          path: (r.fields?.path as string) ?? "",
          content: (r.fields?.content as string) ?? "",
        })) as SearchResult[]
      },
      catch: (e) => new Error(`Zvec search failed: ${e instanceof Error ? e.message : String(e)}`),
    })
  }

  delete(ids: string[]) {
    return Effect.try({
      try: () => {
        const mod = zvec()
        if (!mod) throw new Error("zvec binding unavailable")
        if (ids.length === 0) return
        const col = this.open()
        col.deleteSync(ids.map(docId))
      },
      catch: (e) => new Error(`Zvec delete failed: ${e instanceof Error ? e.message : String(e)}`),
    })
  }

  reset() {
    return Effect.try({
      try: () => {
        if (this.collection) {
          try {
            this.collection.destroySync()
          } catch (e) {
            log.warn("zvec reset: destroySync failed", { error: e instanceof Error ? e.message : String(e) })
          }
          this.collection = null
        }
        const fs = require("node:fs")
        try {
          fs.rmSync(this.path, { recursive: true, force: true })
        } catch (e) {
          log.warn("zvec reset: rmSync failed", { path: this.path, error: e instanceof Error ? e.message : String(e) })
        }
      },
      catch: (e) => new Error(`Zvec reset failed: ${e instanceof Error ? e.message : String(e)}`),
    })
  }
}

const noOpSearchService: SearchServiceInterface = {
  index: () => Effect.void,
  search: () => Effect.succeed([] as SearchResult[]),
  reset: Effect.void,
  delete: () => Effect.void,
}

export const layer = Layer.effect(
  SearchService,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const state = yield* InstanceState.make(
      Effect.fn("SearchService.state")(function* () {
        const directory = yield* InstanceState.directory
        const dirHash = Hash.fast(directory)
        const indexPath = path.join(Global.Path.cache, "zvec", dirHash)
        // Ensure the parent cache dir exists, but NOT the index dir itself —
        // ZVecCreateAndOpen must create it fresh (it rejects an already-existing path,
        // and the open() fallback uses ZVecOpen only for re-opening an existing DB).
        yield* fs.ensureDir(path.join(Global.Path.cache, "zvec")).pipe(Effect.catch(() => Effect.void))
        return new ZvecIndex(indexPath)
      }),
    )

    const getIndex = Effect.fn("SearchService.getIndex")(function* () {
      return yield* InstanceState.get(state)
    })

    return {
      index: (chunks: Array<{ id: string; path: string; content: string; embedding: number[]; mtime: number }>) =>
        Effect.gen(function* () {
          const index = yield* getIndex()
          return yield* index.index(chunks)
        }),
      search: (q: string, emb: number[], k?: number) =>
        Effect.gen(function* () {
          const index = yield* getIndex()
          return yield* index.search(q, emb, k)
        }),
      reset: Effect.gen(function* () {
        const index = yield* getIndex()
        return yield* index.reset()
      }),
      delete: (ids: string[]) =>
        Effect.gen(function* () {
          const index = yield* getIndex()
          return yield* index.delete(ids)
        }),
    }
  }).pipe(Effect.catchDefect(() => Effect.succeed(noOpSearchService))),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

