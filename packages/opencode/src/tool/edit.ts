import * as path from "path"
import { Effect, Schema, Semaphore } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import { createTwoFilesPatch, diffLines } from "@opencode-ai/diff-wasm"
import DESCRIPTION from "./edit.txt"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Bus } from "../bus"
import { Format } from "../format"
import { InstanceState } from "@/effect/instance-state"
import { Snapshot } from "@/snapshot"
import { assertExternalDirectoryEffect } from "./external-directory"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Bom from "@/util/bom"
import { replace, trimDiff } from "./edit.replacer"
import { Todo } from "../session/todo"
import fs from "fs"

function normalizeLineEndings(text: string): string {
  return text.replaceAll("\r\n", "\n")
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

function convertToLineEnding(text: string, ending: "\n" | "\r\n"): string {
  if (ending === "\n") return text
  return text.replaceAll("\n", "\r\n")
}

function resolvePath(filePath: string, instance: { directory: string; worktree: string }): string {
  const resolved = AppFileSystem.resolve(path.resolve(filePath))
  try {
    const real = fs.realpathSync(resolved)
    return real
  } catch {
    // Non-existent file: resolve the parent directory to catch symlinks in the path
    const parent = path.dirname(resolved)
    try {
      const realParent = fs.realpathSync(parent)
      return path.join(realParent, path.basename(resolved))
    } catch {
      return resolved
    }
  }
}

const locks = new Map<string, Semaphore.Semaphore>()

function lock(filePath: string) {
  const resolvedFilePath = AppFileSystem.resolve(filePath)
  const hit = locks.get(resolvedFilePath)
  if (hit) return hit

  const next = Semaphore.makeUnsafe(1)
  locks.set(resolvedFilePath, next)
  return next
}

export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file to modify" }),
  oldString: Schema.String.annotate({ description: "The text to replace" }),
  newString: Schema.String.annotate({
    description: "The text to replace it with (must be different from oldString)",
  }),
  replaceAll: Schema.optional(Schema.Boolean).annotate({
    description: "Replace all occurrences of oldString (default false)",
  }),
})

export const EditTool = Tool.define<
  typeof Parameters,
  { diagnostics: Record<string, any>; diff: string; filediff: Snapshot.FileDiff },
  LSP.Service | AppFileSystem.Service | Format.Service | Bus.Service | Todo.Service
