import { describe, expect } from "bun:test"
import { Effect } from "effect"
import path from "path"
import fs from "fs/promises"
import { Global } from "@opencode-ai/core/global"
import { Discovery } from "../../src/skill/discovery"
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
function serveSkills(skills: Array<{ name: string; files: string[] }>) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === "/index.json") return Response.json({ skills })
      if (url.pathname.endsWith("/SKILL.md")) {
        return new Response(SKILL_MD, { headers: { "content-type": "text/markdown" } })
      }
      return new Response("file content", { headers: { "content-type": "application/octet-stream" } })
    },
  })
}

const cacheRoot = path.join(Global.Path.cache, "skills")

const cleanup = (p: string) =>
  Effect.promise(() => fs.rm(p, { recursive: true, force: true }).catch(() => {}))

describe("skill.discovery.pull security", () => {
  it.live("blocks path traversal in skill name", () =>
    Effect.gen(function* () {
      const server = serveSkills([{ name: "../../escape-name", files: ["SKILL.md"] }])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      yield* Effect.addFinalizer(() => cleanup(path.resolve(cacheRoot, "../../escape-name")))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(`http://localhost:${server.port}/`)

      expect(dirs).toEqual([])
    }),
  )

  it.live("blocks path traversal in file path", () =>
    Effect.gen(function* () {
      const server = serveSkills([{ name: "normal", files: ["SKILL.md", "../../escape-file.txt"] }])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      yield* Effect.addFinalizer(() => cleanup(path.resolve(cacheRoot, "escape-file.txt")))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(`http://localhost:${server.port}/`)

      expect(dirs).toEqual([])
    }),
  )

  it.live("blocks deep traversal in skill name", () =>
    Effect.gen(function* () {
      const server = serveSkills([{ name: "../../../../../escape-deep", files: ["SKILL.md"] }])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      yield* Effect.addFinalizer(() => cleanup(path.resolve(cacheRoot, "../../../../../escape-deep")))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(`http://localhost:${server.port}/`)

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

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(`http://localhost:${server.port}/`)

      expect(dirs.length).toBe(1)
      expect(dirs[0]).toContain("valid-skill")
    }),
  )

  it.live("returns empty when index has no skills", () =>
    Effect.gen(function* () {
      const server = serveSkills([])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(`http://localhost:${server.port}/`)

      expect(dirs).toEqual([])
    }),
  )

  it.live("skips skill missing SKILL.md", () =>
    Effect.gen(function* () {
      const server = serveSkills([{ name: "no-md", files: ["readme.txt"] }])
      yield* Effect.addFinalizer(() => Effect.sync(() => server.stop()))
      yield* Effect.addFinalizer(() => cleanup(path.join(cacheRoot, "no-md")))

      const discovery = yield* Discovery.Service
      const dirs = yield* discovery.pull(`http://localhost:${server.port}/`)

      expect(dirs).toEqual([])
    }),
  )
})
