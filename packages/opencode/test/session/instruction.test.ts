import { describe, expect } from "bun:test"
import path from "path"
import { Effect, FileSystem, Layer, Ref } from "effect"
import { FetchHttpClient, HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Instruction } from "../../src/session/instruction"
import { InstanceRef } from "../../src/effect/instance-ref"
import { ProjectID } from "../../src/project/schema"
import { Config } from "@/config/config"
import type { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Global } from "@opencode-ai/core/global"
import { provideInstance, provideTmpdirInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer))

const configLayer = TestConfig.layer()

const instructionLayer = (global: Partial<Global.Interface>) =>
  Instruction.layer.pipe(
    Layer.provide(configLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Global.layerWith(global)),
  )

const provideInstruction =
  (global: Partial<Global.Interface>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(Effect.provide(instructionLayer(global)))

// Variant of instructionLayer that swaps the real HttpClient for a fake that
// counts remote "fetch()" calls (system() fetches config.instructions URLs).
const makeFakeHttpLayer = (countRef: Ref.Ref<number>, body: string) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.gen(function* () {
      return HttpClient.make((request) =>
        Effect.gen(function* () {
          yield* Ref.update(countRef, (n) => n + 1)
          return HttpClientResponse.fromWeb(request, new Response(body, { status: 200 }))
        }),
      )
    }),
  )

const provideInstructionWithHttp =
  (global: Partial<Global.Interface>, httpLayer: Layer.Layer<HttpClient.HttpClient>, config: Partial<Config.Interface>) =>
  <A, E, R>(self: Effect.Effect<A, E, R>) =>
    self.pipe(
      Effect.provide(
        Instruction.layer.pipe(
          Layer.provide(TestConfig.layer(config)),
          Layer.provide(AppFileSystem.defaultLayer),
          Layer.provide(httpLayer),
          Layer.provide(Global.layerWith(global)),
        ),
      ),
    )

const write = (filepath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(path.dirname(filepath), { recursive: true })
    yield* fs.writeFileString(filepath, content)
  })

// A scoped temp dir for tests that explicitly provide a non-git InstanceContext.
const isolatedTmpdir = <A, E, R>(self: (dir: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    return yield* self(yield* tmpdirScoped())
  })

const provideNonGitInstance = (directory: string) =>
  Effect.provideService(InstanceRef, {
    directory,
    worktree: "/",
    project: {
      id: ProjectID.global,
      worktree: "/",
      time: { created: 0, updated: 0 },
      sandboxes: [],
    },
  })

const writeFiles = (dir: string, files: Record<string, string>) =>
  Effect.all(
    Object.entries(files).map(([file, content]) => write(path.join(dir, file), content)),
    { discard: true },
  )

const withFiles = <A, E, R>(files: Record<string, string>, self: (dir: string) => Effect.Effect<A, E, R>) =>
  provideTmpdirInstance((dir) =>
    Effect.gen(function* () {
      yield* writeFiles(dir, files)
      return yield* self(dir).pipe(provideInstruction({ home: dir, config: dir }))
    }),
  )

const tmpWithFiles = (files: Record<string, string>) =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    yield* writeFiles(dir, files)
    return dir
  })

function loaded(filepath: string): MessageV2.WithParts[] {
  const sessionID = SessionID.make("session-loaded-1")
  const messageID = MessageID.make("msg_message-loaded-1")

  return [
    {
      info: {
        id: messageID,
        sessionID,
        role: "user",
        time: { created: 0 },
        agent: "build",
        model: {
          providerID: ProviderID.make("anthropic"),
          modelID: ModelID.make("claude-sonnet-4-20250514"),
        },
      },
      parts: [
        {
          id: PartID.make("prt_part-loaded-1"),
          messageID,
          sessionID,
          type: "tool",
          callID: "call-loaded-1",
          tool: "read",
          state: {
            status: "completed",
            input: {},
            output: "done",
            title: "Read",
            metadata: { loaded: [filepath] },
            time: { start: 0, end: 1 },
          },
        },
      ],
    },
  ]
}

