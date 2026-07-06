import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { SearchService } from "@/search/search"
import { EmbeddingService } from "@/search/embedding"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { IndexWorkspace } from "@/search/indexer"
import DESCRIPTION from "./index-workspace.txt"

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
    const runIndexer = yield* IndexWorkspace

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { force: boolean }) =>
        Effect.gen(function* () {
          const directory = yield* InstanceState.directory
          const manifestPath = `${directory}/.opencode/zvec_index_manifest.json`

          if (params.force) {
            yield* search.reset
            yield* fs.remove(manifestPath, { force: true }).pipe(Effect.catch(() => Effect.void))
          }

          yield* runIndexer

          let filesCount = 0
          let chunksCount = 0
          try {
            const manifest = (yield* fs.readJson(manifestPath)) as any
            if (manifest && manifest.files) {
              const filePaths = Object.keys(manifest.files)
              filesCount = filePaths.length
              for (const f of filePaths) {
                chunksCount += manifest.files[f].chunkIds.length
              }
            }
          } catch {
            // ignore
          }

          if (filesCount === 0) {
            return {
              title: "Workspace indexed",
              output: "No indexable files found in workspace.",
              metadata: { files: 0, chunks: 0 },
            }
          }

          return {
            title: "Workspace indexed",
            output: `Indexed ${filesCount} files (${chunksCount} chunks) using ${embedder.dimension}-dim embeddings.`,
            metadata: { files: filesCount, chunks: chunksCount },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

