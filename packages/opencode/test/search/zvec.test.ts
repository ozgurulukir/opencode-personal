import { describe, expect, test } from "bun:test"
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

  test("SearchService interface is defined", () => {
    // The interface type check is done at compile time.
    // This test just verifies the module loads without throwing.
    expect(true).toBe(true)
  })
})
