import { Effect, Layer, Context } from "effect"
import fs from "fs"
import os from "os"
import path from "path"
import { Config } from "@/config/config"
// Pure-WASM ONNX Runtime. Native .so-free, so it loads inside compiled binaries
// (the .node/.so dlopen problem that breaks onnxruntime-node is avoided).
import * as ort from "onnxruntime-web"
// Embed the WASM glue (.mjs factory + .wasm binary) as file assets copied locally
// (see src/search/wasm/). Bun resolves these to the real path in dev and embeds them
// in the bunfs of --compile binaries — same code, both modes. The .node/.so dlopen
// problem that breaks onnxruntime-node is avoided: this is pure WASM.
import ortWasmMjs from "./wasm/ort-wasm-simd-threaded.mjs" with { type: "file" }
import ortWasmBin from "./wasm/ort-wasm-simd-threaded.wasm" with { type: "file" }

export interface EmbeddingServiceInterface {
  readonly embed: (texts: string[]) => Effect.Effect<number[][], Error>
  readonly dimension: number
}

export class EmbeddingService extends Context.Service<EmbeddingService, EmbeddingServiceInterface>()(
  "@opencode/EmbeddingService",
) {}

// --- Local provider using onnxruntime-web (pure WASM) ---

const HF_REPO = "Xenova/all-MiniLM-L6-v2"
const HF_BASE = `https://huggingface.co/${HF_REPO}/resolve/main`

function modelCacheDir(): string {
  return path.join(os.homedir(), ".cache", "opencode", "models", HF_REPO)
}

