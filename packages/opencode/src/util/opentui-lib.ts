import fs from "fs"
import path from "path"
import { ensureTreeSitterWorker } from "./ts-worker"

const libName = (() => {
  switch (process.platform) {
    case "win32":
      return "opentui.dll"
    case "darwin":
      return "libopentui.dylib"
    default:
      return "libopentui.so"
  }
})()

function findBundledLib(): string | undefined {
  try {
    const binaryDir = path.dirname(process.execPath)
    const candidate = path.join(binaryDir, libName)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  } catch {
    // ignore
  }
  return undefined
}

/**
 * In a Bun --compile binary, @opentui/core embeds libopentui.* as a file asset
 * and resolves it to a /$bunfs/root/... path. The OS dynamic linker cannot load
 * a shared library from Bun's virtual filesystem, so dlopen fails. The package
 * also embeds native .node bindings (e.g. @parcel/watcher) that have the same
 * problem.
 *
 * When real copies of these libraries are shipped next to the binary, point
 * OpenTUI at the native library before the renderer is created, and register
 * the <spinner> component explicitly because the side-effect-only import from
 * "opentui-spinner/solid" can be dropped by the bundler.
 */
function isBunRuntime(): boolean {
  const name = path.basename(process.execPath).toLowerCase()
  return name === "bun" || name === "bun.exe"
}

export async function setupOpenTUILib(): Promise<void> {
  // Extract the pre-bundled tree-sitter worker for compiled binaries before
  // any TreeSitterClient is created (the client is a lazy singleton, so boot
  // ordering is sufficient). No-op in dev and when already overridden.
  await ensureTreeSitterWorker()

  const bundledPath = findBundledLib()
  const runningUnderBun = isBunRuntime()

  // In a compiled binary, point @opentui/core at the real native library next
  // to the executable instead of the /$bunfs/root/... virtual path it embeds.
  if (bundledPath) {
    const { setRenderLibPath, resolveRenderLib } = await import("@opentui/core")
    setRenderLibPath(bundledPath)

    try {
      resolveRenderLib()
    } catch {
      // resolveRenderLib will be retried later when the renderer is created.
    }
  }

  // opentui-spinner's peer dependencies resolve to an older @opentui version.
  // Its side-effect-only import can also be dropped by the bundler. Register
  // the <spinner> element explicitly against the same @opentui/solid instance
  // the app uses. Only do this when the native lib is present (compiled binary)
  // or when running under Bun directly (dev); skip during the pre-copy smoke
  // test that runs the binary before libopentui.* has been copied next to it.
  if (bundledPath || runningUnderBun) {
    const { extend } = await import("@opentui/solid")
    const { SpinnerRenderable } = await import("opentui-spinner")
    extend({ spinner: SpinnerRenderable as any })
  }
}
