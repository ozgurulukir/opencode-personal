import { Schema } from "effect"
import { NonNegativeInt, withStatics } from "@opencode-ai/core/schema"
import { zod } from "@opencode-ai/core/effect-zod"

// Single source of truth for embedding dimensions, shared with the embedding backend.
export const EMBEDDING_DEFAULTS = {
  local_dimension: 384,
  openai_dimension: 1536,
} as const

export const EmbeddingInfo = Schema.Struct({
  provider: Schema.optional(Schema.Literals(["local", "openai"])).annotate({
    description: "Embedding provider: 'local' (xenova/transformers, CPU) or 'openai' (OpenAI API)",
  }),
  model: Schema.optional(Schema.String).annotate({
    description:
      "Model identifier. For local: HuggingFace model ID (e.g. Xenova/all-MiniLM-L6-v2). For openai: OpenAI model name (e.g. text-embedding-3-small)",
  }),
  dimension: Schema.optional(NonNegativeInt).annotate({
    description: `Embedding dimension. Must match the model's output size (default: ${EMBEDDING_DEFAULTS.local_dimension} for local, ${EMBEDDING_DEFAULTS.openai_dimension} for openai)`,
  }),
  openaiApiKey: Schema.optional(Schema.String).annotate({
    description: "OpenAI API key. Required when provider is 'openai' and OPENAI_API_KEY env var is not set",
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type EmbeddingInfo = Schema.Schema.Type<typeof EmbeddingInfo>

export const SearchInfo = Schema.Struct({
  embedding: Schema.optional(EmbeddingInfo).annotate({
    description: "Embedding configuration for semantic search",
  }),
}).pipe(withStatics((s) => ({ zod: zod(s) })))

export type SearchInfo = Schema.Schema.Type<typeof SearchInfo>
