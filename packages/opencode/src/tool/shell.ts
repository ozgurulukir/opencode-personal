import { Effect } from "effect"
import * as Tool from "./tool"
import { Config } from "@/config/config"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ShellID } from "./shell/id"
import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { createShellTool } from "./shell/execute"

export { Parameters } from "./shell/prompt"

export const ShellTool = Tool.define(
  ShellID.ToolID,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* AppFileSystem.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service
    const spawner = yield* ChildProcessSpawner

    return yield* createShellTool(config, fs, trunc, plugin, spawner)
  }),
)