describe("Instruction.resolve", () => {
  it.live("returns empty when AGENTS.md is at project root (already in systemPaths)", () =>
    withFiles({ "AGENTS.md": "# Root Instructions", "src/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "AGENTS.md"))).toBe(true)

        const results = yield* svc.resolve([], path.join(dir, "src", "file.ts"), MessageID.make("msg_message-test-1"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("returns AGENTS.md from subdirectory (not in systemPaths)", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const system = yield* svc.systemPaths()
        expect(system.has(path.join(dir, "subdir", "AGENTS.md"))).toBe(false)

        const results = yield* svc.resolve(
          [],
          path.join(dir, "subdir", "nested", "file.ts"),
          MessageID.make("msg_message-test-2"),
        )
        expect(results.length).toBe(1)
        expect(results[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
      }),
    ),
  )

  it.live("doesn't reload AGENTS.md when reading it directly", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "AGENTS.md")
        const system = yield* svc.systemPaths()
        expect(system.has(filepath)).toBe(false)

        const results = yield* svc.resolve([], filepath, MessageID.make("msg_message-test-3"))
        expect(results).toEqual([])
      }),
    ),
  )

  it.live("does not reattach the same nearby instructions twice for one message", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-1")

        const first = yield* svc.resolve([], filepath, id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(first[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
        expect(second).toEqual([])
      }),
    ),
  )

  it.live("clear allows nearby instructions to be attached again for the same message", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-2")

        const first = yield* svc.resolve([], filepath, id)
        yield* svc.clear(id)
        const second = yield* svc.resolve([], filepath, id)

        expect(first).toHaveLength(1)
        expect(second).toHaveLength(1)
        expect(second[0].filepath).toBe(path.join(dir, "subdir", "AGENTS.md"))
      }),
    ),
  )

  it.live("skips instructions already reported by prior read metadata", () =>
    withFiles({ "subdir/AGENTS.md": "# Subdir Instructions", "subdir/nested/file.ts": "const x = 1" }, (dir) =>
      Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const agents = path.join(dir, "subdir", "AGENTS.md")
        const filepath = path.join(dir, "subdir", "nested", "file.ts")
        const id = MessageID.make("msg_message-claim-3")

        const results = yield* svc.resolve(loaded(agents), filepath, id)
        expect(results).toEqual([])
      }),
    ),
  )
})

