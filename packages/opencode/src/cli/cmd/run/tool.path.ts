import os from "os"
import path from "path"
import type { ToolDict, ToolFrame } from "./tool.types"

export function toolPath(input?: string, opts: { home?: boolean } = {}): string {
  if (!input) {
    return ""
  }

  const cwd = process.cwd()
  const home = os.homedir()
  const abs = path.isAbsolute(input) ? input : path.resolve(cwd, input)
  const rel = path.relative(cwd, abs)

  if (!rel) {
    return "."
  }

  if (!rel.startsWith("..")) {
    return rel.replaceAll("\\", "/")
  }

  if (opts.home && home && (abs === home || abs.startsWith(home + path.sep))) {
    return abs.replace(home, "~").replaceAll("\\", "/")
  }

  return abs.replaceAll("\\", "/")
}
