import { Schema } from "effect"
import * as path from "path"
import { Effect } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import { createTwoFilesPatch } from "@opencode-ai/diff-wasm"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Format } from "../format"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { trimDiff } from "./edit.replacer"
import { assertExternalDirectoryEffect } from "./external-directory"
import * as Bom from "@/util/bom"
import { Todo } from "../session/todo"
import fs from "fs"

const MAX_PROJECT_DIAGNOSTICS_FILES = 5

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

export const Parameters = Schema.Struct({
  content: Schema.String.annotate({ description: "The content to write to the file" }),
  filePath: Schema.String.annotate({
    description: "The absolute path to the file to write (must be absolute, not relative)",
  }),
})

export const WriteTool = Tool.define<
  typeof Parameters,
  { diagnostics: Record<string, any>; filepath: string; exists: boolean },
  LSP.Service | AppFileSystem.Service | Bus.Service | Format.Service | Todo.Service
>(
  "write",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service
    const format = yield* Format.Service
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: { content: string; filePath: string }, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.filePath)
            ? params.filePath
            : path.join(instance.directory, params.filePath)
          const resolvedFilepath = resolvePath(filepath, instance)
          if (!resolvedFilepath.startsWith(instance.directory + path.sep) && resolvedFilepath !== instance.directory) {
            return yield* Effect.fail(new Error(`Path escapes project directory: ${resolvedFilepath}`))
          }
          yield* assertExternalDirectoryEffect(ctx, resolvedFilepath)

          const exists = yield* fs.existsSafe(resolvedFilepath)
          const source = exists ? yield* Bom.readFile(fs, resolvedFilepath) : { bom: false, text: "" }
          const next = Bom.split(params.content)
          const desiredBom = source.bom || next.bom
          const contentOld = source.text
          const contentNew = next.text

          const diff = trimDiff(
            (yield* Effect.tryPromise({
              try: () => createTwoFilesPatch(resolvedFilepath, resolvedFilepath, contentOld, contentNew),
              catch: (error) =>
                new Error(
                  `createTwoFilesPatch failed for ${resolvedFilepath}: ${error instanceof Error ? error.message : String(error)}`,
                ),
            })) as string,
          )
          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, resolvedFilepath)],
            always: ["*"],
            metadata: {
              filepath: resolvedFilepath,
              diff,
            },
          })

          yield* fs.writeWithDirs(resolvedFilepath, Bom.join(contentNew, desiredBom))
          if (yield* format.file(resolvedFilepath)) {
            yield* Bom.syncFile(fs, resolvedFilepath, desiredBom)
          }
          yield* bus.publish(File.Event.Edited, { file: resolvedFilepath })
          yield* bus.publish(FileWatcher.Event.Updated, {
            file: resolvedFilepath,
            event: exists ? "change" : "add",
          })

          yield* todo.autoclose(ctx.sessionID, [{ filePath: resolvedFilepath, diff }])

          let output = "Wrote file successfully."
          yield* lsp.touchFile(resolvedFilepath, "document")
          const diagnostics = yield* lsp.diagnostics()
          const normalizedFilepath = AppFileSystem.normalizePath(resolvedFilepath)
          let projectDiagnosticsCount = 0
          for (const [file, issues] of Object.entries(diagnostics)) {
            const current = file === normalizedFilepath
            if (!current && projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
            const block = LSP.Diagnostic.report(current ? resolvedFilepath : file, issues)
            if (!block) continue
            if (current) {
              output += `\n\nLSP errors detected in this file, please fix:\n${block}`
              continue
            }
            projectDiagnosticsCount++
            output += `\n\nLSP errors detected in other files:\n${block}`
          }

          return {
            title: path.relative(instance.worktree, resolvedFilepath),
            metadata: {
              diagnostics,
              filepath: resolvedFilepath,
              exists: exists,
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)
