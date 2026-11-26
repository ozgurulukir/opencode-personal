#!/usr/bin/env bun
// Fails when root package.json `patchedDependencies` and patches/*.patch drift
// apart. bun install catches a MISSING patch file but not a stray one, and a
// one-sided edit can split the module graph (patched copy vs unpatched cache)
// in ways that only surface on a clean box — see root AGENTS.md.
import fs from "node:fs"
import path from "path"
import { parse as parseJsonc } from "jsonc-parser"

const root = path.resolve(import.meta.dir, "..")
const pkg = await Bun.file(path.join(root, "package.json")).json()
const declared: string[] = Object.keys(pkg.patchedDependencies ?? {})
// bun.lock is JSONC (trailing commas), so it cannot be read with .json().
const lock = parseJsonc(await Bun.file(path.join(root, "bun.lock")).text())
const active: string[] = Object.keys(lock.patchedDependencies ?? {})
const inactive = declared.filter((key) => !active.includes(key))
const missingFromRoot = active.filter((key) => !declared.includes(key))

if (inactive.length > 0 || missingFromRoot.length > 0) {
  console.error("root package.json patchedDependencies and bun.lock are out of sync:")
  for (const key of inactive) console.error(`  declared but not active in bun.lock: ${key}`)
  for (const key of missingFromRoot) console.error(`  active in bun.lock but not declared: ${key}`)
  process.exit(1)
}
// bun escapes "/" in patched dependency keys as %2F in the patches/ filename.
const expected = declared.map((key) => `${key.replaceAll("/", "%2F")}.patch`).sort()
const files = fs
  .readdirSync(path.join(root, "patches"))
  .filter((file) => file.endsWith(".patch"))
  .sort()

const missing = expected.filter((file) => !files.includes(file))
const stray = files.filter((file) => !expected.includes(file))

if (missing.length > 0 || stray.length > 0) {
  console.error("patches/ does not match package.json patchedDependencies:")
  for (const file of missing) console.error(`  missing patch file: patches/${file}`)
  for (const file of stray) console.error(`  unreferenced patch file: patches/${file}`)
  process.exit(1)
}
console.log(`patches/ matches patchedDependencies (${declared.length} patches)`)
