import { afterEach, describe, expect, mock, spyOn } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { LSP, brokenConfig } from "@/lsp/lsp"
import * as LSPServer from "@/lsp/server"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(LSP.defaultLayer, CrossSpawnSpawner.defaultLayer))

let originalTtl = brokenConfig.ttl
let originalMaxBackoff = brokenConfig.maxBackoff

afterEach(() => {
  brokenConfig.ttl = originalTtl
  brokenConfig.maxBackoff = originalMaxBackoff
})

describe("lsp.spawn", () => {
  it.live("does not spawn builtin LSP for files outside instance", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.touchFile(path.join(dir, "..", "outside.ts"))
              yield* lsp.hover({
                file: path.join(dir, "..", "hover.ts"),
                line: 0,
                character: 0,
              })
              expect(spy).toHaveBeenCalledTimes(0)
            } finally {
              spy.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("does not spawn builtin LSP for files inside instance when LSP is unset", () =>
    provideTmpdirInstance((dir) =>
      LSP.Service.use((lsp) =>
        Effect.gen(function* () {
          const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

          try {
            yield* lsp.hover({
              file: path.join(dir, "src", "inside.ts"),
              line: 0,
              character: 0,
            })
            expect(spy).toHaveBeenCalledTimes(0)
          } finally {
            spy.mockRestore()
          }
        }),
      ),
    ),
  )

  it.live("would spawn builtin LSP for files inside instance when lsp is true", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.ts"),
                line: 0,
                character: 0,
              })
              expect(spy).toHaveBeenCalledTimes(1)
            } finally {
              spy.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("would spawn builtin LSP for files inside instance when config object is provided", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.ts"),
                line: 0,
                character: 0,
              })
              expect(spy).toHaveBeenCalledTimes(1)
            } finally {
              spy.mockRestore()
            }
          }),
        ),
      {
        config: {
          lsp: {
            eslint: { disabled: true },
          },
        },
      },
    ),
  )
})

describe("lsp.backoff", () => {
  it.live("retries after backoff expires following spawn failures", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            brokenConfig.ttl = 500
            brokenConfig.maxBackoff = 50

            const spy = spyOn(LSPServer.Typescript, "spawn")
              .mockRejectedValueOnce(new Error("fail 1"))
              .mockRejectedValueOnce(new Error("fail 2"))
              .mockResolvedValueOnce(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.ts"),
                line: 0,
                character: 0,
              })
              yield* Effect.sleep(100)
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.ts"),
                line: 0,
                character: 0,
              })
              yield* Effect.sleep(100)
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.ts"),
                line: 0,
                character: 0,
              })
              expect(spy).toHaveBeenCalledTimes(3)
            } finally {
              spy.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("retries after TTL expires", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            brokenConfig.ttl = 500
            brokenConfig.maxBackoff = 50

            const spy = spyOn(LSPServer.Typescript, "spawn")
              .mockRejectedValueOnce(new Error("fail 1"))
              .mockResolvedValueOnce(undefined)

            try {
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.ts"),
                line: 0,
                character: 0,
              })
              yield* Effect.sleep(600)
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.ts"),
                line: 0,
                character: 0,
              })
              expect(spy).toHaveBeenCalledTimes(2)
            } finally {
              spy.mockRestore()
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("hasClients returns false while server is in backoff", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            brokenConfig.ttl = 500
            brokenConfig.maxBackoff = 50

            const spy = spyOn(LSPServer.Typescript, "spawn")
              .mockRejectedValueOnce(new Error("fail 1"))
              .mockResolvedValueOnce(undefined)

            const originalRoots = new Map<string, (file: string, ctx: any) => Promise<string | undefined>>()
            for (const server of Object.values(LSPServer)) {
              if (typeof server === "object" && server !== null && "root" in server && typeof (server as any).root === "function") {
                const id = (server as any).id
                if (id === "typescript") continue
                originalRoots.set(id, (server as any).root)
                ;(server as any).root = async () => undefined
              }
            }

            try {
              // Trigger spawn failure to put typescript in backoff.
              yield* lsp.hover({
                file: path.join(dir, "src", "inside.ts"),
                line: 0,
                character: 0,
              })
              // Immediately check hasClients while typescript is still in backoff.
              const hasClients1 = yield* lsp.hasClients(path.join(dir, "src", "inside.ts"))
              expect(hasClients1).toBe(false)
              // After backoff expires, hasClients should retry typescript.
              yield* Effect.sleep(100)
              const hasClients2 = yield* lsp.hasClients(path.join(dir, "src", "inside.ts"))
              expect(hasClients2).toBe(true)
            } finally {
              spy.mockRestore()
              for (const [server, root] of originalRoots.entries()) {
                const s = (Object.values(LSPServer) as any[]).find((s) => s.id === server)
                if (s) s.root = root
              }
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("hasClients returns false when root throws", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const originalRoots = new Map<string, (file: string, ctx: any) => Promise<string | undefined>>()
            for (const server of Object.values(LSPServer)) {
              if (typeof server === "object" && server !== null && "root" in server && typeof (server as any).root === "function") {
                originalRoots.set((server as any).id, (server as any).root)
                ;(server as any).root = async () => {
                  throw new Error("root fail")
                }
              }
            }

            try {
              const result = yield* lsp.hasClients(path.join(dir, "src", "inside.ts"))
              expect(result).toBe(false)
            } finally {
              for (const [server, root] of originalRoots.entries()) {
                const s = (Object.values(LSPServer) as any[]).find((s) => s.id === server)
                if (s) s.root = root
              }
            }
          }),
        ),
      { config: { lsp: true } },
    ),
  )

  it.live("touchFile does not fail when all clients fail to open", () =>
    provideTmpdirInstance(
      (dir) =>
        LSP.Service.use((lsp) =>
          Effect.gen(function* () {
            const missingFile = path.join(dir, "src", "missing.ts")
            yield* lsp.touchFile(missingFile)
          }),
        ),
      { config: { lsp: true } },
    ),
  )
})
