// oxlint-disable typescript/no-unsafe-type-assertion
import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { FetchHttpClient } from "effect/unstable/http"
import { Installation, layer as InstallationLayer } from "../../src/installation"

const encoder = new TextEncoder()

type Spawner = ReturnType<typeof ChildProcessSpawner.make>

function handle(stdout: string) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(0),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
    stdout: Stream.make(encoder.encode(stdout)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void),
  })
}

function runWith(spawner: Spawner, execPath: string) {
  const testLayer = InstallationLayer.pipe(
    Layer.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)),
    Layer.provide(FetchHttpClient.layer),
  )
  const orig = Object.getOwnPropertyDescriptor(process, "execPath")
  Object.defineProperty(process, "execPath", { value: execPath, configurable: true })
  return Effect.runPromise(
    Effect.gen(function* () {
      const svc = yield* Installation.Service
      return yield* svc.method()
    }).pipe(
      Effect.provide(testLayer),
      Effect.ensuring(
        Effect.sync(() => {
          if (orig) Object.defineProperty(process, "execPath", orig)
        }),
      ),
    ),
  )
}

function recordingSpawner(outputFor: (command: string) => string, seen: string[]): Spawner {
  return ChildProcessSpawner.make(
    Effect.fnUntraced(function* (command) {
      const std = ChildProcess.isStandardCommand(command) ? command : undefined
      if (std) seen.push(std.command)
      return handle(std ? outputFor(std.command) : "")
    }),
  )
}

describe("Installation.method", () => {
  test("probes only platform-appropriate package managers on non-Windows", async () => {
    const seen: string[] = []
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { value: "linux", configurable: true })
    try {
      const method = await runWith(recordingSpawner(() => "nothing", seen), "/usr/local/bin/node")
      expect(method).toBe("unknown")
      expect(seen).toContain("npm")
      expect(seen).toContain("yarn")
      expect(seen).toContain("pnpm")
      expect(seen).toContain("bun")
      expect(seen).toContain("brew")
      expect(seen).not.toContain("scoop")
      expect(seen).not.toContain("choco")
    } finally {
      if (origPlatform) Object.defineProperty(process, "platform", origPlatform)
    }
  })

  test("probes scoop/choco but not brew on Windows", async () => {
    const seen: string[] = []
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform")
    Object.defineProperty(process, "platform", { value: "win32", configurable: true })
    try {
      await runWith(recordingSpawner(() => "nothing", seen), "C:\\Program Files\\node.exe")
      expect(seen).toContain("npm")
      expect(seen).toContain("scoop")
      expect(seen).toContain("choco")
      expect(seen).not.toContain("brew")
    } finally {
      if (origPlatform) Object.defineProperty(process, "platform", origPlatform)
    }
  })

  test("prefers the package manager matching execPath when multiple probes match", async () => {
    const spawner = recordingSpawner((command) => (command === "npm" || command === "bun" ? "opencode-ai" : "none"), [])
    const method = await runWith(spawner, "/usr/local/bin/bun")
    expect(method).toBe("bun")
  })
})
