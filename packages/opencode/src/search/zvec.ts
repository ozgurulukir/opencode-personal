import { Effect, Layer, Schedule } from "effect"
import { createHash } from "node:crypto"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import * as Log from "@opencode-ai/core/util/log"
import { SearchService, type SearchResult, type SearchServiceInterface } from "./search"
import { EmbeddingService, defaultLayer as embeddingDefaultLayer } from "./embedding"
import { manifestPathFor } from "./manifest"
import { InstanceState } from "@/effect/instance-state"
import { lazy } from "@/util/lazy"
import type { ZVecCollection } from "@zvec/zvec"

const log = Log.create({ service: "search.zvec" })

const VECTOR_FIELD = "embedding"
const BATCH_SIZE = 1000
const LOCK_RETRY_TIMEOUT_MS = 5_000

// zvec document IDs reject characters like '/', ':' and '.'. Hash opaque IDs to
// hex at the zvec boundary — the human-readable path is kept in the `path` field.
function docId(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 24)
}

/**
 * Error type for all ZvecIndex operations. `code` passes through the native
 * `ZVEC_*` error code when the binding threw one, otherwise it identifies the
 * failed operation (`OPEN_FAILED`, `INDEX_FAILED`, `BINDING_UNAVAILABLE`, ...).
 */
export class ZvecError extends Error {
  readonly code: string

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "ZvecError"
    this.code = code
  }
}

// Structural mirror of @zvec/zvec@0.6.0's isZVecError (src/index.js:41-49). The
// official JS wrapper is intentionally bypassed (see zvec() below), but the raw
// binding throws the same coded Error objects its wrapper re-exports.
function isZVecError(e: unknown): e is Error & { code: string } {
  if (!(e instanceof Error)) return false
  const code = (e as Error & { code?: unknown }).code
  return typeof code === "string" && code.startsWith("ZVEC_")
}

// A fresh create on an existing path must fall back to ZVecOpen. This binding
// version throws ZVEC_INVALID_ARGUMENT with a "path validate failed: ... exists"
// message (not ZVEC_ALREADY_EXISTS), so match the code OR the message heuristic —
// the message fallback stays defensive for binding builds with uncoded errors.
function alreadyExists(e: unknown): boolean {
  if (isZVecError(e) && e.code === "ZVEC_ALREADY_EXISTS") return true
  const msg = e instanceof Error ? e.message : String(e)
  return /already exist|alreadyexist|path validate failed|\] exists/i.test(msg)
}

function isWriteLockError(error: { code: string; message: string }) {
  return (
    error.code === "ZVEC_FAILED_PRECONDITION" ||
    error.code === "ZVEC_UNAVAILABLE" ||
    /lock|busy|exclusive/i.test(error.message)
  )
}

function toZvecError(op: string, e: unknown): ZvecError {
  if (e instanceof ZvecError) return e
  const msg = e instanceof Error ? e.message : String(e)
  const code = isZVecError(e) ? e.code : op
  if (
    op === "OPEN_FAILED" &&
    isWriteLockError({ code, message: msg })
  ) {
    return new ZvecError(
      code,
      "The workspace search index is busy because another opencode process is writing it. Close the other process or retry shortly.",
      { cause: e },
    )
  }
  return new ZvecError(code, `Zvec ${op.toLowerCase().replace(/_/g, " ")} failed: ${msg}`, { cause: e })
}

const lockRetrySchedule = Schedule.exponential(100, 1.7).pipe(
  Schedule.either(Schedule.spaced(2_000)),
  Schedule.jittered,
  Schedule.while((meta) => meta.elapsed < LOCK_RETRY_TIMEOUT_MS),
)

