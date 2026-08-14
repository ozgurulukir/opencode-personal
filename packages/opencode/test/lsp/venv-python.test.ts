import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolveVenvPython, venvCandidates } from "../../src/lsp/venv"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-venv-test-"))
  dirs.push(dir)
  return dir
}

describe("resolveVenvPython (characterization)", () => {
  test("finds .venv/bin/python inside the project root", async () => {
    const root = makeTempDir()
    mkdirSync(path.join(root, ".venv", "bin"), { recursive: true })
    const python = path.join(root, ".venv", "bin", "python")
    writeFileSync(python, "")
    expect(await resolveVenvPython(root)).toBe(python)
  })

  test("prefers VIRTUAL_ENV over root .venv and venv", async () => {
    const root = makeTempDir()
    for (const venv of [".venv", "venv"]) {
      mkdirSync(path.join(root, venv, "bin"), { recursive: true })
      writeFileSync(path.join(root, venv, "bin", "python"), "")
    }
    const external = makeTempDir()
    mkdirSync(path.join(external, "bin"), { recursive: true })
    const externalPython = path.join(external, "bin", "python")
    writeFileSync(externalPython, "")

    const prev = process.env["VIRTUAL_ENV"]
    process.env["VIRTUAL_ENV"] = external
    try {
      expect(await resolveVenvPython(root)).toBe(externalPython)
    } finally {
      if (prev === undefined) delete process.env["VIRTUAL_ENV"]
      else process.env["VIRTUAL_ENV"] = prev
    }
  })

  test("falls back to venv/ when .venv/ is absent", async () => {
    const root = makeTempDir()
    mkdirSync(path.join(root, "venv", "bin"), { recursive: true })
    const python = path.join(root, "venv", "bin", "python")
    writeFileSync(python, "")
    expect(await resolveVenvPython(root)).toBe(python)
  })

  test("returns undefined when no venv exists", async () => {
    const prev = process.env["VIRTUAL_ENV"]
    delete process.env["VIRTUAL_ENV"]
    try {
      expect(await resolveVenvPython(makeTempDir())).toBeUndefined()
    } finally {
      if (prev !== undefined) process.env["VIRTUAL_ENV"] = prev
    }
  })
})

describe("venvCandidates (characterization)", () => {
  test("orders VIRTUAL_ENV first, then .venv, then venv", () => {
    const prev = process.env["VIRTUAL_ENV"]
    process.env["VIRTUAL_ENV"] = "/tmp/some-env"
    try {
      expect(venvCandidates("/proj")).toEqual(["/tmp/some-env", path.join("/proj", ".venv"), path.join("/proj", "venv")])
    } finally {
      if (prev === undefined) delete process.env["VIRTUAL_ENV"]
      else process.env["VIRTUAL_ENV"] = prev
    }
  })
})
