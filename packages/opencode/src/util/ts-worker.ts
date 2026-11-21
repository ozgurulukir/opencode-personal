import fs from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"

// Version of the pre-bundled tree-sitter worker embedded in compiled binaries.
// Bump when @opentui/core or the bundling in script/build.ts changes so stale
// on-disk copies are replaced.
export const WORKER_BUNDLE_VERSION = "0.2.16-1"

export function workerFilePath(dataDir: string = Global.Path.data) {
  return path.join(dataDir, "tree-sitter", `parser.worker.bundle-${WORKER_BUNDLE_VERSION}.js`)
}

function isCompiledBinary() {
  const name = path.basename(process.execPath).toLowerCase()
  return name !== "bun" && name !== "bun.exe"
}

async function embeddedWorkerSource(): Promise<string | undefined> {
  try {
    const mod = await import("embedded:ts-worker-bundle")
    const source = (mod as { default?: unknown }).default
    return typeof source === "string" && source.length > 0 ? source : undefined
  } catch {
    // Dev (no build plugin) or older binary without the embedded bundle.
    return undefined
  }
}

/**
 * Compiled binaries cannot load the tree-sitter worker from Bun's virtual
 * filesystem (Worker entries must be real files — proven with a minimal
 * repro on Bun 1.3.14), so the build embeds a pre-bundled self-contained
 * worker as text. Extract it to the data dir once and point @opentui/core at
 * it via the env var its client checks before any other worker resolution.
 * No-op in dev (worker resolves from node_modules) and when the user already
 * overrode OTUI_TREE_SITTER_WORKER_PATH.
 */
/**
 * Whether the on-disk worker must be (re)written: missing file OR content
 * drift. Guards against stale workers after an @opentui/core upgrade without
 * a version bump — the stale copy would keep being served (raw markdown
 * output).
 */
export function workerNeedsWrite(file: string, source: string): boolean {
  return !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== source
}

export async function ensureTreeSitterWorker(): Promise<void> {
  if (process.env.OTUI_TREE_SITTER_WORKER_PATH) return
  if (!isCompiledBinary()) return
  const source = await embeddedWorkerSource()
  if (!source) return
  const file = workerFilePath()
  if (workerNeedsWrite(file, source)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await Bun.write(file, source)
  }
  process.env.OTUI_TREE_SITTER_WORKER_PATH = file
}
