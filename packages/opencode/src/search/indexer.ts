import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { SearchService } from "./search"
import { EmbeddingService } from "./embedding"
import { InstanceState } from "@/effect/instance-state"

const CHUNK_LINES = 100
const CHUNK_MIN_CHARS = 200
const EMBED_BATCH = 64

export const IndexWorkspace = Effect.gen(function* () {
  const fs = yield* AppFileSystem.Service
  const search = yield* SearchService
  const embedder = yield* EmbeddingService

  return Effect.gen(function* () {
    const directory = yield* InstanceState.directory
    const files = yield* fs.glob("**/*.{ts,js,tsx,jsx,py,rs,go,md,txt,json,yaml,yml,sh,bash}", {
      cwd: directory,
      absolute: true,
      dot: false,
    })

    const chunks: Array<{ id: string; path: string; content: string }> = []

    for (const file of files) {
      if (
        file.includes("node_modules") ||
        file.includes("/dist/") ||
        file.includes("/.git/") ||
        file.includes("/build/")
      ) {
        continue
      }
      try {
        const content = yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed("")))
        if (!content) continue
        const lines = content.split("\n")
        if (lines.length <= CHUNK_LINES) {
          const trimmed = content.trim()
          if (trimmed.length >= CHUNK_MIN_CHARS) {
            chunks.push({ id: `${file}:0`, path: file, content: trimmed })
          }
          continue
        }
        for (let i = 0; i < lines.length; i += CHUNK_LINES) {
          const slice = lines.slice(i, i + CHUNK_LINES).join("\n")
          const trimmed = slice.trim()
          if (trimmed.length >= CHUNK_MIN_CHARS) {
            chunks.push({ id: `${file}:${i}`, path: file, content: trimmed })
          }
        }
      } catch {
        // skip unreadable files
      }
    }

    if (chunks.length === 0) return

    // Embed in batches
    const allEmbeddings: number[][] = []
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH).map((c) => c.content)
      const embeddings = yield* embedder.embed(batch)
      allEmbeddings.push(...embeddings)
    }

    const enriched = chunks.map((c, i) => ({ ...c, embedding: allEmbeddings[i] }))
    yield* search.index(enriched)
  })
})

export const SemanticSearch = Effect.gen(function* () {
  const search = yield* SearchService
  const embedder = yield* EmbeddingService

  return {
    search: (query: string, topK = 10) =>
      Effect.gen(function* () {
        const [embedding] = yield* embedder.embed([query])
        return yield* search.search(query, embedding, topK)
      }),
  }
})
