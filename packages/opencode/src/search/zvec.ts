import { Effect, Layer, Context } from "effect"
import { createHash } from "node:crypto"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { SearchService, type SearchResult, type SearchServiceInterface } from "./search"
import { InstanceState } from "@/effect/instance-state"
import { lazy } from "@/util/lazy"

const log = Log.create({ service: "search.zvec" })

// zvec document IDs reject characters like '/', ':' and '.'. Hash opaque IDs to
// hex at the zvec boundary — the human-readable path is kept in the `path` field.
function docId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16)
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

const EMBEDDING_DIM = 384

class ZvecIndex {
  private collection: unknown = null
  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  private open(): unknown {
    if (this.collection) return this.collection
    const mod = zvec()
    if (!mod) throw new Error("zvec binding unavailable")
    const schema = new mod.ZVecCollectionSchema({
      name: "workspace_search",
      vectors: {
        name: "embedding",
        dataType: mod.ZVecDataType.VECTOR_FP32,
        dimension: EMBEDDING_DIM,
        indexParams: {
          indexType: mod.ZVecIndexType.HNSW,
          metricType: mod.ZVecMetricType.COSINE,
          m: 50,
          efConstruction: 200,
        },
      },
      fields: [
        { name: "path", dataType: mod.ZVecDataType.STRING },
        { name: "content", dataType: mod.ZVecDataType.STRING },
        { name: "mtime", dataType: mod.ZVecDataType.INT64 },
      ],
    })
    try {
      this.collection = mod.ZVecCreateAndOpen(this.path, schema)
    } catch {
      this.collection = mod.ZVecOpen(this.path)
    }
    return this.collection
  }

  index(chunks: Array<{ id: string; path: string; content: string; embedding: number[] }>) {
    return Effect.tryPromise({
      try: async () => {
        if (!zvec()) return
        const col = this.open()
        ;(col as any).insertSync(
          chunks.map((c) => ({
            id: docId(c.id),
            vectors: { embedding: c.embedding },
            fields: { path: c.path, content: c.content, mtime: Date.now() },
          })),
        )
      },
      catch: (e) => new Error(`Zvec index failed: ${e instanceof Error ? e.message : String(e)}`),
    })
  }

  search(query: string, embedding: number[], topK = 10) {
    return Effect.tryPromise({
      try: async () => {
        const mod = zvec()
        if (!mod) return [] as SearchResult[]
        const col = this.open()
        const results = (col as any).querySync({
          fieldName: "embedding",
          vector: new Float32Array(embedding),
          topk: topK,
          outputFields: ["path", "content"],
          params: { indexType: mod.ZVecIndexType.HNSW, ef: 100 },
        })
        return (results as any[]).map((r) => ({
          id: r.id,
          score: r.score,
          path: (r.fields?.path as string) ?? "",
          content: (r.fields?.content as string) ?? "",
        })) as SearchResult[]
      },
      catch: (e) => new Error(`Zvec search failed: ${e instanceof Error ? e.message : String(e)}`),
    })
  }

  reset() {
    return Effect.sync(() => {
      if (this.collection) {
        try {
          ;(this.collection as any).destroySync?.()
        } catch {
          // ignore
        }
        this.collection = null
      }
    })
  }
}

const noOpSearchService: SearchServiceInterface = {
  index: () => Effect.void,
  search: () => Effect.succeed([] as SearchResult[]),
  reset: Effect.void,
}

export const layer = Layer.effect(
  SearchService,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const state = yield* InstanceState.make(
      Effect.fn("SearchService.state")(function* () {
        const directory = yield* InstanceState.directory
        const indexPath = `${directory}/.opencode/zvec_index`
        // Ensure the parent (.opencode) exists, but NOT the index dir itself —
        // ZVecCreateAndOpen must create it fresh (it rejects an already-existing path,
        // and the open() fallback uses ZVecOpen only for re-opening an existing DB).
        yield* fs.ensureDir(`${directory}/.opencode`).pipe(Effect.catch(() => Effect.void))
        return new ZvecIndex(indexPath)
      }),
    )

    const getIndex = Effect.fn("SearchService.getIndex")(function* () {
      return yield* InstanceState.get(state)
    })

    return {
      index: (chunks: Array<{ id: string; path: string; content: string; embedding: number[] }>) =>
        Effect.gen(function* () {
          const index = yield* getIndex()
          return yield* index.index(chunks)
        }),
      search: (q: string, emb: number[], k?: number) =>
        Effect.gen(function* () {
          const index = yield* getIndex()
          return yield* index.search(q, emb, k)
        }),
      reset: Effect.void,
    }
  }).pipe(Effect.catchDefect(() => Effect.succeed(noOpSearchService))),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))
