import { afterAll, describe, expect, mock, test } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import * as os from "node:os"
import { mkdtempSync, rmSync } from "node:fs"
import * as fsNode from "node:fs/promises"
import { SearchService, type SearchServiceInterface } from "../../src/search/search"
import { EmbeddingService } from "../../src/search/embedding"
import { Hash } from "@opencode-ai/core/util/hash"
import {
  ZVecCreateAndOpen,
  ZVecCollectionSchema,
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
  ZVecInitialize,
  ZVecLogLevel,
} from "@zvec/zvec"

// Module-level variable for mock.module factory (hoisted by Bun, must be at module scope)
let _testCacheDir = ""

mock.module("@opencode-ai/core/global", () => {
  const actual = require("@opencode-ai/core/global")
  return {
    ...actual,
    Path: {
      ...actual.Path,
      get cache() {
        return _testCacheDir
      },
    },
  }
})

// mock.module() persists across test files — restore to prevent leakage (AGENTS.md).
afterAll(() => mock.restore())

// Characterization: native errors thrown by the raw binding are structurally coded
// (mirrors @zvec/zvec's isZVecError — `code` is a string starting with "ZVEC_").
function isCodedZVecError(e: unknown): e is Error & { code: string } {
  if (!(e instanceof Error)) return false
  const code = (e as Error & { code?: unknown }).code
  return typeof code === "string" && code.startsWith("ZVEC_")
}

