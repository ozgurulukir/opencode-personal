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
  try {
    return fs.realpathSync(resolved)
  } catch {
    // Non-existent file: resolve the parent directory to catch symlinks in the path
    const parent = path.dirname(resolved)
    try {
      return path.join(fs.realpathSync(parent), path.basename(resolved))
    } catch {
      return resolved
    }
  }
}

export function projectContainmentError(filepath: string, directory: string): string | undefined {
  if (filepath.startsWith(directory + path.sep) || filepath === directory) return undefined
  return `Path escapes project directory: ${filepath}`
}