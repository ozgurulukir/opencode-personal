import { Effect, Layer, Context, Stream } from "effect"
import { FetchHttpClient, HttpClient } from "effect/unstable/http"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import path from "path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { InstallationChannel, InstallationVersion } from "@opencode-ai/core/installation/version"

export type Method = "curl" | "npm" | "yarn" | "pnpm" | "bun" | "brew" | "scoop" | "choco" | "unknown"

export const USER_AGENT = `opencode/${InstallationChannel}/${InstallationVersion}/${Flag.OPENCODE_CLIENT}`

export function isLocal() {
  return InstallationChannel === "local"
}

export interface Interface {
  readonly method: () => Effect.Effect<Method>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Installation") {}

export const layer: Layer.Layer<Service, never, HttpClient.HttpClient | ChildProcessSpawner.ChildProcessSpawner> =
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const text = Effect.fnUntraced(
        function* (cmd: string[], opts?: { cwd?: string; env?: Record<string, string> }) {
          const proc = ChildProcess.make(cmd[0], cmd.slice(1), {
            cwd: opts?.cwd,
            env: opts?.env,
            extendEnv: true,
            // The probes discard stderr. Leaving the pipe undrained deadlocks
            // any child that writes more than the pipe buffer (~64KB) before
            // exiting, so `exitCode` would never resolve.
            stderr: "ignore",
          })
          const handle = yield* spawner.spawn(proc)
          const out = yield* Stream.mkString(Stream.decodeText(handle.stdout))
          yield* handle.exitCode
          return out
        },
        Effect.scoped,
        Effect.catch(() => Effect.succeed("")),
      )

      const result: Interface = {
        method: Effect.fn("Installation.method")(function* () {
          if (process.execPath.includes(path.join(".opencode", "bin"))) return "curl" as Method
          if (process.execPath.includes(path.join(".local", "bin"))) return "curl" as Method
          const exec = process.execPath.toLowerCase()
          const windows = process.platform === "win32"

          const allChecks: Array<{ name: Method; command: () => Effect.Effect<string> }> = [
            { name: "npm", command: () => text(["npm", "list", "-g", "--depth=0"]) },
            { name: "yarn", command: () => text(["yarn", "global", "list"]) },
            { name: "pnpm", command: () => text(["pnpm", "list", "-g", "--depth=0"]) },
            { name: "bun", command: () => text(["bun", "pm", "ls", "-g"]) },
            { name: "brew", command: () => text(["brew", "list", "--formula", "opencode"]) },
            { name: "scoop", command: () => text(["scoop", "list", "opencode"]) },
            { name: "choco", command: () => text(["choco", "list", "--limit-output", "opencode"]) },
          ]
          const checks = allChecks.filter((check) => {
            if (check.name === "scoop" || check.name === "choco") return windows
            if (check.name === "brew") return !windows
            return true
          })

          checks.sort((a, b) => {
            const aMatches = exec.includes(a.name)
            const bMatches = exec.includes(b.name)
            if (aMatches && !bMatches) return -1
            if (!aMatches && bMatches) return 1
            return 0
          })

          // Run the remaining probes concurrently. Effect.all preserves input
          // order, so the execPath-sorted priority is kept when selecting a match.
          const results = yield* Effect.all(
            checks.map((check) => check.command().pipe(Effect.map((output) => ({ name: check.name, output })))),
            { concurrency: "unbounded" },
          )

          for (const result of results) {
            const installedName =
              result.name === "brew" || result.name === "choco" || result.name === "scoop" ? "opencode" : "opencode-ai"
            if (result.output.includes(installedName)) {
              return result.name
            }
          }

          return "unknown" as Method
        }),
      }

      return Service.of(result)
    }),
  )

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

const { runPromise } = makeRuntime(Service, defaultLayer)

export const method = () => runPromise((s) => s.method())

export * as Installation from "."
