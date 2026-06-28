import { Effect, Layer, Context } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { SearchService, type SearchResult, type SearchServiceInterface } from "./search"
import { InstanceState } from "@/effect/instance-state"

// Lazy-load @zvec/zvec to avoid breaking Bun compile mode.
// The native .node addon can't be resolved from the virtual filesystem in compiled binaries.
// In dev mode (bun dev) the package loads normally from node_modules.

type ZVecModule = typeof import("@zvec/zvec")

let zvecMod: ZVecModule | null = null
let zvecLoadFailed = false

async function getZvec(): Promise<ZVecModule | null> {
  if (zvecMod) return zvecMod
  if (zvecLoadFailed) return null
  try {
    zvecMod = await import("@zvec/zvec")
    zvecMod.ZVecInitialize({ logLevel: zvecMod.ZVecLogLevel.ERROR })
    return zvecMod
  } catch (e) {
    zvecLoadFailed = true
    return null
  }
}

const EMBEDDING_DIM = 384

class ZvecIndex {
  private collection: unknown = null
  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  private async open(zvec: ZVecModule) {
    if (this.collection) return this.collection
    const schema = new zvec.ZVecCollectionSchema({
      name: "workspace_search",
      vectors: {
        name: "embedding",
        dataType: zvec.ZVecDataType.VECTOR_FP32,
        dimension: EMBEDDING_DIM,
        indexParams: {
          indexType: zvec.ZVecIndexType.HNSW,
          metricType: zvec.ZVecMetricType.COSINE,
          m: 50,
          efConstruction: 200,
        },
      },
      fields: [
        { name: "path", dataType: zvec.ZVecDataType.STRING },
        { name: "content", dataType: zvec.ZVecDataType.STRING },
        { name: "mtime", dataType: zvec.ZVecDataType.INT64 },
      ],
    })
    try {
      this.collection = zvec.ZVecCreateAndOpen(this.path, schema)
    } catch {
      this.collection = zvec.ZVecOpen(this.path)
    }
    return this.collection
  }

  index(chunks: Array<{ id: string; path: string; content: string; embedding: number[] }>) {
    return Effect.tryPromise({
      try: async () => {
        const zvec = await getZvec()
        if (!zvec) return
        const col = await this.open(zvec)
        ;(col as any).insertSync(
          chunks.map((c) => ({
            id: c.id,
            vectors: { embedding: c.embedding },
            fields: { path: c.path, content: c.content, mtime: BigInt(Date.now()) },
          })),
        )
      },
      catch: (e) => new Error(`Zvec index failed: ${e instanceof Error ? e.message : String(e)}`),
    })
  }

  search(query: string, embedding: number[], topK = 10) {
    return Effect.tryPromise({
      try: async () => {
        const zvec = await getZvec()
        if (!zvec) return [] as SearchResult[]
        const col = await this.open(zvec)
        const results = (col as any).querySync({
          fieldName: "embedding",
          vector: new Float32Array(embedding),
          fts: { queryString: query },
          topk: topK,
          outputFields: ["path", "content"],
          params: { indexType: zvec.ZVecIndexType.HNSW, ef: 100 },
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
        yield* fs.ensureDir(indexPath).pipe(Effect.catch(() => Effect.void))
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
