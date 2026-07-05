import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { SearchService, type SearchServiceInterface } from "../../src/search/search"
import {
  ZVecCreateAndOpen,
  ZVecCollectionSchema,
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
  ZVecInitialize,
  ZVecLogLevel,
} from "@zvec/zvec"

describe("search.zvec", () => {
  test("@zvec/zvec loads and basic CRUD works", () => {
    ZVecInitialize({ logLevel: ZVecLogLevel.ERROR })

    const schema = new ZVecCollectionSchema({
      name: "test_search",
      vectors: {
        name: "embedding",
        dataType: ZVecDataType.VECTOR_FP32,
        dimension: 4,
        indexParams: {
          indexType: ZVecIndexType.HNSW,
          metricType: ZVecMetricType.COSINE,
          m: 10,
          efConstruction: 50,
        },
      },
      fields: [
        { name: "path", dataType: ZVecDataType.STRING },
        { name: "content", dataType: ZVecDataType.STRING },
      ],
    })

    const col = ZVecCreateAndOpen("/tmp/zvec_test_smoke", schema)
    expect(col).toBeDefined()

    col.insertSync([
      { id: "a", vectors: { embedding: [0.1, 0.2, 0.3, 0.4] }, fields: { path: "a.ts", content: "hello world" } },
      { id: "b", vectors: { embedding: [0.9, 0.8, 0.7, 0.6] }, fields: { path: "b.ts", content: "goodbye moon" } },
    ])

    const results = col.querySync({
      fieldName: "embedding",
      vector: [0.1, 0.2, 0.3, 0.4],
      topk: 2,
      outputFields: ["path", "content"],
    })

    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].id).toBeDefined()

    col.destroySync()
  })

  test("SearchService interface is defined and can be resolved from context", async () => {
    const mockSearchService: SearchServiceInterface = {
      index: () => Effect.void,
      search: () => Effect.succeed([]),
      reset: Effect.void,
    }
    const layer = Layer.succeed(SearchService, mockSearchService)

    const resolved = await Effect.gen(function* () {
      const search = yield* SearchService
      return search
    }).pipe(
      Effect.provide(layer),
      Effect.runPromise,
    )

    expect(resolved).toBeDefined()
    expect(resolved.index).toBeDefined()
    expect(resolved.search).toBeDefined()
    expect(resolved.reset).toBeDefined()
  })
})
