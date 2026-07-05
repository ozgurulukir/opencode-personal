import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { SearchService } from "@/search/search"
import { EmbeddingService } from "@/search/embedding"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./index-workspace.txt"

const CHUNK_LINES = 100
const CHUNK_MIN_CHARS = 200
const EMBED_BATCH = 32

// Strip ANSI/VT100 escape sequences (color codes, cursor moves, etc.) so raw
// terminal output files don't pollute the embedding space.
const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*[a-zA-Z]/g
function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "")
}

export const Parameters = Schema.Struct({
  force: Schema.Boolean.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description: "Force re-indexing all files even if already indexed (default false)",
  }),
})

export const IndexWorkspaceTool = Tool.define(
  "index_workspace",
  Effect.gen(function* () {
    const search = yield* SearchService
    const embedder = yield* EmbeddingService
    const fs = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { force: boolean }) =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const files = yield* fs.glob("**/*.{ts,js,tsx,jsx,py,rs,go,md,txt,json,yaml,yml,sh,bash}", {
            cwd: directory,
            absolute: true,
            dot: false,
          })

          const chunks: Array<{ id: string; path: string; content: string }> = []

          for (const file of files) {
            const normalized = file.replace(/\\/g, "/")
            if (
              normalized.includes("node_modules") ||
              normalized.includes("/dist/") ||
              normalized.includes("/.git/") ||
              normalized.includes("/build/")
            ) {
              continue
            }
            const content = stripAnsi(yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed(""))))
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
          }

          if (chunks.length === 0) {
            return {
              title: "Workspace indexed",
              output: "No indexable files found in workspace.",
              metadata: { files: 0, chunks: 0 },
            }
          }

          if (params.force) {
            yield* search.reset
          }

          const allEmbeddings: number[][] = []
          for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
            const batch = chunks.slice(i, i + EMBED_BATCH).map((c) => c.content)
            const embeddings = yield* embedder.embed(batch)
            allEmbeddings.push(...embeddings)
          }

          const enriched = chunks.map((c, i) => ({ ...c, embedding: allEmbeddings[i] }))
          yield* search.index(enriched)

          const uniqueFiles = new Set(chunks.map((c) => c.path))
          return {
            title: "Workspace indexed",
            output: `Indexed ${uniqueFiles.size} files (${chunks.length} chunks) using ${embedder.dimension}-dim embeddings.`,
            metadata: { files: uniqueFiles.size, chunks: chunks.length },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
