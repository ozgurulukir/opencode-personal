import type { ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import os from "os"
import fs from "fs/promises"
import * as Log from "@opencode-ai/core/util/log"
import { Global } from "@opencode-ai/core/global"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Process } from "@/util/process"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"
import { Archive } from "@/util/archive"
import { Module } from "@opencode-ai/core/util/module"
import { Npm } from "@opencode-ai/core/npm"
import { text } from "node:stream/consumers"
import { spawn } from "../launch"
import type { InstanceContext } from "@/project/instance"
import { venvCandidates, resolveVenvPython } from "../venv"

export {
  path,
  os,
  fs,
  text,
  Log,
  Global,
  Flag,
  Process,
  Filesystem,
  which,
  Archive,
  Module,
  Npm,
  spawn,
  venvCandidates,
  resolveVenvPython,
}
export type { ChildProcessWithoutNullStreams, InstanceContext }

export const log = Log.create({ service: "lsp.server" })

export const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)

export const run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })
export const output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })

export interface Handle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, any>
}

export type RootFunction = (file: string, ctx: InstanceContext) => Promise<string | undefined>

export const NearestRoot = (includePatterns: string[], excludePatterns?: string[]): RootFunction => {
  return async (file, ctx) => {
    if (excludePatterns) {
      const excludedFiles = Filesystem.up({
        targets: excludePatterns,
        start: path.dirname(file),
        stop: ctx.directory,
      })
      const excluded = await excludedFiles.next()
      await excludedFiles.return()
      if (excluded.value) return undefined
    }
    const files = Filesystem.up({
      targets: includePatterns,
      start: path.dirname(file),
      stop: ctx.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return ctx.directory
    return path.dirname(first.value)
  }
}

export interface Info {
  id: string
  extensions: string[]
  global?: boolean
  root: RootFunction
  spawn(root: string, ctx: InstanceContext): Promise<Handle | undefined>
}
