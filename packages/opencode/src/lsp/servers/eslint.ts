import {
  type Info,
  NearestRoot,
  spawn,
  path,
  fs,
  log,
  Process,
  Filesystem,
  Flag,
  Global,
  Archive,
  Module,
} from "./shared"

export const ESLint: Info = {
  id: "eslint",
  root: NearestRoot(["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock"]),
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue"],
  async spawn(root, ctx) {
    const eslint = Module.resolve("eslint", ctx.directory)
    if (!eslint) return
    log.info("spawning eslint server")
    const serverPath = path.join(Global.Path.bin, "vscode-eslint", "server", "out", "eslintServer.js")
    if (!(await Filesystem.exists(serverPath))) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading and building VS Code ESLint server")
      const response = await fetch("https://github.com/microsoft/vscode-eslint/archive/refs/heads/main.zip")
      if (!response.ok) return

      const zipPath = path.join(Global.Path.bin, "vscode-eslint.zip")
      if (response.body) await Filesystem.writeStream(zipPath, response.body)

      const ok = await Archive.extractZip(zipPath, Global.Path.bin)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract vscode-eslint archive", { error })
          return false
        })
      if (!ok) return
      await fs.rm(zipPath, { force: true })

      const extractedPath = path.join(Global.Path.bin, "vscode-eslint-main")
      const finalPath = path.join(Global.Path.bin, "vscode-eslint")

      const stats = await fs.stat(finalPath).catch(() => undefined)
      if (stats) {
        log.info("removing old eslint installation", { path: finalPath })
        await fs.rm(finalPath, { force: true, recursive: true })
      }
      await fs.rename(extractedPath, finalPath)

      const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm"
      await Process.run([npmCmd, "install"], { cwd: finalPath })
      await Process.run([npmCmd, "run", "compile"], { cwd: finalPath })

      log.info("installed VS Code ESLint server", { serverPath })
    }

    const proc = spawn("node", [serverPath, "--stdio"], {
      cwd: root,
      env: {
        ...process.env,
      },
    })

    return {
      process: proc,
    }
  },
}
