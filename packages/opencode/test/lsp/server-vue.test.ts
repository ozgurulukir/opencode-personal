// oxlint-disable typescript/no-unsafe-type-assertion
import { afterAll, describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Vue } from "../../src/lsp/server"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Npm } from "@opencode-ai/core/npm"
import * as Launch from "../../src/lsp/launch"
import * as Which from "../../src/util/which"
import type { InstanceContext } from "../../src/project/instance-context"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-vue-test-"))
  dirs.push(dir)
  return dir
}

function mockInstanceContext(dir: string): InstanceContext {
  return {
    directory: dir,
    worktree: dir,
  } as unknown as InstanceContext
}

describe("Vue LSP Info", () => {
  test("has correct id and extensions", () => {
    expect(Vue.id).toBe("vue")
    expect(Vue.extensions).toEqual([".vue"])
  })

  describe("root resolution", () => {
    test("finds project root with package-lock.json", async () => {
      const root = makeTempDir()
      const sub = path.join(root, "sub")
      mkdirSync(sub, { recursive: true })
      writeFileSync(path.join(root, "package-lock.json"), "")

      const ctx = mockInstanceContext(root)
      const result = await Vue.root(path.join(sub, "App.vue"), ctx)
      expect(result).toBe(root)
    })

    test("finds project root with bun.lock", async () => {
      const root = makeTempDir()
      const sub = path.join(root, "sub")
      mkdirSync(sub, { recursive: true })
      writeFileSync(path.join(root, "bun.lock"), "")

      const ctx = mockInstanceContext(root)
      const result = await Vue.root(path.join(sub, "App.vue"), ctx)
      expect(result).toBe(root)
    })

    test("falls back to instance directory when no lockfile found", async () => {
      const root = makeTempDir()
      const sub = path.join(root, "sub")
      mkdirSync(sub, { recursive: true })

      const ctx = mockInstanceContext(root)
      const result = await Vue.root(path.join(sub, "App.vue"), ctx)
      expect(result).toBe(root)
    })
  })

  describe("spawn", () => {
    test("spawns vue-language-server from PATH when available", async () => {
      const whichSpy = spyOn(Which, "which").mockReturnValue("/usr/local/bin/vue-language-server")
      const mockProc = { id: "mock-process", exited: Promise.resolve(0) } as unknown as ReturnType<typeof Launch.spawn>
      const spawnSpy = spyOn(Launch, "spawn").mockReturnValue(mockProc)

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Vue.spawn(root, ctx)

        expect(spawnSpy).toHaveBeenCalledWith("/usr/local/bin/vue-language-server", ["--stdio"], {
          cwd: root,
          env: expect.any(Object),
        })
        expect(handle).toBeDefined()
        expect(handle?.process).toBe(mockProc)
        expect(handle?.initialization).toEqual({})
      } finally {
        whichSpy.mockRestore()
        spawnSpy.mockRestore()
      }
    })

    test("returns undefined if vue-language-server not in PATH and OPENCODE_DISABLE_LSP_DOWNLOAD is set", async () => {
      const prev = Flag.OPENCODE_DISABLE_LSP_DOWNLOAD
      Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = true
      const whichSpy = spyOn(Which, "which").mockReturnValue(null)

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Vue.spawn(root, ctx)
        expect(handle).toBeUndefined()
      } finally {
        Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = prev
        whichSpy.mockRestore()
      }
    })

    test("resolves @vue/language-server via Npm.which when not in PATH", async () => {
      const prev = Flag.OPENCODE_DISABLE_LSP_DOWNLOAD
      Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = false
      const whichSpy = spyOn(Which, "which").mockReturnValue(null)
      const npmWhichSpy = spyOn(Npm, "which").mockResolvedValue("/global/node_modules/.bin/vue-language-server")
      const mockProc = { id: "mock-process", exited: Promise.resolve(0) } as unknown as ReturnType<typeof Launch.spawn>
      const spawnSpy = spyOn(Launch, "spawn").mockReturnValue(mockProc)

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Vue.spawn(root, ctx)

        expect(npmWhichSpy).toHaveBeenCalledWith("@vue/language-server")
        expect(spawnSpy).toHaveBeenCalledWith("/global/node_modules/.bin/vue-language-server", ["--stdio"], {
          cwd: root,
          env: expect.any(Object),
        })
        expect(handle).toBeDefined()
        expect(handle?.process).toBe(mockProc)
      } finally {
        Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = prev
        whichSpy.mockRestore()
        npmWhichSpy.mockRestore()
        spawnSpy.mockRestore()
      }
    })

    test("returns undefined if @vue/language-server cannot be resolved via Npm.which", async () => {
      const prev = Flag.OPENCODE_DISABLE_LSP_DOWNLOAD
      Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = false
      const whichSpy = spyOn(Which, "which").mockReturnValue(null)
      const npmWhichSpy = spyOn(Npm, "which").mockResolvedValue(undefined)

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Vue.spawn(root, ctx)
        expect(handle).toBeUndefined()
      } finally {
        Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = prev
        whichSpy.mockRestore()
        npmWhichSpy.mockRestore()
      }
    })
  })
})