>(
  "edit",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* AppFileSystem.Service
    const format = yield* Format.Service
    const bus = yield* Bus.Service
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.filePath) {
            throw new Error("filePath is required")
          }

          if (params.oldString === params.newString) {
            throw new Error("No changes to apply: oldString and newString are identical.")
          }

          const instance = yield* InstanceState.context
          const filePath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)
          const resolvedFilePath = resolvePath(filePath, instance)
          if (!resolvedFilePath.startsWith(instance.directory + path.sep) && resolvedFilePath !== instance.directory) {
            throw new Error(`Path escapes project directory: ${resolvedFilePath}`)
          }
          yield* assertExternalDirectoryEffect(ctx, resolvedFilePath)

          let diff = ""
          let contentOld = ""
          let contentNew = ""
          yield* lock(resolvedFilePath).withPermits(1)(
            Effect.gen(function* () {
              if (params.oldString === "") {
                const existed = yield* afs.existsSafe(resolvedFilePath)
                const source = existed ? yield* Bom.readFile(afs, resolvedFilePath) : { bom: false, text: "" }
                const next = Bom.split(params.newString)
                const desiredBom = source.bom || next.bom
                contentOld = source.text
                contentNew = next.text
                diff = trimDiff(
                  (yield* Effect.tryPromise({
                    try: () => createTwoFilesPatch(resolvedFilePath, resolvedFilePath, contentOld, contentNew),
                    catch: (error) =>
                      new Error(
                        `createTwoFilesPatch failed for ${resolvedFilePath}: ${error instanceof Error ? error.message : String(error)}`,
                      ),
                  })) as string,
                )
                yield* ctx.ask({
                  permission: "edit",
                  patterns: [path.relative(instance.worktree, resolvedFilePath)],
                  always: ["*"],
                  metadata: {
                    filepath: resolvedFilePath,
                    diff,
                  },
                })
                yield* afs.writeWithDirs(resolvedFilePath, Bom.join(contentNew, desiredBom))
                if (yield* format.file(resolvedFilePath)) {
                  contentNew = yield* Bom.syncFile(afs, resolvedFilePath, desiredBom)
                }
                yield* bus.publish(File.Event.Edited, { file: resolvedFilePath })
                yield* bus.publish(FileWatcher.Event.Updated, {
                  file: resolvedFilePath,
                  event: existed ? "change" : "add",
                })
                yield* todo.autoclose(ctx.sessionID, [{ filePath: resolvedFilePath, diff }])
                return
              }

              const info = yield* afs.stat(resolvedFilePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (!info) throw new Error(`File ${resolvedFilePath} not found`)
              if (info.type === "Directory") throw new Error(`Path is a directory, not a file: ${resolvedFilePath}`)
              const source = yield* Bom.readFile(afs, resolvedFilePath)
              contentOld = source.text

              const ending = detectLineEnding(contentOld)
              const old = convertToLineEnding(normalizeLineEndings(params.oldString), ending)
              const replacement = convertToLineEnding(normalizeLineEndings(params.newString), ending)

               const next = Bom.split(replace(contentOld, old, replacement, params.replaceAll))
              const desiredBom = source.bom || next.bom
              contentNew = next.text

              diff = trimDiff(
                (yield* Effect.tryPromise({
                  try: () =>
                    createTwoFilesPatch(
                      resolvedFilePath,
                      resolvedFilePath,
                      normalizeLineEndings(contentOld),
                      normalizeLineEndings(contentNew),
                    ),
                  catch: (error) =>
                    new Error(
                      `createTwoFilesPatch failed for ${resolvedFilePath}: ${error instanceof Error ? error.message : String(error)}`,
                    ),
                })) as string,
              )
              yield* ctx.ask({
                permission: "edit",
                patterns: [path.relative(instance.worktree, resolvedFilePath)],
                always: ["*"],
                metadata: {
                  filepath: resolvedFilePath,
                  diff,
                },
              })

              yield* afs.writeWithDirs(resolvedFilePath, Bom.join(contentNew, desiredBom))
              if (yield* format.file(resolvedFilePath)) {
                contentNew = yield* Bom.syncFile(afs, resolvedFilePath, desiredBom)
              }
              yield* bus.publish(File.Event.Edited, { file: resolvedFilePath })
              yield* bus.publish(FileWatcher.Event.Updated, {
                file: resolvedFilePath,
                event: "change",
              })
            }).pipe(Effect.orDie),
          )

          let additions = 0
          let deletions = 0
          for (const change of yield* Effect.tryPromise({
            try: () => diffLines(contentOld, contentNew),
            catch: (error) =>
              new Error(
                `diffLines failed for ${resolvedFilePath}: ${error instanceof Error ? error.message : String(error)}`,
              ),
          })) {
            if (change.added) additions += change.count || 0
            if (change.removed) deletions += change.count || 0
          }
          const filediff: Snapshot.FileDiff = {
            file: resolvedFilePath,
            patch: diff,
            additions,
            deletions,
          }

          yield* ctx.metadata({
            metadata: {
              diff,
              filediff,
              diagnostics: {},
            },
          })

          yield* todo.autoclose(ctx.sessionID, [{ filePath: resolvedFilePath, diff }])

          let output = "Edit applied successfully."
          yield* lsp.touchFile(resolvedFilePath, "document")
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilePath = AppFileSystem.normalizePath(resolvedFilePath)
          const block = LSP.Diagnostic.report(resolvedFilePath, diagnostics[normalizedFilePath] ?? [])
          if (block) output += `\n\nLSP errors detected in this file, please fix:\n${block}`

          return {
            metadata: {
              diagnostics,
              diff,
              filediff,
            },
            title: `${path.relative(instance.worktree, resolvedFilePath)}`,
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
