import fs from "fs/promises"
import path from "path"
import { describe, expect, test } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, Option } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { tmpdir } from "./fixture/tmpdir"

const win = process.platform === "win32"

const writePackage = (dir: string, pkg: Record<string, unknown>) =>
  Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({
      version: "1.0.0",
      ...pkg,
    }),
  )

const npmLayer = (cache: string) =>
  Npm.layer.pipe(
    Layer.provide(EffectFlock.layer),
    Layer.provide(AppFileSystem.layer),
    Layer.provide(Global.layerWith({ cache, state: path.join(cache, "state") })),
    Layer.provide(NodeFileSystem.layer),
  )

describe("Npm.sanitize", () => {
  test("keeps normal scoped package specs unchanged", () => {
    expect(Npm.sanitize("@opencode/acme")).toBe("@opencode/acme")
    expect(Npm.sanitize("@opencode/acme@1.0.0")).toBe("@opencode/acme@1.0.0")
    expect(Npm.sanitize("prettier")).toBe("prettier")
  })

  test("handles git https specs", () => {
    const spec = "acme@git+https://github.com/opencode/acme.git"
    const expected = win ? "acme@git+https_//github.com/opencode/acme.git" : spec
    expect(Npm.sanitize(spec)).toBe(expected)
  })
})

describe("Npm.satisfiesRequestedVersion", () => {
  test("accepts installed versions that satisfy the requested spec", () => {
    expect(Npm.satisfiesRequestedVersion("foo@^2.0.0", "2.3.4")).toBe(true)
    expect(Npm.satisfiesRequestedVersion("foo@1.0.0", "1.0.0")).toBe(true)
    expect(Npm.satisfiesRequestedVersion("foo", "9.9.9")).toBe(true)
  })

  test("rejects installed versions that do not satisfy the requested spec", () => {
    expect(Npm.satisfiesRequestedVersion("foo@^2.0.0", "1.0.0")).toBe(false)
    expect(Npm.satisfiesRequestedVersion("foo@1.0.0", "1.0.1")).toBe(false)
  })

  test("keeps the fast path for non-version specs and rejects unreadable versions", () => {
    expect(Npm.satisfiesRequestedVersion("foo@latest", "1.0.0")).toBe(true)
    expect(Npm.satisfiesRequestedVersion("foo@file:../bar", "1.0.0")).toBe(true)
    expect(Npm.satisfiesRequestedVersion("foo@^2.0.0", undefined)).toBe(false)
  })
})

describe("Npm.add", () => {
  test("reifies when package cache directory exists without the package installed", async () => {
    await using tmp = await tmpdir()
    await fs.mkdir(path.join(tmp.path, "fixture-provider"))
    await writePackage(path.join(tmp.path, "fixture-provider"), {
      name: "fixture-provider",
      main: "index.js",
    })
    await Bun.write(path.join(tmp.path, "fixture-provider", "index.js"), "export const fixture = true\n")

    const spec = `fixture-provider@file:${path.join(tmp.path, "fixture-provider")}`
    await fs.mkdir(path.join(tmp.path, "cache", "packages", Npm.sanitize(spec)), { recursive: true })

    const entry = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)

    expect(Option.isSome(entry.entrypoint)).toBe(true)
  })

  test("reinstalls when the installed version does not satisfy the requested spec", async () => {
    await using tmp = await tmpdir()
    const name = "fixture-version-mismatch"
    const spec = `${name}@^2.0.0`
    const cache = path.join(tmp.path, "cache")
    const pkgDir = path.join(cache, "packages", Npm.sanitize(spec), "node_modules", name)
    await fs.mkdir(pkgDir, { recursive: true })
    await Bun.write(path.join(pkgDir, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "index.js" }))
    await Bun.write(path.join(pkgDir, "index.js"), "module.exports = {}\n")
    // Force reify to fail fast without network; the assertion is that it is attempted at all
    // (the old fast-path returned the stale v1 entrypoint instead).
    await Bun.write(path.join(cache, "packages", Npm.sanitize(spec), ".npmrc"), "offline=true\n")

    const error = await Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(spec)
    }).pipe(
      Effect.scoped,
      Effect.provide(npmLayer(cache)),
      Effect.flip,
      Effect.runPromise,
    )
    expect(error._tag).toBe("NpmInstallFailedError")
  })

  test("handles malformed packages by falling back to raw spec name and failing with InstallFailedError gracefully", async () => {
    await using tmp = await tmpdir()
    const malformedSpec = "@@invalid/pkg"

    const run = Effect.gen(function* () {
      const npm = yield* Npm.Service
      return yield* npm.add(malformedSpec)
    }).pipe(
      Effect.scoped,
      Effect.provide(npmLayer(path.join(tmp.path, "cache"))),
      Effect.flip,
    )

    const error = await Effect.runPromise(run)
    expect(error._tag).toBe("NpmInstallFailedError")
  })

  test("rejects path traversal and absolute specs without writing outside cache", async () => {
    await using tmp = await tmpdir()
    const outside = path.join(tmp.path, "outside")
    await fs.mkdir(outside, { recursive: true })

    for (const spec of ["../../outside", "../outside", "/tmp/evil", ""]) {
      const error = await Effect.gen(function* () {
        const npm = yield* Npm.Service
        return yield* npm.add(spec)
      }).pipe(
        Effect.scoped,
        Effect.provide(npmLayer(path.join(tmp.path, "cache"))),
        Effect.flip,
        Effect.runPromise,
      )
      expect(error._tag).toBe("NpmInstallFailedError")

      const bin = await Effect.gen(function* () {
        const npm = yield* Npm.Service
        return yield* npm.which(spec)
      }).pipe(Effect.scoped, Effect.provide(npmLayer(path.join(tmp.path, "cache"))), Effect.runPromise)
      expect(Option.isNone(bin)).toBe(true)
    }

    expect(await fs.readdir(outside)).toEqual([])
  })
})

describe("Npm.install", () => {
  test("respects omit from project .npmrc", async () => {
    await using tmp = await tmpdir()

    await writePackage(tmp.path, {
      name: "fixture",
      dependencies: {
        "prod-pkg": "file:./prod-pkg",
      },
      devDependencies: {
        "dev-pkg": "file:./dev-pkg",
      },
    })
    await Bun.write(path.join(tmp.path, ".npmrc"), "omit=dev\n")
    await fs.mkdir(path.join(tmp.path, "prod-pkg"))
    await fs.mkdir(path.join(tmp.path, "dev-pkg"))
    await writePackage(path.join(tmp.path, "prod-pkg"), { name: "prod-pkg" })
    await writePackage(path.join(tmp.path, "dev-pkg"), { name: "dev-pkg" })

    await Npm.install(tmp.path)

    await expect(fs.stat(path.join(tmp.path, "node_modules", "prod-pkg"))).resolves.toBeDefined()
    await expect(fs.stat(path.join(tmp.path, "node_modules", "dev-pkg"))).rejects.toThrow()
  })
})

describe("Npm.resolveEntryPoint", () => {
  test("gracefully returns Option.none() when import.meta.resolve throws", () => {
    const result = Npm.resolveEntryPoint("non-existent-module-abc-123", "/invalid/directory/path")
    expect(result.directory).toBe("/invalid/directory/path")
    expect(Option.isNone(result.entrypoint)).toBe(true)
  })
})
