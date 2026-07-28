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
      delete: () => Effect.void,
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

  test("ZvecIndex delete and reset methods function correctly via defaultLayer", async () => {
    const { defaultLayer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")
    const fsNode = await import("node:fs/promises")
    const os = await import("node:os")
    const path = await import("path")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-test-"))

    try {
      await Effect.gen(function* () {
        const search = yield* SearchService
        const fs = yield* AppFileSystem.Service

        const chunks = [
          { id: "doc1", path: "a.ts", content: "some code content here", embedding: Array(384).fill(0.1), mtime: Date.now() },
          { id: "doc2", path: "b.ts", content: "other code content here", embedding: Array(384).fill(0.9), mtime: Date.now() },
        ]

        yield* search.index(chunks)

        let results = yield* search.search("query", Array(384).fill(0.1), 2)
        expect(results.some((r) => r.path === "a.ts")).toBe(true)

        yield* search.delete(["doc1"])

        results = yield* search.search("query", Array(384).fill(0.1), 2)
        expect(results.some((r) => r.path === "a.ts")).toBe(false)
        expect(results.some((r) => r.path === "b.ts")).toBe(true)

        yield* search.reset

        const indexPath = path.join(dir, ".opencode", "zvec_index")
        const exists = yield* fs.existsSafe(indexPath)
        expect(exists).toBe(false)
      }).pipe(
        Effect.provide(defaultLayer),
        Effect.provide(AppFileSystem.defaultLayer),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  })

  test("ZvecIndex index handles more than 1024 documents by batching", async () => {
    const { defaultLayer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")
    const fsNode = await import("node:fs/promises")
    const os = await import("node:os")
    const path = await import("path")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-batch-test-"))

    try {
      await Effect.gen(function* () {
        const search = yield* SearchService

        // Create 1200 chunks (exceeding 1024 limit)
        const chunks = Array.from({ length: 1200 }, (_, i) => ({
          id: `doc_${i}`,
          path: `file_${i}.ts`,
          content: `content_${i}`,
          embedding: Array(384).fill(0.1),
          mtime: Date.now(),
        }))

        // This should not throw any "Too many docs" error
        yield* search.index(chunks)

        // Verify that we can search and retrieve
        const results = yield* search.search("query", Array(384).fill(0.1), 1)
        expect(results.length).toBe(1)
        expect(results[0].id).toBeDefined()
      }).pipe(
        Effect.provide(defaultLayer),
        Effect.provide(AppFileSystem.defaultLayer),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  })

  test("ZvecIndex.open falls back to ZVecOpen when index directory already exists", async () => {
    const {
      ZVecCollectionSchema,
      ZVecDataType,
      ZVecIndexType,
      ZVecMetricType,
      ZVecInitialize,
      ZVecLogLevel,
      ZVecCreateAndOpen,
      ZVecOpen,
    } = await import("@zvec/zvec")
    const { defaultLayer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")
    const fsNode = await import("node:fs/promises")
    const os = await import("node:os")
    const path = await import("path")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-fallback-test-"))

    try {
      ZVecInitialize({ logLevel: ZVecLogLevel.ERROR })
      const indexPath = path.join(dir, ".opencode", "zvec_index")
      const schema = new ZVecCollectionSchema({
        name: "workspace_search",
        vectors: {
          name: "embedding",
          dataType: ZVecDataType.VECTOR_FP32,
          dimension: 384,
          indexParams: {
            indexType: ZVecIndexType.HNSW,
            metricType: ZVecMetricType.COSINE,
            m: 24,
            efConstruction: 100,
          },
        },
        fields: [
          { name: "path", dataType: ZVecDataType.STRING },
          { name: "content", dataType: ZVecDataType.STRING },
        ],
      })

      // Pre-populate the index directory using the native API, then close it
      const col = ZVecCreateAndOpen(indexPath, schema)
      col.insertSync([
        { id: "a", vectors: { embedding: Array(384).fill(0.1) }, fields: { path: "a.ts", content: "hello world" } },
      ])
      col.closeSync()

      // SearchService should fall back to ZVecOpen (not crash with "path validate failed")
      await Effect.gen(function* () {
        const search = yield* SearchService
        const results = yield* search.search("hello", Array(384).fill(0.1), 1)
        expect(results.length).toBe(1)
        expect(results[0].path).toBe("a.ts")
      }).pipe(
        Effect.provide(defaultLayer),
        Effect.provide(AppFileSystem.defaultLayer),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  })
})
