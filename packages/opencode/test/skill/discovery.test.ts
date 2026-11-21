import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import fs from "fs/promises"
import dns from "node:dns"
import { Global } from "@opencode-ai/core/global"
import { Discovery, MAX_SKILL_BYTES } from "../../src/skill/discovery"
import { testEffect } from "../lib/effect"

const it = testEffect(Discovery.defaultLayer)

const SKILL_MD = [
  "---",
  "name: test-skill",
  "description: A test skill served by the test server.",
  "---",
  "",
  "# Test Skill",
  "",
  "Skill body content.",
  "",
].join("\n")

/**
 * Starts a local HTTP server that serves a skill index and files.
 * Returns the server — caller must stop() it.
 */
function serveSkills(skills: Array<{ name: string; files: string[] }>, options?: { body?: string }) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/index.json") return Response.json({ skills })
      if (url.pathname.endsWith("/SKILL.md")) {
        return new Response(options?.body ?? SKILL_MD, { headers: { "content-type": "text/markdown" } })
      }
      return new Response("file content", { headers: { "content-type": "application/octet-stream" } })
    },
  })
}

const cacheRoot = path.join(Global.Path.cache, "skills")
const SKILL_BASE = "https://skills.example.com/"
const PUBLIC_IP = "93.184.216.34"

const cleanup = (p: string) => Effect.promise(() => fs.rm(p, { recursive: true, force: true }).catch(() => {}))

/**
 * The SSRF guard requires a public https target. Route a public-looking host to
 * the local test server by stubbing DNS and fetch for the duration of a test.
 */
function installNetworkMock(port: number) {
  const originalFetch = globalThis.fetch
  const originalLookup = dns.promises.lookup
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input)
    const url = new URL(raw)
    url.protocol = "http:"
    url.hostname = "127.0.0.1"
    url.port = String(port)
    return originalFetch(url, init)
  }) as typeof fetch
  dns.promises.lookup = (async () => [{ address: PUBLIC_IP, family: 4 }]) as unknown as typeof dns.promises.lookup
  return () => {
    globalThis.fetch = originalFetch
    dns.promises.lookup = originalLookup
  }
}

describe("skill.discovery.pull security", () => {
  it.live("blocks path traversal in skill name", () =>
    Effect.gen(function* () {
      const server = serveSkills([{ name: "../../escape-name", files: ["SKILL.md"] }])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      yield* Effect.addFinalizer(() => cleanup(path.resolve(cacheRoot, "../../escape-name")))
      const restore = installNetworkMock(server.port!)
      yield* Effect.addFinalizer(() => Effect.sync(restore))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(SKILL_BASE)

      expect(dirs).toEqual([])
    }),
  )

  it.live("blocks path traversal in file path", () =>
    Effect.gen(function* () {
      const server = serveSkills([{ name: "normal", files: ["SKILL.md", "../../escape-file.txt"] }])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      yield* Effect.addFinalizer(() => cleanup(path.resolve(cacheRoot, "escape-file.txt")))
      const restore = installNetworkMock(server.port!)
      yield* Effect.addFinalizer(() => Effect.sync(restore))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(SKILL_BASE)

      expect(dirs).toEqual([])
    }),
  )

  it.live("blocks deep traversal in skill name", () =>
    Effect.gen(function* () {
      const server = serveSkills([{ name: "../../../../../escape-deep", files: ["SKILL.md"] }])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      yield* Effect.addFinalizer(() => cleanup(path.resolve(cacheRoot, "../../../../../escape-deep")))
      const restore = installNetworkMock(server.port!)
      yield* Effect.addFinalizer(() => Effect.sync(restore))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(SKILL_BASE)

      expect(dirs).toEqual([])
    }),
  )

  it.live("fails closed on non-public targets without fetching", () =>
    Effect.gen(function* () {
      let hits = 0
      const server = Bun.serve({
        port: 0,
        fetch() {
          hits++
          return Response.json({ skills: [] })
        },
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(`https://127.0.0.1:${server.port}/`)

      expect(dirs).toEqual([])
      expect(hits).toBe(0)
    }),
  )

  it.live("caps downloaded skill file size", () =>
    Effect.gen(function* () {
      const server = serveSkills([{ name: "huge-capped", files: ["SKILL.md"] }], {
        body: "x".repeat(MAX_SKILL_BYTES + 1),
      })
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      yield* Effect.addFinalizer(() => cleanup(path.join(cacheRoot, "huge-capped")))
      const restore = installNetworkMock(server.port!)
      yield* Effect.addFinalizer(() => Effect.sync(restore))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(SKILL_BASE)

      expect(dirs).toEqual([])
    }),
  )
})

describe("skill.discovery.pull normal operation", () => {
  it.live("downloads valid skills without traversal", () =>
    Effect.gen(function* () {
      const server = serveSkills([{ name: "valid-skill", files: ["SKILL.md"] }])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      yield* Effect.addFinalizer(() => cleanup(path.join(cacheRoot, "valid-skill")))
      const restore = installNetworkMock(server.port!)
      yield* Effect.addFinalizer(() => Effect.sync(restore))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(SKILL_BASE)

      expect(dirs.length).toBe(1)
      expect(dirs[0]).toContain("valid-skill")
    }),
  )

  it.live("returns empty when index has no skills", () =>
    Effect.gen(function* () {
      const server = serveSkills([])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      const restore = installNetworkMock(server.port!)
      yield* Effect.addFinalizer(() => Effect.sync(restore))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(SKILL_BASE)

      expect(dirs).toEqual([])
    }),
  )

  it.live("skips skill missing SKILL.md", () =>
    Effect.gen(function* () {
      const server = serveSkills([{ name: "no-md", files: ["readme.txt"] }])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      yield* Effect.addFinalizer(() => cleanup(path.join(cacheRoot, "no-md")))
      const restore = installNetworkMock(server.port!)
      yield* Effect.addFinalizer(() => Effect.sync(restore))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(SKILL_BASE)

      expect(dirs).toEqual([])
    }),
  )
})