// upsertSync/deleteSync return per-doc ZVecStatus {ok, code, message}. A fully-failed
// batch is systemic and fails the operation; partial failures are logged only. Codes in
// `benign` are ignored entirely: deleteSync reports ZVEC_NOT_FOUND per-doc for ids
// absent from the collection — an idempotent delete already reached its goal state.
function checkStatuses(
  op: string,
  statuses: Array<{ ok: boolean; code: string; message: string }>,
  benign: string[] = [],
) {
  const failed = statuses.filter((s) => !s.ok && !benign.includes(s.code))
  if (failed.length === 0) return
  const first = failed[0]
  if (failed.length === statuses.length) {
    throw new ZvecError(first.code, `zvec ${op}: all ${failed.length} docs failed: ${first.message}`)
  }
  log.warn(`zvec ${op}: ${failed.length}/${statuses.length} docs failed`, { code: first.code, message: first.message })
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

function buildSchema(mod: ZVecModule, dimension: number) {
  return new mod.ZVecCollectionSchema({
    name: "workspace_search",
    vectors: {
      name: VECTOR_FIELD,
      dataType: mod.ZVecDataType.VECTOR_FP32,
      dimension,
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
}

// Only a positive persisted number is trustworthy for comparison — an unreported
// dimension must not trigger a destructive migration on every open.
function dimensionMismatch(col: ZVecCollection, expected: number): number | undefined {
  try {
    const persisted = col.schema.vector(VECTOR_FIELD).dimension
    return typeof persisted === "number" && persisted > 0 && persisted !== expected ? persisted : undefined
  } catch {
    return undefined
  }
}

// All native open calls in one synchronous helper so raw throws convert to typed
// failures via Effect.try (a throw inside Effect.gen would surface as a defect).
function openNative(
  mod: ZVecModule,
  indexPath: string,
  schema: InstanceType<ZVecModule["ZVecCollectionSchema"]>,
  dimension: number,
): { collection: ZVecCollection; migrated: boolean } {
  try {
    return { collection: mod.ZVecCreateAndOpen(indexPath, schema) as ZVecCollection, migrated: false }
  } catch (e) {
    if (!alreadyExists(e)) throw e
    const col = mod.ZVecOpen(indexPath) as ZVecCollection
    const persisted = dimensionMismatch(col, dimension)
    if (persisted === undefined) return { collection: col, migrated: false }
    let docCount: number | undefined
    try {
      docCount = col.stats.docCount
    } catch {
      docCount = undefined
    }
    log.warn("zvec dimension mismatch: recreating collection", {
      path: indexPath,
      persisted,
      expected: dimension,
      docCount,
    })
    col.destroySync()
    return { collection: mod.ZVecCreateAndOpen(indexPath, schema) as ZVecCollection, migrated: true }
  }
}

export interface IndexChunk {
  readonly id: string
  readonly path: string
  readonly content: string
  readonly embedding: number[]
  readonly mtime: number
}

/**
 * Low-level wrapper around one native zvec collection (not an Effect service).
 * `dimension` is a getter evaluated once at successful `open()` — the embedding
 * backend only resolves its configured dimension on the first `embed()` call, which
 * can happen after this class is constructed.
 */
export class ZvecIndex {
  private collection: ZVecCollection | null = null
  private readonly path: string
  private readonly dimension: () => number
  private readonly fs: AppFileSystem.Interface

  constructor(path: string, dimension: () => number, fs: AppFileSystem.Interface) {
    this.path = path
    this.dimension = dimension
    this.fs = fs
  }

  /**
   * Opens (or creates) the collection. Idempotent. On reopen, validates the
   * persisted vector dimension; on mismatch, destroys the collection AND its
   * companion manifest (`{path}_manifest.json`) so consumers re-embed from
   * scratch, then recreates. Must run before consumers read the manifest
   * (open-before-read ordering), otherwise a migration wipes a manifest they
   * already hold in memory.
   *
   * `explicitDimension` (the actual embedding vector length) is authoritative when
   * available — callers that already hold vectors (index/search) must pass it,
   * because the constructor's dimension getter still returns the pre-config
   * default until the embedder resolves its config.
   */
  open(explicitDimension?: number): Effect.Effect<void, ZvecError> {
    const self = this
    return Effect.gen(function* () {
      if (self.collection) return
      const mod = zvec()
      if (!mod) return yield* Effect.fail(new ZvecError("BINDING_UNAVAILABLE", "zvec binding unavailable"))
      const dimension = explicitDimension ?? self.dimension()
      const outcome = yield* Effect.try({
        try: () => openNative(mod, self.path, buildSchema(mod, dimension), dimension),
        catch: (e) => toZvecError("OPEN_FAILED", e),
      }).pipe(Effect.retry({ while: isWriteLockError, schedule: lockRetrySchedule }))
      if (outcome.migrated) {
        // The manifest maps the destroyed vectors (chunk ids / mtimes / hashes) —
        // wipe it so consumers re-embed into the fresh collection. A failed wipe
        // leaves a manifest that skips re-embedding, so failures are loud.
        yield* self.fs.remove(manifestPathFor(self.path), { force: true }).pipe(
          Effect.catch((e) =>
            Effect.sync(() =>
              log.warn("zvec migration: manifest removal failed; re-indexing may be skipped until contents change", {
                path: manifestPathFor(self.path),
                error: e instanceof Error ? e.message : String(e),
              }),
            ),
          ),
        )
      }
      self.collection = outcome.collection
    })
  }

  index(chunks: IndexChunk[]): Effect.Effect<void, ZvecError> {
    const self = this
    return Effect.gen(function* () {
      const first = chunks[0]
      if (!first) return
      // The vector length is the authoritative dimension — the constructor getter
      // may still hold the pre-config default (see open()).
      yield* self.open(first.embedding.length)
      yield* Effect.try({
        try: () => {
          const col = self.collection
          if (!col) throw new ZvecError("OPEN_FAILED", "collection is not open")
          const mapped = chunks.map((c) => ({
            id: docId(c.id),
            vectors: { embedding: c.embedding },
            fields: { path: c.path, content: c.content, mtime: c.mtime },
          }))
          for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
            checkStatuses("index", col.upsertSync(mapped.slice(i, i + BATCH_SIZE)))
          }
        },
        catch: (e) => toZvecError("INDEX_FAILED", e),
      })
    })
  }

  search(query: string, embedding: number[], topK = 10): Effect.Effect<SearchResult[], ZvecError> {
    const self = this
    return Effect.gen(function* () {
      // See index(): the query vector length is the authoritative dimension.
      yield* self.open(embedding.length)
      return yield* Effect.try({
        try: () => {
          const col = self.collection
          if (!col) throw new ZvecError("OPEN_FAILED", "collection is not open")
          const mod = zvec()
          if (!mod) throw new ZvecError("BINDING_UNAVAILABLE", "zvec binding unavailable")
          const results = col.querySync({
            fieldName: VECTOR_FIELD,
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
        catch: (e) => toZvecError("SEARCH_FAILED", e),
      })
    })
  }

  delete(ids: string[]): Effect.Effect<void, ZvecError> {
    const self = this
    return Effect.gen(function* () {
      if (ids.length === 0) return
      yield* self.open()
      yield* Effect.try({
        try: () => {
          const col = self.collection
          if (!col) throw new ZvecError("OPEN_FAILED", "collection is not open")
          checkStatuses("delete", col.deleteSync(ids.map(docId)), ["ZVEC_NOT_FOUND"])
        },
        catch: (e) => toZvecError("DELETE_FAILED", e),
      })
    })
  }

  /**
   * Destroys the collection and removes the index directory plus its companion
   * manifest. Manifest removal is owned here: a surviving manifest would map
   * vectors that no longer exist, making the next indexing pass skip files whose
   * mtimes/hashes appear unchanged.
   */
  reset(): Effect.Effect<void> {
    const self = this
    return Effect.gen(function* () {
      if (self.collection) {
        const col = self.collection
        yield* Effect.sync(() => {
          try {
            col.destroySync()
          } catch (e) {
            log.warn("zvec reset: destroySync failed", { error: e instanceof Error ? e.message : String(e) })
          }
        })
        self.collection = null
      }
      yield* self.fs
        .remove(self.path, { recursive: true, force: true })
        .pipe(
          Effect.catch((e) =>
            Effect.sync(() =>
              log.warn("zvec reset: index dir removal failed", {
                path: self.path,
                error: e instanceof Error ? e.message : String(e),
              }),
            ),
          ),
        )
      yield* self.fs
        .remove(manifestPathFor(self.path), { force: true })
        .pipe(
          Effect.catch((e) =>
            Effect.sync(() =>
              log.warn("zvec reset: manifest removal failed", {
                path: manifestPathFor(self.path),
                error: e instanceof Error ? e.message : String(e),
              }),
            ),
          ),
        )
    })
  }

  /** Releases the native handle. Infallible: close failures are logged, never thrown. */
  close(): Effect.Effect<void> {
    const self = this
    return Effect.sync(() => {
      const col = self.collection
      self.collection = null
      if (!col) return
      try {
        col.closeSync()
      } catch (e) {
        log.warn("zvec close: closeSync failed", { error: e instanceof Error ? e.message : String(e) })
      }
    })
  }
}

export const layer = Layer.effect(
  SearchService,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const embedder = yield* EmbeddingService

    const state = yield* InstanceState.make(
      Effect.fn("SearchService.state")(function* () {
        const directory = yield* InstanceState.directory
        const dirHash = Hash.fast(directory)
        const indexPath = path.join(Global.Path.cache, "zvec", dirHash)
        // Ensure the parent cache dir exists, but NOT the index dir itself —
        // ZVecCreateAndOpen must create it fresh (it rejects an already-existing path,
        // and the open() fallback uses ZVecOpen only for re-opening an existing DB).
        yield* fs.ensureDir(path.join(Global.Path.cache, "zvec")).pipe(Effect.catch(() => Effect.void))
        const index = new ZvecIndex(indexPath, () => embedder.dimension, fs)
        yield* Effect.addFinalizer(() => index.close())
        return index
      }),
    )

    const getIndex = Effect.fn("SearchService.getIndex")(function* () {
      return yield* InstanceState.get(state)
    })

    const service: SearchServiceInterface = {
      open: Effect.gen(function* () {
        const index = yield* getIndex()
        // Resolve the embedder config first so the dimension getter reflects the
        // configured value; opening with the unresolved default could destroy a
        // valid collection via a bogus dimension migration.
        const resolved = yield* embedder.resolve.pipe(
          Effect.as(true),
          Effect.catch((e) => {
            log.warn("search: embedding config resolve failed; skipping early index open", {
              error: e instanceof Error ? e.message : String(e),
            })
            return Effect.succeed(false)
          }),
        )
        if (!resolved) return
        return yield* index.open()
      }),
      index: (chunks: IndexChunk[]) =>
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
    return service
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer), Layer.provide(embeddingDefaultLayer))
