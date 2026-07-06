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
        delete: () => Effect.void,
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

  it.live("performs incremental indexing", () =>
    Effect.gen(function* () {
      const dir = yield* tmpdirScoped()
      const fs = yield* AppFileSystem.Service

      const fileA = path.join(dir, "a.ts")
      const fileB = path.join(dir, "b.ts")

      yield* fs.writeFileString(fileA, "x".repeat(300))
      yield* fs.writeFileString(fileB, "y".repeat(300))

      let indexedChunks: any[] = []
      let deletedIds: string[] = []
      let embeddedTexts: string[] = []

      const mockSearch = Layer.succeed(SearchService, {
        index: (chunks) =>
          Effect.sync(() => {
            indexedChunks.push(...chunks)
          }),
        search: () => Effect.succeed([]),
        reset: Effect.void,
        delete: (ids) =>
          Effect.sync(() => {
            deletedIds.push(...ids)
          }),
      })

      const mockEmbedder = Layer.succeed(EmbeddingService, {
        embed: (texts) =>
          Effect.sync(() => {
            embeddedTexts.push(...texts)
            return texts.map(() => [0.1, 0.2, 0.3])
          }),
        dimension: 3,
      })

      const run = () =>
        Effect.gen(function* () {
          const runIndexer = yield* IndexWorkspace
          yield* runIndexer
        }).pipe(
          Effect.provide(mockSearch),
          Effect.provide(mockEmbedder),
          provideInstance(dir),
        )

      // First run: index both files
      yield* run()
      expect(embeddedTexts.length).toBe(2)
      expect(indexedChunks.length).toBe(2)
      expect(deletedIds.length).toBe(0)

      // Reset trackers
      embeddedTexts = []
      indexedChunks = []
      deletedIds = []

      // Second run: no changes on disk
      yield* run()
      expect(embeddedTexts.length).toBe(0)
      expect(indexedChunks.length).toBe(0)
      expect(deletedIds.length).toBe(0)

      // Third run: modify fileA
      const now = Date.now() + 5000
      const fsNode = require("node:fs/promises")
      yield* fs.writeFileString(fileA, "z".repeat(300))
      yield* Effect.tryPromise(() => fsNode.utimes(fileA, now / 1000, now / 1000))

      yield* run()
      // Only fileA should be embedded/indexed
      expect(embeddedTexts).toEqual(["z".repeat(300)])
      expect(indexedChunks.length).toBe(1)
      // FileA's old chunk should be deleted
      expect(deletedIds).toEqual([`${fileA}:0`])

      // Reset trackers
      embeddedTexts = []
      indexedChunks = []
      deletedIds = []

      // Fourth run: delete fileB
      yield* fs.remove(fileB)
      yield* run()
      expect(embeddedTexts.length).toBe(0)
      expect(indexedChunks.length).toBe(0)
      // FileB's old chunk should be deleted
      expect(deletedIds).toEqual([`${fileB}:0`])
    }),
  )
})