function testSchema(dimension: number) {
  return new ZVecCollectionSchema({
    name: "workspace_search",
    vectors: {
      name: "embedding",
      dataType: ZVecDataType.VECTOR_FP32,
      dimension,
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
}

// Mock embedder with a fixed dimension — lets tests exercise non-default dimensions
// (the real lazy embedder resolves its dimension only on the first embed() call).
function embedderLayer(dimension: number) {
  return Layer.succeed(EmbeddingService, {
    embed: (texts: string[]) => Effect.succeed(texts.map(() => Array(dimension).fill(0.5))),
    resolve: Effect.void,
    dimension,
  })
}

describe("search.zvec", () => {
  test("@zvec/zvec loads and basic CRUD works", () => {
    ZVecInitialize({ logLevel: ZVecLogLevel.ERROR })

    const parent = mkdtempSync(path.join(os.tmpdir(), "opencode-zvec-smoke-"))
    const dbPath = path.join(parent, "db")
    try {
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

      const col = ZVecCreateAndOpen(dbPath, schema)
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
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  test("SearchService interface is defined and can be resolved from context", async () => {
    const mockSearchService: SearchServiceInterface = {
      open: Effect.void,
      index: () => Effect.void,
      search: () => Effect.succeed([]),
      reset: Effect.void,
      delete: () => Effect.void,
    }
    const layer = Layer.succeed(SearchService, mockSearchService)

    const resolved = await Effect.gen(function* () {
      const search = yield* SearchService
      return search
    }).pipe(Effect.provide(layer), Effect.runPromise)

    expect(resolved).toBeDefined()
    expect(resolved.index).toBeDefined()
    expect(resolved.search).toBeDefined()
    expect(resolved.reset).toBeDefined()
  })

  test("ZvecIndex delete and reset methods function correctly via defaultLayer", async () => {
    const { defaultLayer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-test-"))
    const cacheDir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-cache-"))
    _testCacheDir = cacheDir

    try {
      await Effect.gen(function* () {
        const search = yield* SearchService
        const fs = yield* AppFileSystem.Service

        const chunks = [
          {
            id: "doc1",
            path: "a.ts",
            content: "some code content here",
            embedding: Array(384).fill(0.1),
            mtime: Date.now(),
          },
          {
            id: "doc2",
            path: "b.ts",
            content: "other code content here",
            embedding: Array(384).fill(0.9),
            mtime: Date.now(),
          },
        ]

        yield* search.index(chunks)

        let results = yield* search.search("query", Array(384).fill(0.1), 2)
        expect(results.some((r) => r.path === "a.ts")).toBe(true)

        yield* search.delete(["doc1"])

        results = yield* search.search("query", Array(384).fill(0.1), 2)
        expect(results.some((r) => r.path === "a.ts")).toBe(false)
        expect(results.some((r) => r.path === "b.ts")).toBe(true)

        yield* search.reset

        // The index lives at {cache}/zvec/{dirHash} — reset must remove exactly that directory.
        const indexPath = path.join(cacheDir, "zvec", Hash.fast(dir))
        const exists = yield* fs.existsSafe(indexPath)
        expect(exists).toBe(false)
      }).pipe(
        Effect.provide(defaultLayer),
        Effect.provide(AppFileSystem.defaultLayer),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      _testCacheDir = ""
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {})
      await fsNode.rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("ZvecIndex index handles more than 1024 documents by batching", async () => {
    const { defaultLayer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-batch-test-"))
    const cacheDir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-batch-cache-"))
    _testCacheDir = cacheDir

    try {
      await Effect.gen(function* () {
        const search = yield* SearchService
        const fs = yield* AppFileSystem.Service

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

        yield* search.reset
        const indexPath = path.join(cacheDir, "zvec", Hash.fast(dir))
        expect(yield* fs.existsSafe(indexPath)).toBe(false)
      }).pipe(
        Effect.provide(defaultLayer),
        Effect.provide(AppFileSystem.defaultLayer),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      _testCacheDir = ""
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {})
      await fsNode.rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("upsert is idempotent — re-indexing the same chunk id yields a single doc", async () => {
    const { defaultLayer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-idem-ws-"))
    const cacheDir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-idem-cache-"))
    _testCacheDir = cacheDir

    try {
      await Effect.gen(function* () {
        const search = yield* SearchService
        const chunk = {
          id: "doc1",
          path: "a.ts",
          content: "some code content here",
          embedding: Array(384).fill(0.3),
          mtime: Date.now(),
        }
        yield* search.index([chunk])
        // Re-index with the same id: upsert semantics must overwrite, not duplicate.
        yield* search.index([chunk])
        const results = yield* search.search("query", Array(384).fill(0.3), 10)
        expect(results.filter((r) => r.path === "a.ts")).toHaveLength(1)
      }).pipe(
        Effect.provide(defaultLayer),
        Effect.provide(AppFileSystem.defaultLayer),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      _testCacheDir = ""
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {})
      await fsNode.rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("search on a fresh empty index returns []", async () => {
    const { defaultLayer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-empty-ws-"))
    const cacheDir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-empty-cache-"))
    _testCacheDir = cacheDir

    try {
      await Effect.gen(function* () {
        const search = yield* SearchService
        const results = yield* search.search("query", Array(384).fill(0.1), 5)
        expect(results).toEqual([])
      }).pipe(
        Effect.provide(defaultLayer),
        Effect.provide(AppFileSystem.defaultLayer),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      _testCacheDir = ""
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {})
      await fsNode.rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test("native createAndOpen on an existing path throws a coded error (ZVEC_INVALID_ARGUMENT)", () => {
    ZVecInitialize({ logLevel: ZVecLogLevel.ERROR })

    const parent = mkdtempSync(path.join(os.tmpdir(), "opencode-zvec-dupcreate-"))
    const dbPath = path.join(parent, "db")
    const col = ZVecCreateAndOpen(dbPath, testSchema(4))
    try {
      let caught: unknown
      try {
        ZVecCreateAndOpen(dbPath, testSchema(4))
      } catch (e) {
        caught = e
      }
      expect(caught).toBeDefined()
      // Locks the typed-error contract the open() fallback relies on: the raw binding
      // throws errors carrying a ZVEC_* code. This binding version uses
      // ZVEC_INVALID_ARGUMENT (not ZVEC_ALREADY_EXISTS) with a "path validate failed"
      // message — so the fallback must match the code OR the message, not the code alone.
      expect(isCodedZVecError(caught)).toBe(true)
      if (isCodedZVecError(caught)) {
        expect(caught.code).toBe("ZVEC_INVALID_ARGUMENT")
        expect(caught.message).toContain("path validate failed")
      }
    } finally {
      col.destroySync()
      rmSync(parent, { recursive: true, force: true })
    }
  })

  test("ZvecIndex.open falls back to ZVecOpen when index directory already exists", async () => {
    const { defaultLayer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-fallback-test-"))
    const cacheDir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-fallback-cache-"))
    _testCacheDir = cacheDir

    try {
      ZVecInitialize({ logLevel: ZVecLogLevel.ERROR })
      const dirHash = Hash.fast(dir)
      const indexPath = path.join(cacheDir, "zvec", dirHash)

      // Pre-populate the index directory using the native API, then close it
      await fsNode.mkdir(path.join(cacheDir, "zvec"), { recursive: true })
      const col = ZVecCreateAndOpen(indexPath, testSchema(384))
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
      _testCacheDir = ""
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {})
      await fsNode.rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // Regression (H1): the collection dimension must come from the embedder (config-driven,
  // e.g. openai=1536) — the old wrapper hardcoded 384 and every non-384 call failed
  // at the native boundary. Uses `layer` (not defaultLayer) so a mock embedder applies.
  test("dimension flows from the embedder into the collection (not hardcoded 384)", async () => {
    const { layer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-dim-ws-"))
    const cacheDir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-dim-cache-"))
    _testCacheDir = cacheDir

    try {
      await Effect.gen(function* () {
        const search = yield* SearchService
        yield* search.index([
          { id: "doc1", path: "a.ts", content: "hello world", embedding: Array(8).fill(0.5), mtime: Date.now() },
        ])
        const results = yield* search.search("q", Array(8).fill(0.5), 5)
        expect(results.some((r) => r.path === "a.ts")).toBe(true)
      }).pipe(
        Effect.provide(layer),
        Effect.provide(AppFileSystem.defaultLayer),
        Effect.provide(embedderLayer(8)),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      _testCacheDir = ""
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {})
      await fsNode.rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // Regression (H1): a persisted collection from a previous dimension must not be fed
  // mismatched vectors — open() destroys + recreates it and wipes the companion
  // manifest so consumers re-embed from scratch.
  test("dimension change on reopen migrates: old collection destroyed, manifest wiped", async () => {
    const { layer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-mig-ws-"))
    const cacheDir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-mig-cache-"))
    _testCacheDir = cacheDir

    try {
      const dirHash = Hash.fast(dir)
      const indexPath = path.join(cacheDir, "zvec", dirHash)
      const manifestPath = `${indexPath}_manifest.json`
      // Pre-populate a 384-dim collection + manifest, as a previous session would have left.
      await fsNode.mkdir(path.join(cacheDir, "zvec"), { recursive: true })
      ZVecInitialize({ logLevel: ZVecLogLevel.ERROR })
      const col = ZVecCreateAndOpen(indexPath, testSchema(384))
      col.insertSync([
        { id: "old", vectors: { embedding: Array(384).fill(0.1) }, fields: { path: "old.ts", content: "old content" } },
      ])
      col.closeSync()
      await fsNode.writeFile(
        manifestPath,
        JSON.stringify({ version: 1, files: { "old.ts": { mtime: 1, chunkIds: ["old.ts:0"] } } }),
      )

      await Effect.gen(function* () {
        const search = yield* SearchService
        const fs = yield* AppFileSystem.Service
        // Detects 384 ≠ 8, destroys + recreates, wipes the manifest.
        yield* search.open
        expect(yield* fs.existsSafe(manifestPath)).toBe(false)
        yield* search.index([
          { id: "new", path: "new.ts", content: "new content", embedding: Array(8).fill(0.5), mtime: Date.now() },
        ])
        const results = yield* search.search("q", Array(8).fill(0.5), 10)
        expect(results.some((r) => r.path === "new.ts")).toBe(true)
        expect(results.some((r) => r.path === "old.ts")).toBe(false)
      }).pipe(
        Effect.provide(layer),
        Effect.provide(AppFileSystem.defaultLayer),
        Effect.provide(embedderLayer(8)),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      _testCacheDir = ""
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {})
      await fsNode.rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // Regression: native failures surface as typed ZvecError with the native code
  // passthrough — a wrong-length embedding throws ZVEC_INVALID_ARGUMENT.
  test("wrong-dimension embeddings fail with a coded ZvecError", async () => {
    const { layer, ZvecError } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-err-ws-"))
    const cacheDir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-err-cache-"))
    _testCacheDir = cacheDir

    try {
      await Effect.gen(function* () {
        const search = yield* SearchService
        // Open first with the embedder's dimension (8) — vectors of a different
        // length must then fail as a typed error with the native code passthrough.
        yield* search.open
        const failure = yield* Effect.flip(
          search.index([
            { id: "bad", path: "bad.ts", content: "oops", embedding: Array(4).fill(0.5), mtime: Date.now() },
          ]),
        )
        expect(failure).toBeInstanceOf(ZvecError)
        expect((failure as InstanceType<typeof ZvecError>).code).toBe("ZVEC_INVALID_ARGUMENT")
      }).pipe(
        Effect.provide(layer),
        Effect.provide(AppFileSystem.defaultLayer),
        Effect.provide(embedderLayer(8)),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      _testCacheDir = ""
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {})
      await fsNode.rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // Regression: deleteSync reports ZVEC_NOT_FOUND per-doc for absent ids — deleting
  // ids that were never indexed (or already removed) must stay a benign no-op.
  test("deleting ids absent from the index is a benign no-op", async () => {
    const { defaultLayer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-del-ws-"))
    const cacheDir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-del-cache-"))
    _testCacheDir = cacheDir

    try {
      await Effect.gen(function* () {
        const search = yield* SearchService
        yield* search.delete(["never-existed-1", "never-existed-2"])
      }).pipe(
        Effect.provide(defaultLayer),
        Effect.provide(AppFileSystem.defaultLayer),
        provideInstance(dir),
        Effect.runPromise,
      )
    } finally {
      _testCacheDir = ""
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {})
      await fsNode.rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // Regression (H2): SearchService.reset must remove the companion manifest — a
  // surviving manifest made the next IndexWorkspace skip unchanged-mtime files,
  // leaving the index permanently empty after a reset.
  test("reset removes the manifest so the next IndexWorkspace re-embeds", async () => {
    const { layer } = await import("../../src/search/zvec")
    const { provideInstance } = await import("../fixture/fixture")
    const { AppFileSystem } = await import("@opencode-ai/core/filesystem")
    const { IndexWorkspace } = await import("../../src/search/indexer")

    const dir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-h2-ws-"))
    const cacheDir = await fsNode.mkdtemp(path.join(os.tmpdir(), "opencode-zvec-h2-cache-"))
    _testCacheDir = cacheDir

    let embeddedCount = 0
    const embedder = Layer.succeed(EmbeddingService, {
      embed: (texts: string[]) =>
        Effect.sync(() => {
          embeddedCount += texts.length
          return texts.map(() => Array(8).fill(0.5))
        }),
      resolve: Effect.void,
      dimension: 8,
    })

    const runIndexer = () =>
      Effect.gen(function* () {
        const run = yield* IndexWorkspace
        yield* run
      }).pipe(
        Effect.provide(layer),
        Effect.provide(AppFileSystem.defaultLayer),
        Effect.provide(embedder),
        provideInstance(dir),
        Effect.runPromise,
      )

    const reset = () =>
      Effect.gen(function* () {
        const search = yield* SearchService
        yield* search.reset
      }).pipe(
        Effect.provide(layer),
        Effect.provide(AppFileSystem.defaultLayer),
        Effect.provide(embedder),
        provideInstance(dir),
        Effect.runPromise,
      )

    const fileExists = (p: string) =>
      fsNode.stat(p).then(
        () => true,
        () => false,
      )

    try {
      await fsNode.writeFile(path.join(dir, "a.ts"), "x".repeat(300))
      const manifestPath = path.join(cacheDir, "zvec", `${Hash.fast(dir)}_manifest.json`)

      await runIndexer()
      expect(embeddedCount).toBe(1)
      expect(await fileExists(manifestPath)).toBe(true)

      await reset()
      expect(await fileExists(manifestPath)).toBe(false)

      // Unchanged mtime, but the manifest is gone — must re-embed from scratch.
      await runIndexer()
      expect(embeddedCount).toBe(2)
    } finally {
      _testCacheDir = ""
      await fsNode.rm(dir, { recursive: true, force: true }).catch(() => {})
      await fsNode.rm(cacheDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
