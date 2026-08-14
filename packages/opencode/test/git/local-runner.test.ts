import { describe, expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import * as PlatformError from "effect/PlatformError"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { gitRunner } from "../../src/git/local-runner"

const encoder = new TextEncoder()

function fakeHandle(opts: { code: number; stdout?: string; stderr?: string }) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(0),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(opts.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
    stdout: Stream.make(encoder.encode(opts.stdout ?? "")),
    stderr: Stream.make(encoder.encode(opts.stderr ?? "")),
    all: Stream.empty,
    getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  })
}

describe("gitRunner (characterization)", () => {
  test("collects stdout, stderr, and exit code from a successful spawn", async () => {
    const spawner = ChildProcessSpawner.make(
      Effect.fnUntraced(function* () {
        return fakeHandle({ code: 0, stdout: "main\n", stderr: "warning: something\n" })
      }),
    )
    const git = gitRunner(spawner, () => ({ code: 1, text: "", stderr: "" }))

    const result = await Effect.runPromise(git(["rev-parse", "--abbrev-ref", "HEAD"]))

    expect(result).toEqual({ code: 0, text: "main\n", stderr: "warning: something\n" })
  })

  test("converts spawn failure via the injected fallback (project shape: empty stderr)", async () => {
    const spawner = ChildProcessSpawner.make(
      Effect.fnUntraced(function* () {
        return yield* Effect.fail(
          PlatformError.systemError({
            _tag: "NotFound",
            module: "ChildProcess",
            method: "spawn",
            pathOrDescriptor: "git",
          }),
        )
      }),
    )
    const git = gitRunner(spawner, () => ({ code: 1, text: "", stderr: "" }))

    const result = await Effect.runPromise(git(["status"]))

    expect(result).toEqual({ code: 1, text: "", stderr: "" })
  })

  test("converts spawn failure via the injected fallback (worktree shape: error message in stderr)", async () => {
    const spawner = ChildProcessSpawner.make(
      Effect.fnUntraced(function* () {
        return yield* Effect.fail(
          PlatformError.systemError({
            _tag: "NotFound",
            module: "ChildProcess",
            method: "spawn",
            pathOrDescriptor: "git",
          }),
        )
      }),
    )
    const git = gitRunner(spawner, (e) => ({
      code: 1,
      text: "",
      stderr: e instanceof Error ? e.message : String(e),
    }))

    const result = await Effect.runPromise(git(["status"]))

    expect(result.code).toBe(1)
    expect(result.text).toBe("")
    expect(result.stderr).toContain("git")
  })

  test("passes through non-zero exit codes without invoking the fallback", async () => {
    const spawner = ChildProcessSpawner.make(
      Effect.fnUntraced(function* () {
        return fakeHandle({ code: 128, stdout: "", stderr: "fatal: not a git repository\n" })
      }),
    )
    const git = gitRunner(spawner, () => ({ code: 1, text: "", stderr: "" }))

    const result = await Effect.runPromise(git(["status"]))

    expect(result).toEqual({ code: 128, text: "", stderr: "fatal: not a git repository\n" })
  })

  test("spawns git with the requested args (standard command inspection)", async () => {
    let seen: ChildProcess.StandardCommand | undefined
    const spawner = ChildProcessSpawner.make(
      Effect.fnUntraced(function* (command) {
        const std = ChildProcess.isStandardCommand(command) ? command : undefined
        seen = std
        return fakeHandle({ code: 0, stdout: "ok" })
      }),
    )
    const git = gitRunner(spawner, () => ({ code: 1, text: "", stderr: "" }))

    await Effect.runPromise(git(["worktree", "list", "--porcelain"], { cwd: "/tmp" }))

    expect(seen?.command).toBe("git")
    expect(seen?.args).toEqual(["worktree", "list", "--porcelain"])
  })
})
