// oxlint-disable typescript/no-unsafe-type-assertion
import { afterAll, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { LuaLS } from "../../src/lsp/server"
import { Flag } from "@opencode-ai/core/flag/flag"
import * as Which from "../../src/util/which"
import type { InstanceContext } from "../../src/project/instance-context"

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "opencode-luals-test-"))
  dirs.push(dir)
  return dir
}

function mockInstanceContext(dir: string): InstanceContext {
  return {
    directory: dir,
    worktree: dir,
  } as unknown as InstanceContext
}

function isGitHubApiReleaseURL(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.hostname === "api.github.com" &&
      url.pathname === "/repos/LuaLS/lua-language-server/releases/latest"
    )
  } catch {
    return false
  }
}

describe("LuaLS LSP Info", () => {
  test("reconstructs the download URL from the canonical host instead of trusting browser_download_url", async () => {
    const prevFlag = Flag.OPENCODE_DISABLE_LSP_DOWNLOAD
    Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = false

    const whichSpy = spyOn(Which, "which").mockReturnValue(null)
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform")
    const origArch = Object.getOwnPropertyDescriptor(process, "arch")
    Object.defineProperty(process, "platform", { value: "linux", configurable: true })
    Object.defineProperty(process, "arch", { value: "x64", configurable: true })

    const tag = "v3.10.0"
    const assetName = `lua-language-server-${tag}-linux-x64.tar.gz`
    const maliciousUrl = "https://evil.example.com/malware.tar.gz"
    const urls: string[] = []

    const origFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      urls.push(urlStr)
      if (isGitHubApiReleaseURL(urlStr)) {
        return {
          ok: true,
          json: async () => ({
            tag_name: tag,
            assets: [{ name: assetName, browser_download_url: maliciousUrl }],
          }),
        }
      }
      // Fail the binary download so the flow returns before touching the filesystem.
      return { ok: false, status: 500 }
    }) as unknown as typeof fetch

    try {
      const root = makeTempDir()
      const handle = await LuaLS.spawn(root, mockInstanceContext(root))
      expect(handle).toBeUndefined()

      const downloadUrl = urls.find((url) => !isGitHubApiReleaseURL(url))
      expect(downloadUrl).toBeDefined()
      expect(downloadUrl).toBe(
        `https://github.com/LuaLS/lua-language-server/releases/download/${tag}/${assetName}`,
      )
      expect(downloadUrl).not.toBe(maliciousUrl)
    } finally {
      Flag.OPENCODE_DISABLE_LSP_DOWNLOAD = prevFlag
      whichSpy.mockRestore()
      globalThis.fetch = origFetch
      if (origPlatform) Object.defineProperty(process, "platform", origPlatform)
      if (origArch) Object.defineProperty(process, "arch", origArch)
    }
  })
})
