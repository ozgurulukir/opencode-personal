// oxlint-disable typescript/no-unsafe-type-assertion
import { afterAll, describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Ty } from "../../src/lsp/server"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Launch from "../../src/lsp/launch"
import * as Which from "../../src/util/which"
import type { InstanceContext } from "../../src/project/instance-context"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-ty-test-"))
  dirs.push(dir)
  return dir
}

function mockInstanceContext(dir: string): InstanceContext {
  return {
    directory: dir,
    worktree: dir,
  } as unknown as InstanceContext
}

describe("Ty LSP Info", () => {
  test("has correct id and extensions", () => {
    expect(Ty.id).toBe("ty")
    expect(Ty.extensions).toEqual([".py", ".pyi"])
  })

  describe("root resolution", () => {
    test("finds project root with pyproject.toml", async () => {
      const root = makeTempDir()
      const sub = path.join(root, "sub")
      mkdirSync(sub, { recursive: true })
      writeFileSync(path.join(root, "pyproject.toml"), "")

      const ctx = mockInstanceContext(root)
      const result = await Ty.root(path.join(sub, "test.py"), ctx)
      expect(result).toBe(root)
    })

    test("finds project root with ty.toml", async () => {
      const root = makeTempDir()
      const sub = path.join(root, "sub")
      mkdirSync(sub, { recursive: true })
      writeFileSync(path.join(root, "ty.toml"), "")

      const ctx = mockInstanceContext(root)
      const result = await Ty.root(path.join(sub, "test.py"), ctx)
      expect(result).toBe(root)
    })

    test("falls back to instance directory when no marker found", async () => {
      const root = makeTempDir()
      const sub = path.join(root, "sub")
      mkdirSync(sub, { recursive: true })

      const ctx = mockInstanceContext(root)
      const result = await Ty.root(path.join(sub, "test.py"), ctx)
      expect(result).toBe(root)
    })
  })

  describe("spawn", () => {
    test("returns undefined if OPENCODE_EXPERIMENTAL_LSP_TY is disabled", async () => {
      const prev = Flag.OPENCODE_EXPERIMENTAL_LSP_TY
      ;(Flag as any).OPENCODE_EXPERIMENTAL_LSP_TY = false

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Ty.spawn(root, ctx)
        expect(handle).toBeUndefined()
      } finally {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_LSP_TY = prev
      }
    })

    test("returns undefined if ty binary is not found anywhere", async () => {
      const prev = Flag.OPENCODE_EXPERIMENTAL_LSP_TY
      ;(Flag as any).OPENCODE_EXPERIMENTAL_LSP_TY = true
      const whichSpy = spyOn(Which, "which").mockReturnValue(null)

      try {
        const root = makeTempDir()
        const ctx = mockInstanceContext(root)
        const handle = await Ty.spawn(root, ctx)
        expect(handle).toBeUndefined()
      } finally {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_LSP_TY = prev
        whichSpy.mockRestore()
      }
    })

    test("spawns ty from PATH when available and passes initialization with pythonPath if venv present", async () => {
      const prev = Flag.OPENCODE_EXPERIMENTAL_LSP_TY
      ;(Flag as any).OPENCODE_EXPERIMENTAL_LSP_TY = true
      const whichSpy = spyOn(Which, "which").mockReturnValue("/usr/local/bin/ty")
      const mockProc = { id: "mock-process", exited: Promise.resolve(0) } as unknown as ReturnType<typeof Launch.spawn>
      const spawnSpy = spyOn(Launch, "spawn").mockReturnValue(mockProc)

      try {
        const root = makeTempDir()
        mkdirSync(path.join(root, ".venv", "bin"), { recursive: true })
        const pythonBin = path.join(root, ".venv", "bin", "python")
        writeFileSync(pythonBin, "")

        const ctx = mockInstanceContext(root)
        const handle = await Ty.spawn(root, ctx)

        expect(spawnSpy).toHaveBeenCalledWith("/usr/local/bin/ty", ["server"], { cwd: root })
        expect(handle).toBeDefined()
        expect(handle?.process).toBe(mockProc)
        expect(handle?.initialization).toEqual({ pythonPath: pythonBin })
      } finally {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_LSP_TY = prev
        whichSpy.mockRestore()
        spawnSpy.mockRestore()
      }
    })

    test("spawns ty from project venv when not in PATH", async () => {
      const prev = Flag.OPENCODE_EXPERIMENTAL_LSP_TY
      ;(Flag as any).OPENCODE_EXPERIMENTAL_LSP_TY = true
      const whichSpy = spyOn(Which, "which").mockReturnValue(null)
      const mockProc = { id: "mock-process", exited: Promise.resolve(0) } as unknown as ReturnType<typeof Launch.spawn>
      const spawnSpy = spyOn(Launch, "spawn").mockReturnValue(mockProc)

      try {
        const root = makeTempDir()
        const isWindows = process.platform === "win32"
        const tyBinDir = isWindows ? path.join(root, ".venv", "Scripts") : path.join(root, ".venv", "bin")
        const tyBinName = isWindows ? "ty.exe" : "ty"
        mkdirSync(tyBinDir, { recursive: true })
        const tyPath = path.join(tyBinDir, tyBinName)
        writeFileSync(tyPath, "")

        const ctx = mockInstanceContext(root)
        const handle = await Ty.spawn(root, ctx)

        expect(spawnSpy).toHaveBeenCalledWith(tyPath, ["server"], { cwd: root })
        expect(handle).toBeDefined()
        expect(handle?.process).toBe(mockProc)
      } finally {
        ;(Flag as any).OPENCODE_EXPERIMENTAL_LSP_TY = prev
        whichSpy.mockRestore()
        spawnSpy.mockRestore()
      }
    })
  })
})
