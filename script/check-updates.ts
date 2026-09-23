#!/usr/bin/env bun
/**
 * Checks all dependencies across the monorepo for available same-channel upgrades.
 *
 * Usage:
 *   bun run script/check-updates.ts                       # report upgrades
 *   bun run script/check-updates.ts --check               # report + non-zero exit on updates/failures
 *   bun run script/check-updates.ts --apply               # apply bumps to package.json files
 *   bun run script/check-updates.ts --apply --install     # apply + bun install
 *   bun run script/check-updates.ts --apply --typecheck   # apply + typecheck packages/opencode
 *   bun run script/check-updates.ts --all                 # recursive walk instead of workspace globs
 *
 * Coverage: the root manifest plus every workspace package derived from `workspaces.packages`
 * globs, including the root `workspaces.catalog` catalog. Non-workspace manifests (`github/`,
 * `.opencode/`, `packages/diff-wasm/pkg/`) are excluded by default; `--all` falls back to a
 * skip-list recursive walk (heuristic — new noise dirs can leak in).
 *
 * Version policy: only pinned literals (no `^`/`~`/`workspace:`/`catalog:`/`npm:`/`github:`/
 * `file:`/`https:` references) are checked. A stable pin is bumped to the maximum stable
 * same-major candidate. A prerelease pin is bumped only within its own channel — same
 * major.minor.patch base AND same first prerelease segment (e.g. `4.0.0-beta.65` → newest
 * `4.0.0-beta.*`) — never silently crossing to stable or to a new base. A row is emitted exactly
 * when `sameChannelVersion` returns non-null (a strictly newer in-channel candidate exists); there
 * is no secondary minor/patch predicate.
 *
 * Write boundary: `--apply` rewrites only the dep sections (`dependencies`, `devDependencies`,
 * `optionalDependencies`, `peerDependencies`) and the catalog, using a version-anchored,
 * section-scoped rewrite — a literal in `overrides`/`patchedDependencies` that equals a scanned
 * pin is never touched. `overrides`/`patchedDependencies` are report-only: mismatches are warned
 * about and skipped.
 *
 * Flag interactions: `--check` and `--apply` are mutually exclusive; `--typecheck` requires
 * `--apply`. Both misuse cases print an error to stderr and exit 2.
 */

import { readFileSync, readdirSync, writeFileSync } from "fs"
import { join, relative } from "path"
import { execSync } from "child_process"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DepSection = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies" | "catalog"

export type PinnedEntry = { file: string; name: string; version: string; section: DepSection }

export type Divergence = { name: string; versions: { file: string; section: DepSection; version: string }[] }

export type OverrideMismatch = { name: string; overrideVersion: string; catalogVersion: string }

export type PatchMismatch = {
  name: string
  patchVersion: string
  foundVersion: string
  patchKey: string
  patchPath: string
}

export type ApplyUpdate = { file: string; name: string; from: string; to: string; section: DepSection }

export type ParsedSemver = { major: number; minor: number; patch: number; prerelease: string | null }

const DEP_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const

/** Resolve the repository root, overridable for fixture runs via `CHECK_UPDATES_ROOT`. */
export function resolveRoot(): string {
  return process.env.CHECK_UPDATES_ROOT ?? join(import.meta.dir, "..")
}

const ROOT = resolveRoot()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively find all package.json files, excluding common noise dirs. */
function findPackageJsonFiles(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (
      entry.name === "node_modules" ||
      entry.name === ".git" ||
      entry.name === "dist" ||
      entry.name === "dist.old" ||
      entry.name === ".turbo" ||
      entry.name === ".output" ||
      entry.name === "out" ||
      entry.name === ".sst" ||
      entry.name === "pkg" ||
      entry.name.startsWith("dist.")
    )
      continue
    if (entry.isDirectory()) results.push(...findPackageJsonFiles(full))
    else if (entry.name === "package.json") results.push(full)
  }
  return results
}

/** Resolve the root manifest plus every workspace package from `workspaces.packages` globs. */
function workspaceManifestFiles(root: string): string[] {
  const rootJson: { workspaces?: { packages?: string[] } } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"))
  const files = new Set<string>([join(root, "package.json")])
  for (const pattern of rootJson.workspaces?.packages ?? []) {
    for (const match of new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root, onlyFiles: true })) {
      files.add(join(root, match))
    }
  }
  return [...files]
}

/** Check if a version string is pinned (no semver range prefix). Hyphenated prereleases match. */
export function isPinned(version: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
}

