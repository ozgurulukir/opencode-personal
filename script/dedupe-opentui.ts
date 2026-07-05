#!/usr/bin/env bun
import { mkdir, readdir, readlink, symlink, unlink, stat } from "node:fs/promises"
import path from "node:path"

// Bun may resolve duplicate @opentui instances for packages/opencode because of
// opentui-spinner's older peer dependency range. Redirect package-local @opentui
// symlinks back through the root hoisted copies so TypeScript sees one instance.
const root = path.resolve(import.meta.dirname, "..")
const rootDir = path.join(root, "node_modules", "@opentui")

const packages = ["core", "keymap", "solid"]

async function relink(target: string, linkPath: string) {
  try {
    await readlink(target)
  } catch {
    // Root link doesn't exist; nothing to dedupe to.
    return
  }

  const relativeTarget = path.relative(path.dirname(linkPath), target)

  try {
    await unlink(linkPath)
  } catch {}

  await mkdir(path.dirname(linkPath), { recursive: true })
  await symlink(relativeTarget, linkPath)
}

// Find all package subdirectories under packages/ that contain node_modules/@opentui
const packagesBase = path.join(root, "packages")
const targetDirs: string[] = []
try {
  const dirs = await readdir(packagesBase)
  for (const dir of dirs) {
    const p = path.join(packagesBase, dir, "node_modules", "@opentui")
    try {
      const s = await stat(p)
      if (s.isDirectory()) {
        targetDirs.push(p)
      }
    } catch {}
  }
} catch {}

for (const targetDir of targetDirs) {
  for (const pkg of packages) {
    const rootLink = path.join(rootDir, pkg)
    const packageLink = path.join(targetDir, pkg)
    await relink(rootLink, packageLink).catch((error) => {
      console.warn(`[dedupe-opentui] could not dedupe ${pkg} in ${targetDir}:`, error)
    })
  }
}

// opentui-spinner itself resolves its peer dependencies to an older @opentui
// version. Force its internal @opentui symlinks to the same root hoisted copies
// so runtime imports use the same module instance as the rest of the app.
const bunDir = path.join(root, "node_modules", ".bun")
let spinnerEntries: string[] = []
try {
  spinnerEntries = await readdir(bunDir)
} catch {}

for (const entry of spinnerEntries) {
  if (!entry.startsWith("opentui-spinner@")) continue
  const spinnerOpentuiDir = path.join(bunDir, entry, "node_modules", "@opentui")
  for (const pkg of ["core", "solid"]) {
    const rootLink = path.join(rootDir, pkg)
    const packageLink = path.join(spinnerOpentuiDir, pkg)
    await relink(rootLink, packageLink).catch((error) => {
      console.warn(`[dedupe-opentui] could not dedupe ${pkg} in ${entry}:`, error)
    })
  }
}
