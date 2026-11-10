/**
 * Recall benchmark for the workspace-search HNSW tuning (#101).
 *
 * Measures recall@10 of the current tuning (m=24, efConstruction=100, query ef=100)
 * against FLAT (brute-force) ground truth on a clustered synthetic corpus, and
 * compares it with the library-default tuning (m=50, efConstruction=500, query
 * ef=300). Embeddings are synthetic: HNSW recall depends on vector geometry, not
 * semantics, so random clustered vectors are a valid probe for index tuning.
 *
 * Run from packages/opencode: bun script/search-recall.ts
 */
import os from "os"
import path from "path"
import fs from "node:fs"

const DIM = 64
const DOCS = 2000
const CLUSTERS = 20
const QUERIES = 50
const TOPK = 10

const b = require(`@zvec/bindings-${process.platform}-${process.arch}`) as Record<string, any>
b.initialize({ logLevel: b.LogLevel.ERROR })
const mod = {
  ZVecDataType: b.DataType,
  ZVecIndexType: b.IndexType,
  ZVecMetricType: b.MetricType,
  ZVecCollectionSchema: b.CollectionSchema,
  ZVecInitialize: b.initialize,
  ZVecCreateAndOpen: b.createAndOpen,
  ZVecOpen: b.open,
}

// Clustered corpus: docs sit near one of CLUSTERS centroids, queries are jittered
// points near the same centroids — close enough to the real "semantic neighborhoods"
// distribution that HNSW graph quality is meaningfully exercised.
function randomVector(scale = 1): number[] {
  return Array.from({ length: DIM }, () => (Math.random() * 2 - 1) * scale)
}

const centroids = Array.from({ length: CLUSTERS }, () => randomVector(4))
const corpus: number[][] = Array.from({ length: DOCS }, (_, i) => {
  const c = centroids[i % CLUSTERS]!
  return c.map((v) => v + (Math.random() * 2 - 1) * 0.5)
})
const queryVectors = Array.from({ length: QUERIES }, () => {
  const c = centroids[Math.floor(Math.random() * CLUSTERS)]!
  return c.map((v) => v + (Math.random() * 2 - 1) * 0.5)
})

function schema(m: number, efConstruction: number) {
  return new mod.ZVecCollectionSchema({
    name: "recall_bench",
    vectors: {
      name: "embedding",
      dataType: mod.ZVecDataType.VECTOR_FP32,
      dimension: DIM,
      indexParams: {
        indexType: mod.ZVecIndexType.HNSW,
        metricType: mod.ZVecMetricType.COSINE,
        m,
        efConstruction,
      },
    },
    fields: [{ name: "content", dataType: mod.ZVecDataType.STRING }],
  })
}

function openFlat(dir: string) {
  return mod.ZVecCreateAndOpen(
    dir,
    new mod.ZVecCollectionSchema({
      name: "recall_bench",
      vectors: {
        name: "embedding",
        dataType: mod.ZVecDataType.VECTOR_FP32,
        dimension: DIM,
        indexParams: { indexType: mod.ZVecIndexType.FLAT, metricType: mod.ZVecMetricType.COSINE },
      },
      fields: [{ name: "content", dataType: mod.ZVecDataType.STRING }],
    }),
  )
}

function indexAll(col: any) {
  const mapped = corpus.map((vec, i) => ({
    id: String(i),
    vectors: { embedding: vec },
    fields: { content: `doc ${i}` },
  }))
  for (let i = 0; i < mapped.length; i += 1000) col.upsertSync(mapped.slice(i, i + 1000))
}

function top10(col: any, vec: number[], ef?: number): Set<string> {
  const params: Record<string, unknown> = { indexType: mod.ZVecIndexType.HNSW }
  if (ef !== undefined) params.ef = ef
  // FLAT collections reject an explicit indexType in QueryParams — omit params
  // there and let the engine pick the collection's own index.
  const results = col.querySync({
    fieldName: "embedding",
    vector: vec,
    topk: TOPK,
    outputFields: [],
    ...(ef !== undefined ? { params } : {}),
  })
  return new Set(results.map((r: any) => r.id))
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zvec-recall-"))

try {
  const flat = openFlat(path.join(dir, "flat"))
  indexAll(flat)
  const truth = queryVectors.map((q) => top10(flat, q))

  const configs = [
    { label: "current (m=24, efC=100, ef=100)", m: 24, efC: 100, ef: 100 },
    { label: "default (m=50, efC=500, ef=300)", m: 50, efC: 500, ef: 300 },
  ]

  for (const cfg of configs) {
    const col = mod.ZVecCreateAndOpen(path.join(dir, `hnsw-${cfg.m}-${cfg.efC}`), schema(cfg.m, cfg.efC))
    const t0 = performance.now()
    indexAll(col)
    const indexMs = performance.now() - t0
    const q0 = performance.now()
    const recalls = queryVectors.map((q, i) => {
      const got = top10(col, q, cfg.ef)
      let hits = 0
      for (const id of got) if (truth[i]!.has(id)) hits++
      return hits / TOPK
    })
    const queryMs = (performance.now() - q0) / QUERIES
    const mean = recalls.reduce((a, r) => a + r, 0) / recalls.length
    const min = Math.min(...recalls)
    console.log(
      `${cfg.label}: recall@${TOPK} mean=${mean.toFixed(3)} min=${min.toFixed(3)} | index=${indexMs.toFixed(0)}ms, query=${queryMs.toFixed(2)}ms`,
    )
    // destroySync implies close; calling both trips ZVEC_FAILED_PRECONDITION
    col.destroySync()
  }
  flat.destroySync()
} finally {
  // Windows can hold the directory lock briefly after closeSync; cleanup is
  // best-effort — the OS temp dir sweeper gets it eventually.
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}