/** Check if a version is a catalog: / workspace:* / npm: / github: / file: / https: reference. */
function isReference(version: string): boolean {
  return (
    version === "catalog:" ||
    version.startsWith("workspace:") ||
    version.startsWith("npm:") ||
    version.startsWith("github:") ||
    version.startsWith("file:") ||
    version.startsWith("https://")
  )
}

/** Parse semver parts, including hyphenated prerelease identifiers. */
export function parseSemver(v: string): ParsedSemver | null {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null }
}

/** Compare two prerelease strings per semver precedence: numeric < alphanumeric, lexical within a kind. */
function comparePrerelease(a: string, b: string): number {
  const left = a.split(".")
  const right = b.split(".")
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = left[i]
    const y = right[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      const diff = Number(x) - Number(y)
      if (diff !== 0) return diff
      continue
    }
    if (xNumeric) return -1
    if (yNumeric) return 1
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

function compareParsed(a: ParsedSemver, b: ParsedSemver): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.prerelease === null && b.prerelease === null) return 0
  if (a.prerelease === null) return 1
  if (b.prerelease === null) return -1
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * Select the newest candidate in the current pin's channel, or null when none is strictly newer.
 *
 * Stable pins consider same-major stable candidates (maximum wins). Prerelease pins consider only
 * the same major.minor.patch base and the same first prerelease segment — never crossing to stable
 * or to a new base. A non-null return is the sole emission signal for the caller.
 */
export function sameChannelVersion(current: ParsedSemver, candidates: string[]): string | null {
  const channel = current.prerelease?.split(".")[0] ?? null
  const inChannel = candidates.flatMap((raw) => {
    const parsed = parseSemver(raw)
    if (!parsed || parsed.major !== current.major) return []
    if (channel === null) return parsed.prerelease === null ? [{ raw, parsed }] : []
    if (parsed.minor !== current.minor || parsed.patch !== current.patch) return []
    if (parsed.prerelease === null || parsed.prerelease.split(".")[0] !== channel) return []
    return [{ raw, parsed }]
  })
  const newer = inChannel.filter((c) => compareParsed(c.parsed, current) > 0)
  if (newer.length === 0) return null
  return newer.reduce((best, candidate) => (compareParsed(candidate.parsed, best.parsed) > 0 ? candidate : best)).raw
}

/** Check whether an unknown JSON value is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Narrow an unknown JSON value to a string-valued map, dropping non-string entries. */
function asStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) if (typeof entry === "string") out[key] = entry
  return out
}

/**
 * Collect every pinned dependency literal as its own entry, plus divergence and mismatch signals.
 *
 * No global dedup: the same dep pinned at two versions yields two independent entries and is
 * reported as a divergence warning (never collapsed). `overrides`/`patchedDependencies` are
 * inspected for mismatches only — they are never apply targets.
 */
