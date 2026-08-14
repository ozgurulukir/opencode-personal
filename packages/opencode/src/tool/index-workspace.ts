import { Effect, Option, Schema } from "effect"
import path from "path"
import * as Tool from "./tool"
import { SearchService } from "@/search/search"
import { EmbeddingService } from "@/search/embedding"
import { manifestPathFor } from "@/search/manifest"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Path as GlobalPath } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { InstanceState } from "@/effect/instance-state"
import { IndexWorkspace } from "@/search/indexer"
import DESCRIPTION from "./index-workspace.txt"

export const Parameters = Schema.Struct({
  force: Schema.Boolean.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description: "Force re-indexing all files even if already indexed (default false)",
  }),
})

const Manifest = Schema.Record(
  Schema.String,
  Schema.Struct({
    chunkIds: Schema.Array(Schema.String),
  }),
)
const ManifestFile = Schema.Struct({
  files: Manifest,
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
      execute: (params: { force: boolean }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "index_workspace",
            patterns: ["*"],
            always: ["*"],
            metadata: { force: params.force },
          })

          const directory = yield* InstanceState.directory
          const manifestPath = manifestPathFor(path.join(GlobalPath.cache, "zvec", Hash.fast(directory)))

          if (params.force) {
            // reset() owns manifest removal — a surviving manifest would make the
            // next indexing pass skip files whose mtimes appear unchanged.
            yield* search.reset
          }

          yield* runIndexer

          let filesCount = 0
          let chunksCount = 0
          const manifestRaw = yield* fs
            .readJson(manifestPath)
            // Missing/corrupt manifest is not an error — just means nothing indexed yet.
            .pipe(Effect.catch(() => Effect.succeed(undefined)))
          const manifest = Option.getOrUndefined(Schema.decodeUnknownOption(ManifestFile)(manifestRaw))
          if (manifest) {
            const filePaths = Object.keys(manifest.files)
            filesCount = filePaths.length
            for (const f of filePaths) {
              chunksCount += manifest.files[f].chunkIds.length
            }
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
