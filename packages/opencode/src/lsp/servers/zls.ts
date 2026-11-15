import {
  type Info,
  NearestRoot,
  run,
  spawn,
  which,
  path,
  fs,
  log,
  Filesystem,
  Flag,
  Global,
  Archive,
} from "./shared"

export const Zls: Info = {
  id: "zls",
  extensions: [".zig", ".zon"],
  root: NearestRoot(["build.zig"]),
  async spawn(root) {
    let bin = which("zls")

    if (!bin) {
      const zig = which("zig")
      if (!zig) {
        log.error("Zig is required to use zls. Please install Zig first.")
        return
      }

      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading zls from GitHub releases")

      const releaseResponse = await fetch("https://api.github.com/repos/zigtools/zls/releases/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch zls release info")
        return
      }

      const release = (await releaseResponse.json()) as {
        assets?: { name?: string; browser_download_url?: string }[]
      }

      const platform = process.platform
      const arch = process.arch
      let assetName = ""

      let zlsArch: string = arch
      if (arch === "arm64") zlsArch = "aarch64"
      else if (arch === "x64") zlsArch = "x86_64"
      else if (arch === "ia32") zlsArch = "x86"

      let zlsPlatform: string = platform
      if (platform === "darwin") zlsPlatform = "macos"
      else if (platform === "win32") zlsPlatform = "windows"

      const ext = platform === "win32" ? "zip" : "tar.xz"

      assetName = `zls-${zlsArch}-${zlsPlatform}.${ext}`

      const supportedCombos = [
        "zls-x86_64-linux.tar.xz",
        "zls-x86_64-macos.tar.xz",
        "zls-x86_64-windows.zip",
        "zls-aarch64-linux.tar.xz",
        "zls-aarch64-macos.tar.xz",
        "zls-aarch64-windows.zip",
        "zls-x86-linux.tar.xz",
        "zls-x86-windows.zip",
      ]

      if (!supportedCombos.includes(assetName)) {
        log.error(`Platform ${platform} and architecture ${arch} is not supported by zls`)
        return
      }

      const asset = release.assets?.find((a) => a.name === assetName)
      if (!asset?.browser_download_url) {
        log.error(`Could not find asset ${assetName} in latest zls release`)
        return
      }

      const downloadUrl = asset.browser_download_url
      const downloadResponse = await fetch(downloadUrl)
      if (!downloadResponse.ok) {
        log.error("Failed to download zls")
        return
      }

      const tempPath = path.join(Global.Path.bin, assetName)
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      if (ext === "zip") {
        const ok = await Archive.extractZip(tempPath, Global.Path.bin)
          .then(() => true)
          .catch((error) => {
            log.error("Failed to extract zls archive", { error })
            return false
          })
        if (!ok) return
      } else {
        await run(["tar", "-xf", tempPath], { cwd: Global.Path.bin })
      }

      await fs.rm(tempPath, { force: true })

      bin = path.join(Global.Path.bin, "zls" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract zls binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info(`installed zls`, { bin })
    }

    return {
      process: spawn(bin, {
        cwd: root,
      }),
    }
  },
}