export function collectPinnedDeps(manifests: { file: string; json: Record<string, unknown> }[]): {
  entries: PinnedEntry[]
  divergent: Divergence[]
  overrideMismatches: OverrideMismatch[]
  patchMismatches: PatchMismatch[]
} {
  const entries: PinnedEntry[] = []
  for (const manifest of manifests) {
    for (const section of DEP_SECTIONS) {
      const deps = asStringMap(manifest.json[section])
      if (!deps) continue
      for (const [name, version] of Object.entries(deps)) {
        if (isReference(version) || !isPinned(version)) continue
        entries.push({ file: manifest.file, name, version, section })
      }
    }
    const workspaces = manifest.json["workspaces"]
    const catalog = isRecord(workspaces) ? asStringMap(workspaces["catalog"]) : undefined
    if (!catalog) continue
    for (const [name, version] of Object.entries(catalog)) {
      if (isReference(version) || !isPinned(version)) continue
      entries.push({ file: manifest.file, name, version, section: "catalog" })
    }
  }

  const catalogVersions = new Map<string, string>()
  for (const entry of entries) {
    if (entry.section === "catalog" && !catalogVersions.has(entry.name)) catalogVersions.set(entry.name, entry.version)
  }

  const overrideMismatches: OverrideMismatch[] = []
  const patchMismatches: PatchMismatch[] = []
  for (const manifest of manifests) {
    const overrides = asStringMap(manifest.json["overrides"])
    if (overrides) {
      for (const [name, version] of Object.entries(overrides)) {
        if (isReference(version) || !isPinned(version)) continue
        const catalogVersion = catalogVersions.get(name)
        if (catalogVersion !== undefined && catalogVersion !== version)
          overrideMismatches.push({ name, overrideVersion: version, catalogVersion })
      }
    }

    const patches = asStringMap(manifest.json["patchedDependencies"])
    if (patches) {
      for (const [key, patchPath] of Object.entries(patches)) {
        const at = key.lastIndexOf("@")
        if (at <= 0) continue
        const name = key.slice(0, at)
        const patchVersion = key.slice(at + 1)
        const found = entries.find((e) => e.name === name && e.section === "catalog") ?? entries.find((e) => e.name === name)
        if (found && found.version !== patchVersion)
          patchMismatches.push({ name, patchVersion, foundVersion: found.version, patchKey: key, patchPath })
      }
    }
  }

  const byName = new Map<string, PinnedEntry[]>()
  for (const entry of entries) {
    const list = byName.get(entry.name) ?? []
    list.push(entry)
    byName.set(entry.name, list)
  }
  const divergent: Divergence[] = []
  for (const [name, list] of byName) {
    if (new Set(list.map((entry) => entry.version)).size <= 1) continue
    divergent.push({
      name,
      versions: list.map((entry) => ({ file: entry.file, section: entry.section, version: entry.version })),
    })
  }

  return { entries, divergent, overrideMismatches, patchMismatches }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Rewrite pinned versions section-scoped and version-anchored: only the exact `from` token inside
 * the named section block is touched, so a literal in `overrides`/`patchedDependencies` equal to a
 * scanned pin is never rewritten. Flat string-map sections assumed; a nested section degrades to a
 * no-match (recorded in `missed`), never a wrong write.
 */
export function applyTargets(content: string, updates: ApplyUpdate[]): { content: string; missed: string[] } {
  const missed: string[] = []
  const bySection = new Map<DepSection, ApplyUpdate[]>()
  for (const update of updates) {
    const list = bySection.get(update.section) ?? []
    list.push(update)
    bySection.set(update.section, list)
  }

  let result = content
  for (const [section, sectionUpdates] of bySection) {
    const block = new RegExp(`("${escapeRegex(section)}"\\s*:\\s*\\{)([^{}]*)(\\})`)
    if (!block.test(result)) {
      for (const update of sectionUpdates) missed.push(`${update.name}@${update.from} in ${update.file}`)
      continue
    }
    result = result.replace(block, (_match, open: string, body: string, close: string) => {
      let next = body
      for (const update of sectionUpdates) {
        const dep = new RegExp(`("${escapeRegex(update.name)}"\\s*:\\s*")${escapeRegex(update.from)}(")`)
        if (dep.test(next)) next = next.replace(dep, `$1${update.to}$2`)
        else missed.push(`${update.name}@${update.from} in ${update.file}`)
      }
      return `${open}${next}${close}`
    })
  }

  return { content: result, missed }
}

/** Fetch every published version of a package (abbreviated packument), or the "error" sentinel. */
async function fetchVersionList(name: string): Promise<string[] | "error"> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return "error"
    const raw: unknown = await res.json()
    if (!isRecord(raw)) return "error"
    const versions = raw["versions"]
    if (!isRecord(versions)) return "error"
    return Object.keys(versions)
  } catch {
    return "error"
  }
}

