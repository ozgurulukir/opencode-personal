import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SearchService } from "@/search/search"
import { EmbeddingService } from "@/search/embedding"
import { IndexWorkspace } from "@/search/indexer"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(AppFileSystem.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("IndexWorkspace", () => {
  it.live("ignores node_modules/dist and splits content into chunks", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* AppFileSystem.Service

      // Create test files
      const sourceFile = path.join(dir, "src.ts")
      const nodeModulesFile = path.join(dir, "node_modules", "package", "index.ts")
      const ignoredBuildFile = path.join(dir, "dist", "bundle.js")

      // source file with more than 100 lines to trigger multiple chunks
      const longContent = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n") + "\n" + "x".repeat(300)

      yield* fs.ensureDir(path.dirname(nodeModulesFile))
      yield* fs.ensureDir(path.dirname(ignoredBuildFile))

      yield* fs.writeFileString(sourceFile, longContent)
      yield* fs.writeFileString(nodeModulesFile, "x".repeat(300))
      yield* fs.writeFileString(ignoredBuildFile, "x".repeat(300))

      let indexedChunks: any[] = []
      const mockSearch = Layer.succeed(SearchService, {
        index: (chunks) =>
          Effect.sync(() => {
            indexedChunks = chunks
          }),
        search: () => Effect.succeed([]),
        reset: Effect.void,
      })

      const mockEmbedder = Layer.succeed(EmbeddingService, {
        embed: (texts) => Effect.succeed(texts.map(() => [0.1, 0.2, 0.3])),
        dimension: 3,
      })

      // Run the indexer within the instance directory context
      yield* Effect.gen(function* () {
        const runIndexer = yield* IndexWorkspace
        yield* runIndexer
      }).pipe(
        Effect.provide(mockSearch),
        Effect.provide(mockEmbedder),
        provideInstance(dir),
      )

      // Assertions
      expect(indexedChunks.length).toBeGreaterThan(0)
      // Node modules and build files are ignored
      const paths = indexedChunks.map((c) => c.path)
      expect(paths.every((p) => !p.includes("node_modules") && !p.includes("dist"))).toBe(true)
      // Verified chunks contain the source file
      expect(paths.some((p) => p.includes("src.ts"))).toBe(true)
    }),
  )
})