describe("Instruction.system", () => {
  it.live("caches remote instructions across system() calls", () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0)
      const url = "https://example.com/AGENTS.md"
      const body = "# Remote Instructions"
      const layer = makeFakeHttpLayer(count, body)

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const first = yield* svc.system()
        const second = yield* svc.system()
        expect(first).toEqual([`<instructions source="${url}">\n${body}\n</instructions>`])
        expect(second).toEqual(first)
        expect(yield* Ref.get(count)).toBe(1)
      }).pipe(
        provideInstance(yield* tmpdirScoped()),
        provideInstructionWithHttp({}, layer, {
          get: () => Effect.succeed({ instructions: [url] }),
        }),
      )
    }),
  )

  it.live("refetches a remote instruction after the cache TTL expires", () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0)
      const url = "https://example.com/AGENTS.md"
      const body = "# Remote Instructions"
      const layer = makeFakeHttpLayer(count, body)

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const first = yield* svc.system()
        expect(yield* Ref.get(count)).toBe(1)

        // Backdate the cache entry beyond REMOTE_TTL_MS so the next system()
        // call must go back to the network instead of serving the cached copy.
        const fakeNow = Date.now() + 61_000
        const original = Date.now
        Date.now = () => fakeNow
        const second = yield* svc.system().pipe(Effect.ensuring(Effect.sync(() => (Date.now = original))))
        expect(second).toEqual(first)
        expect(yield* Ref.get(count)).toBe(2)
      }).pipe(
        provideInstance(yield* tmpdirScoped()),
        provideInstructionWithHttp({}, layer, {
          get: () => Effect.succeed({ instructions: [url] }),
        }),
      )
    }),
  )

  it.live("rejects oversized remote instructions without caching them", () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0)
      const url = "https://example.com/AGENTS.md"
      // Remote fake returns a body over the 64 KiB ceiling: the content must be
      // dropped (empty rule, not cached) instead of inflating every LLM step.
      const layer = makeFakeHttpLayer(count, "# Too big\n" + "x".repeat(64 * 1024 + 1))

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const first = yield* svc.system()
        expect(first).toEqual([])
        const second = yield* svc.system()
        // Failed/oversized fetches are not cached: the next call retries.
        expect(yield* Ref.get(count)).toBe(2)
        expect(second).toEqual([])
      }).pipe(
        provideInstance(yield* tmpdirScoped()),
        provideInstructionWithHttp({}, layer, {
          get: () => Effect.succeed({ instructions: [url] }),
        }),
      )
    }),
  )

  it.live("enforces the remote instruction limit in UTF-8 bytes", () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0)
      const url = "https://example.com/AGENTS.md"
      // 64 KiB UTF-16 code units is 128 KiB on the wire for this character.
      const layer = makeFakeHttpLayer(count, "é".repeat(64 * 1024))

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        expect(yield* svc.system()).toEqual([])
        expect(yield* Ref.get(count)).toBe(1)
      }).pipe(
        provideInstance(yield* tmpdirScoped()),
        provideInstructionWithHttp({}, layer, {
          get: () => Effect.succeed({ instructions: [url] }),
        }),
      )
    }),
  )

  it.live("retries a failed remote instruction and caches a later success", () =>
    Effect.gen(function* () {
      const count = yield* Ref.make(0)
      const url = "https://example.com/AGENTS.md"
      const body = "# Remote Instructions"
      const layer = Layer.effect(
        HttpClient.HttpClient,
        Effect.sync(() =>
          HttpClient.make((request) =>
            Effect.gen(function* () {
              const current = yield* Ref.get(count)
              yield* Ref.update(count, (n) => n + 1)
              if (current === 0) {
                return yield* Effect.fail(
                  new HttpClientError.HttpClientError({
                    reason: new HttpClientError.TransportError({ request, description: "temporary failure" }),
                  }),
                )
              }
              return HttpClientResponse.fromWeb(request, new Response(body, { status: 200 }))
            }),
          ),
        ),
      )

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const first = yield* svc.system()
        const second = yield* svc.system()
        expect(first).toEqual([`<instructions source="${url}">\n${body}\n</instructions>`])
        expect(second).toEqual(first)
        // The HTTP retry recovers the first call; subsequent system() calls use the cache.
        expect(yield* Ref.get(count)).toBe(2)
        expect(yield* svc.system()).toEqual(second)
        expect(yield* Ref.get(count)).toBe(2)
      }).pipe(
        provideInstance(yield* tmpdirScoped()),
        provideInstructionWithHttp({}, layer, {
          get: () => Effect.succeed({ instructions: [url] }),
        }),
      )
    }),
  )

  it.live("loads both project and global AGENTS.md when both exist", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpWithFiles({ "AGENTS.md": "# Project Instructions" })

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(projectTmp, "AGENTS.md"))).toBe(true)
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)

        const rules = yield* svc.system()
        expect(rules).toHaveLength(2)
        expect(rules[0]).toBe(
          `<instructions source="${path.join(globalTmp, "AGENTS.md")}">\n# Global Instructions\n</instructions>`,
        )
        expect(rules[1]).toBe(
          `<instructions source="${path.join(projectTmp, "AGENTS.md")}">\n# Project Instructions\n</instructions>`,
        )
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )

  it.live("skips oversized local instruction files", () =>
    isolatedTmpdir((base) =>
      Effect.gen(function* () {
        const globalTmp = yield* tmpdirScoped()
        const project = path.join(base, "project")
        const oversized = "# Large Instructions\n" + "x".repeat(64 * 1024)
        yield* write(path.join(project, "AGENTS.md"), oversized)

        yield* Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const paths = yield* svc.systemPaths()
          const rules = yield* svc.system()
          expect(paths.has(path.join(project, "AGENTS.md"))).toBe(true)
          expect(rules).toEqual([])
        }).pipe(provideNonGitInstance(project), provideInstruction({ home: globalTmp, config: globalTmp }))
      }),
    ),
  )
})

