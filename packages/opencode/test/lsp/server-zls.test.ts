// oxlint-disable typescript/no-unsafe-type-assertion
import { afterAll, describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Zls } from "../../src/lsp/server"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import * as Launch from "../../src/lsp/launch"
import * as Which from "../../src/util/which"
import { Filesystem } from "../../src/util/filesystem"
import { Process } from "../../src/util/process"
import { Archive } from "../../src/util/archive"
import type { InstanceContext } from "../../src/project/instance-context"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-zls-test-"))
  dirs.push(dir)
  return dir
}

function mockInstanceContext(dir: string): InstanceContext {
  return {
    directory: dir,
    worktree: dir,
  } as unknown as InstanceContext
}

describe("Zls LSP Info", () => {
  test("has correct id and extensions", () => {
    expect(Zls.id).toBe("zls")
    expect(Zls.extensions).toEqual([".zig", ".zon"])
  })

  describe("root resolution", () => {
    test("finds project root with build.zig", async () => {
      const root = makeTempDir()
      const sub = path.join(root, "src")
      mkdirSync(sub, { recursive: true })
      writeFileSync(path.join(root, "build.zig"), "")

      const ctx = mockInstanceContext(root)
      const result = await Zls.root(path.join(sub, "main.zig"), ctx)
      expect(result).toBe(root)
    })

    test("falls back to instance directory when build.zig is not found", async () => {
      const root = makeTempDir()
      const sub = path.join(root, "src")
      mkdirSync(sub, { recursive: true })

      const ctx = mockInstanceContext(root)
      const result = await Zls.root(path.join(sub, "main.zig"), ctx)
      expect(result).toBe(root)
    })
  })

  describe("spawn", () => {
    test("spawns zls from PATH when zls is found", async () => {
      const whichSpy = spyOn(Which, "which").mockImplementation((cmd: string) => {
        if (cmd === "zls") return "/usr/local/bin/zls"
        return null
      })

      const mockProc = { id: "mock-zls-proc", exited: Promise.resolve(0) } as unknown as ReturnType<typeof Launch.spawn>
      const spawnSpy = spyOn(Launch, "spawn").mockReturnValue(mockProc)

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Zls.spawn(root, ctx)

        expect(spawnSpy).toHaveBeenCalledWith("/usr/local/bin/zls", { cwd: root })
        expect(handle).toBeDefined()
        expect(handle?.process).toBe(mockProc)
      } finally {
        whichSpy.mockRestore()
        spawnSpy.mockRestore()
      }
    })

    test("returns undefined when zls is not in PATH and zig is not installed", async () => {
      const whichSpy = spyOn(Which, "which").mockReturnValue(null)

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Zls.spawn(root, ctx)
        expect(handle).toBeUndefined()
      } finally {
        whichSpy.mockRestore()
      }
    })

    test("returns undefined when zls is not in PATH, zig is present, but LSP download is disabled", async () => {
      const prevFlag = Flag.OPENCODE_DISABLE_LSP_DOWNLOAD
      Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = true

      const whichSpy = spyOn(Which, "which").mockImplementation((cmd: string) => {
        if (cmd === "zig") return "/usr/bin/zig"
        return null
      })

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Zls.spawn(root, ctx)
        expect(handle).toBeUndefined()
      } finally {
        Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = prevFlag
        whichSpy.mockRestore()
      }
    })

    test("returns undefined when release info fetch fails", async () => {
      const prevFlag = Flag.OPENCODE_DISABLE_LSP_DOWNLOAD
      Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = false

      const whichSpy = spyOn(Which, "which").mockImplementation((cmd: string) => {
        if (cmd === "zig") return "/usr/bin/zig"
        return null
      })

      const origFetch = globalThis.fetch
      globalThis.fetch = (async () => ({
        ok: false,
        status: 404,
      })) as unknown as typeof fetch

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Zls.spawn(root, ctx)
        expect(handle).toBeUndefined()
      } finally {
        Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = prevFlag
        whichSpy.mockRestore()
        globalThis.fetch = origFetch
      }
    })

    test("downloads and spawns zls successfully when not in PATH", async () => {
      const prevFlag = Flag.OPENCODE_DISABLE_LSP_DOWNLOAD
      Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = false

      const whichSpy = spyOn(Which, "which").mockImplementation((cmd: string) => {
        if (cmd === "zig") return "/usr/bin/zig"
        return null
      })

      const platform = process.platform
      const arch = process.arch
      let zlsArch: string = arch
      if (arch === "arm64") zlsArch = "aarch64"
      else if (arch === "x64") zlsArch = "x86_64"
      else if (arch === "ia32") zlsArch = "x86"

      let zlsPlatform: string = platform
      if (platform === "darwin") zlsPlatform = "macos"
      else if (platform === "win32") zlsPlatform = "windows"

      const ext = platform === "win32" ? "zip" : "tar.xz"
      const assetName = `zls-${zlsArch}-${zlsPlatform}.${ext}`

      const origFetch = globalThis.fetch
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        if (urlStr.includes("api.github.com/repos/zigtools/zls/releases/latest")) {
          return {
            ok: true,
            json: async () => ({
              assets: [
                {
                  name: assetName,
                  browser_download_url: `https://github.com/zigtools/zls/releases/download/v0.13.0/${assetName}`,
                },
              ],
            }),
          }
        }
        if (urlStr.includes("github.com/zigtools/zls/releases/download")) {
          return {
            ok: true,
            body: {} as ReadableStream,
          }
        }
        return { ok: false }
      }) as unknown as typeof fetch

      const writeStreamSpy = spyOn(Filesystem, "writeStream").mockResolvedValue(undefined)
      const extractZipSpy = spyOn(Archive, "extractZip").mockResolvedValue(undefined)
      const runSpy = spyOn(Process, "run").mockResolvedValue({
        code: 0,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
      })
      const existsSpy = spyOn(Filesystem, "exists").mockImplementation(async (p: string) => {
        const expectedBin = path.join(Global.Path.bin, "zls" + (platform === "win32" ? ".exe" : ""))
        if (p === expectedBin) return true
        return false
      })

      const mockProc = { id: "mock-zls-proc", exited: Promise.resolve(0) } as unknown as ReturnType<typeof Launch.spawn>
      const spawnSpy = spyOn(Launch, "spawn").mockReturnValue(mockProc)

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Zls.spawn(root, ctx)

        const expectedBin = path.join(Global.Path.bin, "zls" + (platform === "win32" ? ".exe" : ""))
        expect(spawnSpy).toHaveBeenCalledWith(expectedBin, { cwd: root })
        expect(handle).toBeDefined()
        expect(handle?.process).toBe(mockProc)
      } finally {
        Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = prevFlag
        whichSpy.mockRestore()
        globalThis.fetch = origFetch
        writeStreamSpy.mockRestore()
        extractZipSpy.mockRestore()
        runSpy.mockRestore()
        existsSpy.mockRestore()
        spawnSpy.mockRestore()
      }
    })
  })
})
