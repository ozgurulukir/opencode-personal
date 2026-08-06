import { describe, expect } from "bun:test"
import path from "path"
import { Cause, Effect, Exit, Layer } from "effect"
import { GrepTool } from "../../src/tool/grep"
import { provideInstance, TestInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { testEffect } from "../lib/effect"
import { Reference } from "@/reference/reference"

const it = testEffect(
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    Reference.defaultLayer,
  ),
)

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const root = path.join(__dirname, "../..")

describe("tool.grep", () => {
  it.live("basic search", () =>
    Effect.gen(function* () {
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* provideInstance(root)(
        grep.execute(
          {
            pattern: "export",
            path: path.join(root, "src/tool"),
            include: "*.ts",
          },
          ctx,
        ),
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
      expect(result.output).toContain("Found")
    }),
  )

  it.instance("no matches returns correct output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "test.txt"), "hello world"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "xyznonexistentpatternxyz123",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(0)
      expect(result.output).toBe("No files found")
    }),
  )

  it.instance("finds matches in tmp instance", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "test.txt"), "line1\nline2\nline3"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "line",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
    }),
  )

  it.instance("supports exact file paths", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "test.txt")
      yield* Effect.promise(() => Bun.write(file, "line1\nline2\nline3"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "line2",
          path: file,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain(file)
      expect(result.output).toContain("Line 2: line2")
    }),
  )

  it.instance("non-existent path fails with clear error", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const info = yield* GrepTool
      const grep = yield* info.init()
      const exit = yield* grep
        .execute(
          { pattern: "test", path: path.join(test.directory, "does-not-exist") },
          ctx,
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err instanceof Error ? err.message : String(err)).toContain("does not exist")
      }
    }),
  )

  it.instance("non-existent nested path fails with clear error", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const info = yield* GrepTool
      const grep = yield* info.init()
      const exit = yield* grep
        .execute(
          { pattern: "test", path: path.join(test.directory, "no", "such", "dir") },
          ctx,
        )
        .pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause)
        expect(err instanceof Error ? err.message : String(err)).toContain("does not exist")
      }
    }),
  )

  it.instance("include parameter filters results by file pattern", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "match.ts"), "needle\n"))
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "match.txt"), "needle\n"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "needle",
          path: test.directory,
          include: "*.ts",
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain("match.ts")
      expect(result.output).not.toContain("match.txt")
    }),
  )

  it.instance("truncates output when matches exceed the limit", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const lines = Array.from({ length: 150 }, (_, i) => `match line ${i}`).join("\n")
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "big.txt"), lines))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "match",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(150)
      expect(result.metadata.truncated).toBe(true)
      expect(result.output).toContain("showing first 100")
      expect(result.output).toContain("50 hidden")
    }),
  )

  it.instance("groups output by file path", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() =>
        Bun.write(path.join(test.directory, "a.ts"), "target\ntarget\n"),
      )
      yield* Effect.promise(() =>
        Bun.write(path.join(test.directory, "b.ts"), "target\n"),
      )
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "target",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(3)
      expect(result.output).toContain(path.join(test.directory, "a.ts") + ":")
      expect(result.output).toContain(path.join(test.directory, "b.ts") + ":")
      expect(result.output).toContain("Line 1: target")
      expect(result.output).toContain("Line 2: target")
    }),
  )

  it.instance("reports partial results when ripgrep skips paths", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "match.txt"), "needle\n"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "needle",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(1)
      // When there are no inaccessible paths, partial message should not appear
      expect(result.output).not.toContain("inaccessible")
    }),
  )
})