describe("Instruction.systemPaths non-git leaks", () => {
  it.live("does not inherit AGENTS.md from parent dirs of a non-git project", () =>
    // Irrelevant parent files must not be picked up: in a genuine non-git project
    // (worktree "/"), systemPaths must clamp its findUp walk to the project dir.
    isolatedTmpdir((base) =>
      Effect.gen(function* () {
        const proj = path.join(base, "proj")
        const globalTmp = yield* tmpdirScoped()

        yield* write(path.join(base, "AGENTS.md"), "# LEAK FROM PARENT")
        yield* write(path.join(proj, "AGENTS.md"), "# Project Instructions")
        yield* write(path.join(proj, "file.ts"), "const x = 1")

        yield* Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const paths = yield* svc.systemPaths()

          // A file outside the project (parent of cwd, reachable only because
          // non-git worktree is "/") must NOT enter the project context.
          expect(paths.has(path.join(base, "AGENTS.md"))).toBe(false)
          expect(paths.has(path.join(proj, "AGENTS.md"))).toBe(true)
        }).pipe(provideNonGitInstance(proj), provideInstruction({ home: globalTmp, config: globalTmp }))
      }),
    ),
  )

  it.live("git project only walks up to the worktree root (does not escape repo)", () =>
    isolatedTmpdir((base) =>
      Effect.gen(function* () {
        const repo = path.join(base, "repo")
        const globalTmp = yield* tmpdirScoped()

        // init a real git repo at `repo` so fromDirectory sees worktree = repo
        yield* Effect.promise(() =>
          import("node:child_process").then(({ execFile }) =>
            new Promise<void>((res, rej) =>
              execFile("git", ["init", "-q", repo], (err) => (err ? rej(err) : res())),
            ),
          ),
        )
        yield* write(path.join(repo, "AGENTS.md"), "# Project Instructions")
        yield* write(path.join(base, "AGENTS.md"), "# LEAK OUTSIDE REPO")

        yield* Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const paths = yield* svc.systemPaths()
          expect(paths.has(path.join(repo, "AGENTS.md"))).toBe(true)
          expect(paths.has(path.join(base, "AGENTS.md"))).toBe(false)
        }).pipe(provideInstance(repo), provideInstruction({ home: globalTmp, config: globalTmp }))
      }),
    ),
  )
})

describe("Instruction.systemPaths global config", () => {
  it.live("uses Global.Service config AGENTS.md", () =>
    Effect.gen(function* () {
      const globalTmp = yield* tmpWithFiles({ "AGENTS.md": "# Global Instructions" })
      const projectTmp = yield* tmpdirScoped()

      yield* Effect.gen(function* () {
        const svc = yield* Instruction.Service
        const paths = yield* svc.systemPaths()
        expect(paths.has(path.join(globalTmp, "AGENTS.md"))).toBe(true)
      }).pipe(provideInstance(projectTmp), provideInstruction({ home: globalTmp, config: globalTmp }))
    }),
  )
})

describe("Instruction.systemPaths config-relative boundary", () => {
  it.live("does not let config-relative instructions climb above the project in non-git dirs", () =>
    isolatedTmpdir((base) =>
      Effect.gen(function* () {
        const project = path.join(base, "project")
        yield* write(path.join(base, "AGENTS.md"), "# LEAK FROM CONFIG-RELATIVE")
        yield* write(path.join(project, "file.ts"), "const x = 1")

        yield* Effect.gen(function* () {
          const svc = yield* Instruction.Service
          const paths = yield* svc.systemPaths()
          expect(paths.has(path.join(base, "AGENTS.md"))).toBe(false)
        }).pipe(
          provideNonGitInstance(project),
          // Config layer must be provided INTO Instruction.layer (as
          // provideInstructionWithHttp does) or the override never reaches it.
          provideInstructionWithHttp({}, FetchHttpClient.layer, {
            get: () => Effect.succeed({ instructions: ["../AGENTS.md"] }),
          }),
        )
      }),
    ),
  )
})
