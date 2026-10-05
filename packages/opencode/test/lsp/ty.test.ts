import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test"
import path from "node:path"
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { Ty } from "../../src/lsp/server"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Which from "../../src/util/which"
import * as Launch from "../../src/lsp/launch"
import { ProjectID } from "../../src/project/schema"
import type { InstanceContext } from "../../src/project/instance"

describe("Ty LSP Server", () => {
  let tmpDir: string
  let originalFlag: boolean
  const dummyCtx: InstanceContext = {
    directory: "/dummy",
    worktree: "/dummy",
    project: {
      id: ProjectID.global,
      worktree: "/dummy",
      sandboxes: [],
      time: { created: Date.now(), updated: Date.now() },
    },
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "opencode-ty-test-"))
    originalFlag = Flag.OPENCODE_EXPERIMENTAL_LSP_TY
  })

  afterEach(() => {
    Flag.OPENCODE_EXPERIMENTAL_LSP_TY = originalFlag
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("returns undefined if OPENCODE_EXPERIMENTAL_LSP_TY flag is false", async () => {
    Flag.OPENCODE_EXPERIMENTAL_LSP_TY = false
    const result = await Ty.spawn(tmpDir, dummyCtx)
    expect(result).toBeUndefined()
  })

  test("returns undefined if ty binary is not found anywhere", async () => {
    Flag.OPENCODE_EXPERIMENTAL_LSP_TY = true
    const whichSpy = spyOn(Which, "which").mockReturnValue(null)

    try {
      const result = await Ty.spawn(tmpDir, dummyCtx)
      expect(result).toBeUndefined()
    } finally {
      whichSpy.mockRestore()
    }
  })

  test("spawns ty when globally available via which()", async () => {
    Flag.OPENCODE_EXPERIMENTAL_LSP_TY = true
    const whichSpy = spyOn(Which, "which").mockReturnValue("/usr/bin/ty")
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const mockProc = { pid: 1234 } as unknown as ReturnType<typeof Launch.spawn>
    const spawnSpy = spyOn(Launch, "spawn").mockReturnValue(mockProc)

    try {
      const result = await Ty.spawn(tmpDir, dummyCtx)
      expect(result).toBeDefined()
      expect(result?.initialization).toEqual({})
      expect(spawnSpy).toHaveBeenCalledWith("/usr/bin/ty", ["server"], { cwd: tmpDir })
    } finally {
      whichSpy.mockRestore()
      spawnSpy.mockRestore()
    }
  })

  test("spawns ty from venv bin directory when which('ty') fails", async () => {
    Flag.OPENCODE_EXPERIMENTAL_LSP_TY = true
    const whichSpy = spyOn(Which, "which").mockReturnValue(null)
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const mockProc = { pid: 1234 } as unknown as ReturnType<typeof Launch.spawn>
    const spawnSpy = spyOn(Launch, "spawn").mockReturnValue(mockProc)

    // Create .venv/bin/ty in tmpDir (or Scripts/ty.exe on Windows)
    const isWindows = process.platform === "win32"
    const venvBinDir = isWindows ? path.join(tmpDir, ".venv", "Scripts") : path.join(tmpDir, ".venv", "bin")
    mkdirSync(venvBinDir, { recursive: true })
    const venvTyPath = isWindows ? path.join(venvBinDir, "ty.exe") : path.join(venvBinDir, "ty")
    writeFileSync(venvTyPath, "")

    try {
      const result = await Ty.spawn(tmpDir, dummyCtx)
      expect(result).toBeDefined()
      expect(spawnSpy).toHaveBeenCalledWith(venvTyPath, ["server"], { cwd: tmpDir })
    } finally {
      whichSpy.mockRestore()
      spawnSpy.mockRestore()
    }
  })

  test("passes pythonPath in initialization when virtualenv python is present", async () => {
    Flag.OPENCODE_EXPERIMENTAL_LSP_TY = true
    const whichSpy = spyOn(Which, "which").mockReturnValue("/usr/bin/ty")
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const mockProc = { pid: 1234 } as unknown as ReturnType<typeof Launch.spawn>
    const spawnSpy = spyOn(Launch, "spawn").mockReturnValue(mockProc)

    // Create .venv/bin/python in tmpDir
    const venvBinDir = path.join(tmpDir, ".venv", "bin")
    mkdirSync(venvBinDir, { recursive: true })
    const pythonPath = path.join(venvBinDir, "python")
    writeFileSync(pythonPath, "")

    try {
      const result = await Ty.spawn(tmpDir, dummyCtx)
      expect(result).toBeDefined()
      expect(result?.initialization).toEqual({ pythonPath })
    } finally {
      whichSpy.mockRestore()
      spawnSpy.mockRestore()
    }
  })
})
