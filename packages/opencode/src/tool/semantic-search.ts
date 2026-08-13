import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { SearchService } from "@/search/search"
import { EmbeddingService } from "@/search/embedding"
import DESCRIPTION from "./semantic-search.txt"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({
    description: "Semantic search query over workspace files. Returns the most relevant code passages.",
  }),
  topK: Schema.Number.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(10))).annotate({
    description: "Number of results to return (default 10)",
  }),
})

export const SemanticSearchTool = Tool.define(
  "semantic_search",
  Effect.gen(function* () {
    const search = yield* SearchService
    const embedder = yield* EmbeddingService

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { query: string; topK: number }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "semantic_search",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              topK: params.topK,
            },
          })

          const [embedding] = yield* embedder.embed([params.query])
          const results = yield* search.search(params.query, embedding, params.topK)
          if (results.length === 0) {
            return {
              title: `Semantic search: ${params.query}`,
              output: "No results found. Try indexing the workspace first, or use a different query.",
              metadata: { results: 0 },
            }
          }
          const output = results
            .map((r, i) => `[${i + 1}] ${r.path} (score: ${r.score.toFixed(3)})\n${r.content}`)
            .join("\n\n")
          return {
            title: `Semantic search: ${params.query}`,
            output,
            metadata: { results: results.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