/** Advance a fixed-size worker pool over `items`, invoking `worker` once per item. */
async function runPool(items: string[], concurrency: number, worker: (item: string) => Promise<void>): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor++
      if (item === undefined) break
      await worker(item)
    }
  })
  await Promise.all(runners)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const check = process.argv.includes("--check")
  const apply = process.argv.includes("--apply")
  const install = process.argv.includes("--install")
  const typecheck = process.argv.includes("--typecheck")
  const all = process.argv.includes("--all")

  if (check && apply) {
    console.error("error: --check and --apply are mutually exclusive")
    process.exit(2)
  }
  if (typecheck && !apply) {
    console.error("error: --typecheck requires --apply")
    process.exit(2)
  }

  const files = all ? findPackageJsonFiles(ROOT) : workspaceManifestFiles(ROOT)
  console.log(`\nScanning ${files.length} package.json files...\n`)

  const manifests = files.flatMap((file) => {
    try {
      const json: Record<string, unknown> = JSON.parse(readFileSync(file, "utf-8"))
      return [{ file: relative(ROOT, file), json }]
    } catch {
      return []
    }
  })

  const { entries, divergent, overrideMismatches, patchMismatches } = collectPinnedDeps(manifests)
  console.log(`Found ${entries.length} pinned dependency entries to check.\n`)

  const names = [...new Set(entries.map((entry) => entry.name))]
  const versionsByName = new Map<string, string[] | "error">()
  let checked = 0
  await runPool(names, 8, async (name) => {
    versionsByName.set(name, await fetchVersionList(name))
    checked++
    process.stderr.write(`\rChecking ${checked}/${names.length}...`)
  })
  process.stderr.write("\r" + " ".repeat(50) + "\r")

  const failed = names.filter((name) => versionsByName.get(name) === "error")
  const results = entries.flatMap((entry) => {
    const list = versionsByName.get(entry.name)
    if (list === undefined || list === "error") return []
    const parsed = parseSemver(entry.version)
    if (!parsed) return []
    const latestInRange = sameChannelVersion(parsed, list)
    if (latestInRange === null) return []
    return [{ name: entry.name, current: entry.version, latestInRange, file: entry.file, section: entry.section }]
  })
  results.sort((a, b) => a.name.localeCompare(b.name))

  // --- Report ---
  console.log("\n=== Available Minor/Patch Upgrades ===\n")

  if (results.length === 0) {
    console.log("All dependencies are up to date!")
  } else {
    const groups = new Map<string, { name: string; current: string; latestInRange: string }[]>()
    for (const r of results) {
      const key = r.section === "catalog" ? `[catalog] ${r.file}` : r.file
      const list = groups.get(key) ?? []
      list.push({ name: r.name, current: r.current, latestInRange: r.latestInRange })
      groups.set(key, list)
    }
    for (const [key, list] of groups) {
      console.log(`\n  ${key}`)
      for (const r of list) console.log(`    ${r.name}: ${r.current} → ${r.latestInRange}`)
    }
    console.log(`\nTotal: ${results.length} dependencies can be upgraded across ${groups.size} groups.\n`)
  }

  for (const d of divergent)
    console.error(
      `⚠ [divergence] ${d.name} pinned to multiple versions across entries: ${d.versions.map((v) => `${v.file}@${v.version}`).join(", ")}`,
    )
  for (const m of overrideMismatches)
    console.error(`⚠ [override-mismatch] ${m.name}: ${m.overrideVersion} vs catalog ${m.catalogVersion}`)
  for (const m of patchMismatches)
    console.error(`⚠ [patch-mismatch] ${m.patchKey} vs ${m.foundVersion} — ${m.patchPath} is keyed to the old version`)
  if (failed.length > 0) {
    console.error("\nCheck failures:")
    for (const name of failed) console.error(`  ⚠ [fetch-fail] ${name}`)
  }

  // --- Apply ---
  if (apply && results.length > 0) {
    console.log("=== Applying Updates ===\n")

    const byFile = new Map<string, ApplyUpdate[]>()
    for (const r of results) {
      const list = byFile.get(r.file) ?? []
      list.push({ file: r.file, name: r.name, from: r.current, to: r.latestInRange, section: r.section })
      byFile.set(r.file, list)
    }

    for (const [file, updates] of byFile) {
      const absPath = join(ROOT, file)
      const before = readFileSync(absPath, "utf-8")
      const { content, missed } = applyTargets(before, updates)
      if (content !== before) {
        writeFileSync(absPath, content, "utf-8")
        console.log(`  ✓ Updated ${file}`)
      }
      for (const m of missed) console.log(`  ⚠ [apply-warn] could not find ${m} (version format mismatch?)`)
    }

    if (overrideMismatches.length > 0 || patchMismatches.length > 0)
      console.error("  ⚠ [apply-warn] overrides/patchedDependencies mismatches are report-only and were not rewritten")

    console.log("\nDone applying updates.\n")

    if (install) {
      console.log("Running bun install...\n")
      execSync("bun install", { cwd: ROOT, stdio: "inherit" })
      console.log("\nDone.")
    }

    if (typecheck) {
      if (!install)
        console.error(
          "note: --typecheck without --install — the lockfile was not refreshed, so the typecheck may see pre-install state",
        )
      console.log("Running typecheck...\n")
      execSync("bun run --cwd packages/opencode typecheck", { cwd: ROOT, stdio: "inherit" })
      console.log("\nDone.")
    }
  }

  if (check) process.exit(results.length > 0 || failed.length > 0 ? 1 : 0)
}

if (import.meta.main) await main()
