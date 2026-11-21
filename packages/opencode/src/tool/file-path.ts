// Symlink-safe path resolution and project-boundary checks shared by the
// file-mutating tools (write, edit, apply_patch). `path.resolve` normalizes
// `..` segments but does NOT resolve symlinks, so a symlink inside the project
// pointing outside (e.g. `project/link -> /etc`) could escape the
// `startsWith(directory)` boundary check. `resolvePath` canonicalizes the
// real path (or its nearest existing ancestor for not-yet-created files)
// before the containment check runs.

import path from "path"
import fs from "fs"
import { AppFileSystem } from "@opencode-ai/core/filesystem"

export function resolvePath(filePath: string): string {
  const resolved = AppFileSystem.resolve(path.resolve(filePath))
  let current = resolved
  const tail: string[] = []
  while (true) {
    try {
      const real = fs.realpathSync(current)
      return tail.length ? path.join(real, ...tail.reverse()) : real
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return resolved
      tail.push(path.basename(current))
      current = parent
    }
  }
}

export function projectContainmentError(filepath: string, directory: string): string | undefined {
  if (filepath.startsWith(directory + path.sep) || filepath === directory) return undefined
  return `Path escapes project directory: ${filepath}`
}
