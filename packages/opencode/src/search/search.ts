import { Effect, Context } from "effect"

export interface SearchResult {
  readonly id: string
  readonly score: number
  readonly path: string
  readonly content: string
}

export interface SearchServiceInterface {
  readonly index: (
    chunks: Array<{ id: string; path: string; content: string; embedding: number[]; mtime: number }>,
  ) => Effect.Effect<void, Error>
  readonly search: (query: string, embedding: number[], topK?: number) => Effect.Effect<SearchResult[], Error>
  readonly reset: Effect.Effect<void, Error>
  readonly delete: (ids: string[]) => Effect.Effect<void, Error>
}

export class SearchService extends Context.Service<SearchService, SearchServiceInterface>()(
  "@opencode/SearchService",
) {}

