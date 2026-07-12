#!/usr/bin/env bun
/**
 * Checks all dependencies across the monorepo for available minor/patch upgrades.
 *
 * Usage:
 *   bun run script/check-updates.ts              # check all deps
 *   bun run script/check-updates.ts --apply       # apply bumps to package.json files
 *   bun run script/check-updates.ts --apply --install  # apply + bun install
 *
 * Scans every package.json in the workspace (excluding node_modules, dist, .git).
 * For each pinned version (no ^ ~ workspace:* catalog:), checks npm registry
 * for the latest version within the same major range.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs"
import { join, relative } from "path"
import { execSync } from "child_process"

const ROOT = join(import.meta.dir, "..")
const APPLY = process.argv.includes("--apply")
const INSTALL = process.argv.includes("--install")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively find all package.json files, excluding common noise dirs. */
function findPackageJsonFiles(dir: string): string[] {
  const results: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "dist.old" || entry.name === ".turbo" || entry.name === ".output" || entry.name === "out" || entry.name === ".sst" || entry.name.startsWith("dist.")) continue
    if (entry.isDirectory()) results.push(...findPackageJsonFiles(full))
    else if (entry.name === "package.json") results.push(full)
  }
  return results
}

/** Check if a version string is pinned (no semver range prefix). */
function isPinned(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)
}

/** Check if a version is a catalog: or workspace:* reference. */
function isReference(version: string): boolean {
  return version === "catalog:" || version.startsWith("workspace:") || version.startsWith("npm:") || version.startsWith("github:") || version.startsWith("file:") || version.startsWith("https://")
}

/** Parse semver parts. */
function parseSemver(v: string): { major: number; minor: number; patch: number; prerelease: string | null } | null {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?$/)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null }
}

/** Fetch the latest version of a package from npm registry. */
async function fetchLatestVersion(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: string }
    return data.version ?? null
  } catch {
    return null
  }
}

/** Fetch all versions of a package to find latest in a major range. */
async function fetchVersionsInRange(name: string, major: number): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { versions?: Record<string, unknown> }
    if (!data.versions) return null
    const versions = Object.keys(data.versions)
      .filter((v) => {
        const p = parseSemver(v)
        return p && p.major === major && !p.prerelease
      })
      .sort((a, b) => {
        const pa = parseSemver(a)!
        const pb = parseSemver(b)!
        if (pa.major !== pb.major) return pa.major - pb.major
        if (pa.minor !== pb.minor) return pa.minor - pb.minor
        return pa.patch - pb.patch
      })
    return versions.length > 0 ? versions[versions.length - 1] : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const files = findPackageJsonFiles(ROOT)
console.log(`\nScanning ${files.length} package.json files...\n`)

// Collect all unique deps with their current versions
const depMap = new Map<string, { files: Set<string>; currentVersion: string }>()

for (const file of files) {
  const content = readFileSync(file, "utf-8")
  let json: Record<string, unknown>
  try { json = JSON.parse(content) } catch { continue }

  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const) {
    const deps = json[section] as Record<string, string> | undefined
    if (!deps) continue
    for (const [name, version] of Object.entries(deps)) {
      if (isReference(version)) continue
      if (!isPinned(version)) continue
      const rel = relative(ROOT, file)
      if (!depMap.has(name)) depMap.set(name, { files: new Set(), currentVersion: version })
      depMap.get(name)!.files.add(rel)
      // Keep the first version encountered (they should be consistent)
    }
  }
}

console.log(`Found ${depMap.size} unique pinned dependencies to check.\n`)

// Check each dep
const results: { name: string; current: string; latest: string; latestInRange: string | null; files: string[] }[] = []

let checked = 0
for (const [name, info] of depMap) {
  checked++
  const parsed = parseSemver(info.currentVersion)
  if (!parsed) continue

  // Show progress every 20 deps
  if (checked % 20 === 0 || checked === depMap.size) {
    process.stderr.write(`\rChecking ${checked}/${depMap.size}...`)
  }

  const latestInRange = await fetchVersionsInRange(name, parsed.major)
  if (!latestInRange) continue

  const latestParsed = parseSemver(latestInRange)
  if (!latestParsed) continue

  // Check if there's an actual upgrade
  if (latestParsed.minor > parsed.minor || latestParsed.patch > parsed.patch) {
    results.push({
      name,
      current: info.currentVersion,
      latest: latestInRange,
      latestInRange,
      files: [...info.files],
    })
  }
}

process.stderr.write("\r" + " ".repeat(50) + "\r")

// Sort results
results.sort((a, b) => a.name.localeCompare(b.name))

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log("\n=== Available Minor/Patch Upgrades ===\n")

if (results.length === 0) {
  console.log("All dependencies are up to date!")
} else {
  // Group by file
  const fileGroups = new Map<string, { name: string; current: string; latest: string }[]>()
  for (const r of results) {
    for (const f of r.files) {
      if (!fileGroups.has(f)) fileGroups.set(f, [])
      fileGroups.get(f)!.push({ name: r.name, current: r.current, latest: r.latest })
    }
  }

  for (const [file, deps] of fileGroups) {
    console.log(`\n  ${file}`)
    for (const d of deps) {
      console.log(`    ${d.name}: ${d.current} → ${d.latest}`)
    }
  }

  console.log(`\nTotal: ${results.length} dependencies can be upgraded across ${fileGroups.size} files.\n`)
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

if (APPLY && results.length > 0) {
  console.log("=== Applying Updates ===\n")

  // Group by file for applying
  const applyGroups = new Map<string, Map<string, string>>()
  for (const r of results) {
    for (const f of r.files) {
      if (!applyGroups.has(f)) applyGroups.set(f, new Map())
      applyGroups.get(f)!.set(r.name, r.latest)
    }
  }

  for (const [file, updates] of applyGroups) {
    const absPath = join(ROOT, file)
    let content = readFileSync(absPath, "utf-8")
    let changed = false

    for (const [name, latest] of updates) {
      // Match the exact version string in the JSON (handle both "name": "x.y.z" and "name": "x.y.z",)
      const regex = new RegExp(`("${escapeRegex(name)}"\\s*:\\s*")(\\d+\\.\\d+\\.\\d+(?:-[^"]+)?)(")`, "g")
      const newContent = content.replace(regex, (match, prefix, _old, suffix) => {
        changed = true
        return `${prefix}${latest}${suffix}`
      })
      if (newContent !== content) {
        content = newContent
      } else {
        console.log(`  ⚠ Could not find ${name} in ${file} (version format mismatch?)`)
      }
    }

    if (changed) {
      writeFileSync(absPath, content, "utf-8")
      console.log(`  ✓ Updated ${file}`)
    }
  }

  console.log("\nDone applying updates.\n")

  if (INSTALL) {
    console.log("Running bun install...\n")
    execSync("bun install", { cwd: ROOT, stdio: "inherit" })
    console.log("\nDone.")
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