async function ensureDownloaded(file: string, dest: string): Promise<void> {
  if (fs.existsSync(dest)) return
  await fs.promises.mkdir(path.dirname(dest), { recursive: true })
  const res = await fetch(`${HF_BASE}/${file}`)
  if (!res.ok) throw new Error(`Failed to download ${file}: HTTP ${res.status}`)
  await fs.promises.writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

// BERT WordPiece tokenizer for all-MiniLM-L6-v2 (lowercase, accent-strip, punctuation split).
export class WordPieceTokenizer {
  private readonly vocab: Map<string, number>
  private readonly unk: number
  private readonly cls: number
  private readonly sep: number

  constructor(vocabLines: string[]) {
    this.vocab = new Map(vocabLines.map((t, i) => [t, i]))
    this.unk = this.vocab.get("[UNK]")!
    this.cls = this.vocab.get("[CLS]")!
    this.sep = this.vocab.get("[SEP]")!
  }

  private wordpiece(token: string): number[] {
    const chars = [...token]
    const out: number[] = []
    let start = 0
    while (start < chars.length) {
      let end = chars.length
      let found = ""
      while (start < end) {
        const candidate = (start > 0 ? "##" : "") + chars.slice(start, end).join("")
        if (this.vocab.has(candidate)) {
          found = candidate
          break
        }
        end--
      }
      if (!found) return [this.unk]
      out.push(this.vocab.get(found)!)
      start = end
    }
    return out
  }

  encode(text: string, maxLen = 256): { input_ids: number[]; attention_mask: number[] } {
    const normalized = text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
    const ids: number[] = [this.cls]
    const attn: number[] = [1]
    for (const word of normalized.split(" ")) {
      // split trailing/leading punctuation off each whitespace token
      const parts: string[] = []
      let cur = ""
      for (const ch of word) {
        if (/[!-/:-@[-`{-~]/.test(ch)) {
          if (cur) parts.push(cur)
          cur = ""
          parts.push(ch)
        } else {
          cur += ch
        }
      }
      if (cur) parts.push(cur)
      for (const part of parts) {
        if (ids.length >= maxLen - 1) break
        for (const id of this.wordpiece(part)) {
          if (ids.length >= maxLen - 1) break
          ids.push(id)
          attn.push(1)
        }
      }
    }
    ids.push(this.sep)
    attn.push(1)
    return { input_ids: ids, attention_mask: attn }
  }
}

function meanPool(logits: Float32Array, mask: number[], dim: number): number[] {
  const pooled = new Float32Array(dim)
  const tokens = mask.length
  let count = 0
  for (let i = 0; i < tokens; i++) {
    if (mask[i] === 0) continue
    count++
    for (let j = 0; j < dim; j++) pooled[j] += logits[i * dim + j]
  }
  for (let j = 0; j < dim; j++) pooled[j] /= count
  let norm = 0
  for (let j = 0; j < dim; j++) norm += pooled[j] * pooled[j]
  norm = Math.sqrt(norm) || 1
  const out = new Array<number>(dim)
  for (let j = 0; j < dim; j++) out[j] = pooled[j] / norm
  return out
}

function createLocalProvider(_modelId: string, dimension: number): EmbeddingServiceInterface {
  let session: ort.InferenceSession | null = null
  let tokenizer: WordPieceTokenizer | null = null
  // Memoised init so concurrent first embed() calls share a single load.
  let initPromise: Promise<void> | null = null

  const ensureReady = () => {
    if (initPromise) return initPromise
    initPromise = (async () => {
      const dir = modelCacheDir()
      const modelPath = path.join(dir, "model.onnx")
      const vocabPath = path.join(dir, "vocab.txt")
      await ensureDownloaded("onnx/model_quantized.onnx", modelPath)
      await ensureDownloaded("vocab.txt", vocabPath)
      tokenizer = new WordPieceTokenizer(fs.readFileSync(vocabPath, "utf8").split("\n"))
      const env = ort.env as unknown as { wasm: Record<string, unknown> }
      env.wasm = env.wasm ?? {}
      env.wasm.numThreads = 1
      env.wasm.wasmPaths = { mjs: ortWasmMjs, wasm: ortWasmBin }
      session = await ort.InferenceSession.create(modelPath, { executionProviders: ["wasm"] })
    })()
    return initPromise
  }

  const embed = (texts: string[]): Effect.Effect<number[][], Error> =>
    Effect.tryPromise({
      try: async () => {
        await ensureReady()
        const results: number[][] = []
        for (const text of texts) {
          const { input_ids, attention_mask } = tokenizer!.encode(text)
          const i64 = (a: number[]) => new BigInt64Array(a.map(BigInt))
          const names = session!.inputNames
          const feeds: Record<string, ort.Tensor> = {}
          feeds[names[0]] = new ort.Tensor("int64", i64(input_ids), [1, input_ids.length])
          feeds[names[1]] = new ort.Tensor("int64", i64(attention_mask), [1, attention_mask.length])
          if (names.length > 2) {
            feeds[names[2]] = new ort.Tensor("int64", new BigInt64Array(input_ids.length), [1, input_ids.length])
          }
          const out = await session!.run(feeds)
          const logits = out[session!.outputNames[0]].data as Float32Array
          results.push(meanPool(logits, attention_mask, dimension))
        }
        return results
      },
      catch: (e) => new Error(`Local embedding failed: ${e instanceof Error ? e.message : String(e)}`),
    })

  return { embed, dimension }
}

// --- OpenAI provider using AI SDK ---

function createOpenAIProvider(
  apiKey: string,
  model = "text-embedding-3-small",
  dimension = 1536,
): EmbeddingServiceInterface {
  const embed = (texts: string[]): Effect.Effect<number[][], Error> =>
    Effect.tryPromise({
      try: async () => {
        const { embedMany } = await import("ai")
        const result = await embedMany({
          model: `openai/${model}`,
          values: texts,
        })
        return result.embeddings as number[][]
      },
      catch: (e) => new Error(`OpenAI embedding failed: ${e instanceof Error ? e.message : String(e)}`),
    })

  return { embed, dimension }
}

// --- Layer ---

// Config is read lazily on first embed() (not at layer build time): reading the opencode
// config needs the Instance context, which is only bound during tool execution, not when
// the registry builds its layers at startup. The read happens via yield* inside the Effect
// so it runs in the calling fiber's context (where Instance is available).
export const layer = Layer.effect(
  EmbeddingService,
  Effect.gen(function* () {
    const config = yield* Config.Service
    let backend: EmbeddingServiceInterface | null = null

    const embed = (texts: string[]): Effect.Effect<number[][], Error> =>
      Effect.gen(function* () {
        if (!backend) {
          const cfg = (yield* config.get()) as Record<string, unknown>
          const embeddingCfg = ((cfg.search ?? {}) as Record<string, unknown>).embedding as
            | Record<string, unknown>
            | undefined
          const provider = (embeddingCfg?.provider as string) ?? "local"
          const modelId = (embeddingCfg?.model as string) ?? HF_REPO
          const dimension = (embeddingCfg?.dimension as number) ?? 384
          const apiKey =
            provider === "openai" ? ((embeddingCfg?.openaiApiKey as string) ?? process.env.OPENAI_API_KEY ?? "") : ""
          backend =
            provider === "openai" && apiKey
              ? createOpenAIProvider(apiKey, modelId, dimension)
              : createLocalProvider(modelId, dimension)
        }
        return yield* backend.embed(texts)
      })

    return { embed, dimension: 384 }
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))
