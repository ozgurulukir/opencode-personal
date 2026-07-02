#!/usr/bin/env bun
import { mkdir, readlink, symlink, unlink } from "node:fs/promises"
import path from "node:path"

// Bun may resolve duplicate @opentui instances for packages/opencode because of
// opentui-spinner's older peer dependency range. Redirect package-local @opentui
// symlinks back through the root hoisted copies so TypeScript sees one instance.
const root = path.resolve(import.meta.dirname, "..")
const packageDir = path.join(root, "packages", "opencode", "node_modules", "@opentui")
const rootDir = path.join(root, "node_modules", "@opentui")

const packages = ["core", "keymap", "solid"]

for (const pkg of packages) {
  const rootLink = path.join(rootDir, pkg)
  const packageLink = path.join(packageDir, pkg)

  try {
    await readlink(rootLink)
    const relativeTarget = path.relative(path.dirname(packageLink), rootLink)

    try {
      await unlink(packageLink)
    } catch {}

    await mkdir(path.dirname(packageLink), { recursive: true })
    await symlink(relativeTarget, packageLink)
  } catch (error) {
    console.warn(`[dedupe-opentui] could not dedupe ${pkg}:`, error)
  }
}
