import { Effect, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

export type GitResult = { code: number; text: string; stderr: string }

/**
 * Builds a local git runner: spawns `git` with the given args, collects
 * stdout/stderr concurrently, and reports the exit code. Spawn/collect
 * failures are converted into a GitResult by the per-caller `fallback`
 * (project returns empty stderr; worktree surfaces the error message).
 * Pinned by test/git/local-runner.test.ts.
 */
export function gitRunner(
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  fallback: (error: unknown) => GitResult,
) {
  return Effect.fnUntraced(
    function* (args: string[], opts?: { cwd?: string }) {
      const handle = yield* spawner.spawn(
        ChildProcess.make("git", args, { cwd: opts?.cwd, extendEnv: true, stdin: "ignore" }),
      )
      const [text, stderr] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
        { concurrency: 2 },
      )
      const code = yield* handle.exitCode
      return { code, text, stderr } satisfies GitResult
    },
    Effect.scoped,
    Effect.catch((e) => Effect.succeed(fallback(e))),
  )
}
