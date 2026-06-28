import { Effect, Layer, Context } from "effect"
import { Config } from "@/config/config"
import { HttpClient } from "effect/unstable/http"

export interface EmbeddingServiceInterface {
  readonly embed: (texts: string[]) => Effect.Effect<number[][], Error>
  readonly dimension: number
}

export class EmbeddingService extends Context.Service<EmbeddingService, EmbeddingServiceInterface>()(
  "@opencode/EmbeddingService",
) {}

// --- Local provider using @xenova/transformers ---

function createLocalProvider(modelId: string, dimension: number): EmbeddingServiceInterface {
  let pipeline: unknown = null

  const embed = (texts: string[]): Effect.Effect<number[][], Error> =>
    Effect.tryPromise({
      try: async () => {
        if (!pipeline) {
          const mod = await import("@xenova/transformers")
          const pipe = mod.pipeline as (
            task: string,
            model: string,
            options?: Record<string, unknown>,
          ) => Promise<(input: string, options?: Record<string, unknown>) => Promise<{ data: Float32Array }>>
          pipeline = await pipe("feature-extraction", modelId, {
            pooling: "mean",
            normalize: true,
          } as Record<string, unknown>)
        }
        const outputs = await Promise.all(
          texts.map((t) => (pipeline as (input: string) => Promise<{ data: Float32Array }>)(t)),
        )
        return outputs.map((o) => Array.from(o.data))
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

const noOpEmbeddingService = {
  embed: () => Effect.succeed([]),
  dimension: 384,
}

export const layer = Layer.effect(
  EmbeddingService,
  Effect.gen(function* () {
    const config = yield* Config.Service

    const cfg = (yield* config.get()) as Record<string, unknown>
    const searchCfg = (cfg.search ?? {}) as Record<string, unknown>
    const embeddingCfg = searchCfg.embedding as Record<string, unknown> | undefined

    const provider = (embeddingCfg?.provider as string) ?? "local"
    const modelId = (embeddingCfg?.model as string) ?? "Xenova/all-MiniLM-L6-v2"
    const dimension = (embeddingCfg?.dimension as number) ?? 384

    if (provider === "openai") {
      const apiKey = (embeddingCfg?.openaiApiKey as string) ?? process.env.OPENAI_API_KEY ?? ""
      if (!apiKey) {
        yield* Effect.logWarning("OPENAI_API_KEY not set for embedding provider=openai, falling back to local")
        return createLocalProvider(modelId, dimension)
      }
      return createOpenAIProvider(apiKey, modelId, dimension)
    }

    return createLocalProvider(modelId, dimension)
  }).pipe(Effect.catchDefect(() => Effect.succeed(noOpEmbeddingService))),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))
