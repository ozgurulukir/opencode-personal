import { Effect } from "effect"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Path as GlobalPath } from "@opencode-ai/core/global"
import { Hash } from "@opencode-ai/core/util/hash"
import { SearchService } from "./search"
import { EmbeddingService } from "./embedding"
import { manifestPathFor } from "./manifest"
import { InstanceState } from "@/effect/instance-state"
import { FileIgnore } from "@/file/ignore"
import * as NFS from "node:fs/promises"

export const CHUNK_LINES = 100
export const CHUNK_MIN_CHARS = 200
export const EMBED_BATCH = 64

const ANSI_ESCAPE_RE = /\u001b\[[0-9;]*[a-zA-Z]/g
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "")
}

export interface Chunk {
  readonly id: string
  readonly path: string
  readonly content: string
  readonly mtime: number
}

export function chunkFile(file: string, content: string, mtime: number): Chunk[] {
  const cleanContent = stripAnsi(content)
  const lines = cleanContent.split("\n")
  const chunks: Chunk[] = []
  if (lines.length <= CHUNK_LINES) {
    const trimmed = cleanContent.trim()
    if (trimmed.length >= CHUNK_MIN_CHARS) {
      chunks.push({ id: `${file}:0`, path: file, content: trimmed, mtime })
    }
    return chunks
  }
  for (let i = 0; i < lines.length; i += CHUNK_LINES) {
    const slice = lines.slice(i, i + CHUNK_LINES).join("\n")
    const trimmed = slice.trim()
    if (trimmed.length >= CHUNK_MIN_CHARS) {
      chunks.push({ id: `${file}:${i}`, path: file, content: trimmed, mtime })
    }
  }
  return chunks
}

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

    const dirHash = Hash.fast(directory)
    yield* fs.ensureDir(path.join(GlobalPath.cache, "zvec")).pipe(Effect.catch(() => Effect.void))
    const manifestPath = manifestPathFor(path.join(GlobalPath.cache, "zvec", dirHash))
    // Open before reading the manifest: a dimension migration inside open() wipes
    // the manifest, so a copy read before open() would resurrect stale entries.
    yield* search.open
    const manifestExists = yield* fs.existsSafe(manifestPath)
    let manifest: { version: number; files: Record<string, { mtime: number; chunkIds: string[] }> } = {
      version: 1,
      files: {},
    }
    if (manifestExists) {
      try {
        const raw = yield* fs.readJson(manifestPath)
        if (raw && typeof raw === "object" && (raw as any).version === 1 && (raw as any).files) {
          manifest = raw as any
        }
      } catch {
        // ignore corruption
      }
    }

    const chunkIdsToDelete: string[] = []
    const filesToIndex: Array<{ path: string; mtime: number }> = []
    const globbedPaths = new Set<string>()

    for (const file of files) {
      const normalized = file.replace(/\\/g, "/")
      if (FileIgnore.match(normalized)) {
        continue
      }
      globbedPaths.add(file)

      try {
        const stat = yield* Effect.tryPromise(() => NFS.stat(file))
        const mtime = stat.mtimeMs
        const existing = manifest.files[file]
        if (!existing || existing.mtime !== mtime) {
          if (existing) {
            chunkIdsToDelete.push(...existing.chunkIds)
          }
          filesToIndex.push({ path: file, mtime })
        }
      } catch {
        // skip unreadable files
      }
    }

    // Find deleted files
    const deletedFiles: string[] = []
    for (const cachedPath of Object.keys(manifest.files)) {
      if (!globbedPaths.has(cachedPath)) {
        deletedFiles.push(cachedPath)
        chunkIdsToDelete.push(...manifest.files[cachedPath].chunkIds)
      }
    }

    // Perform deletions
    if (chunkIdsToDelete.length > 0) {
      yield* search.delete(chunkIdsToDelete)
    }

    // Process new/modified files
    const newChunks: Chunk[] = []
    for (const fileInfo of filesToIndex) {
      try {
        const content = yield* fs.readFileString(fileInfo.path).pipe(Effect.catch(() => Effect.succeed("")))
        if (!content) continue
        const fileChunks = chunkFile(fileInfo.path, content, fileInfo.mtime)
        if (fileChunks.length > 0) {
          newChunks.push(...fileChunks)
          manifest.files[fileInfo.path] = {
            mtime: fileInfo.mtime,
            chunkIds: fileChunks.map((c) => c.id),
          }
        } else {
          // If no chunks generated, clean up the file entry
          delete manifest.files[fileInfo.path]
        }
      } catch {
        // skip read failures
      }
    }

    // Embed and index new chunks
    if (newChunks.length > 0) {
      const allEmbeddings: number[][] = []
      for (let i = 0; i < newChunks.length; i += EMBED_BATCH) {
        const batch = newChunks.slice(i, i + EMBED_BATCH).map((c) => c.content)
        const embeddings = yield* embedder.embed(batch)
        allEmbeddings.push(...embeddings)
      }

      const enriched = newChunks.map((c, i) => ({ ...c, embedding: allEmbeddings[i] }))
      yield* search.index(enriched)
    }

    // Clean up deleted files from manifest
    for (const file of deletedFiles) {
      delete manifest.files[file]
    }

    // Save manifest
    yield* fs.writeJson(manifestPath, manifest)
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
