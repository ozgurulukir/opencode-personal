import { type Info, NearestRoot, spawn, which, path, fs, log, Filesystem, Flag, Global, Archive } from "./shared"

export const TerraformLS: Info = {
  id: "terraform",
  extensions: [".tf", ".tfvars"],
  root: NearestRoot([".terraform.lock.hcl", "terraform.tfstate", "*.tf"]),
  async spawn(root) {
    let bin = which("terraform-ls")

    if (!bin) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("downloading terraform-ls from HashiCorp releases")

      const releaseResponse = await fetch("https://api.releases.hashicorp.com/v1/releases/terraform-ls/latest")
      if (!releaseResponse.ok) {
        log.error("Failed to fetch terraform-ls release info")
        return
      }

      const release = (await releaseResponse.json()) as {
        version?: string
        builds?: { arch?: string; os?: string; url?: string }[]
      }

      const platform = process.platform
      const arch = process.arch

      const tfArch = arch === "arm64" ? "arm64" : "amd64"
      const tfPlatform = platform === "win32" ? "windows" : platform

      const builds = release.builds ?? []
      const build = builds.find((b) => b.arch === tfArch && b.os === tfPlatform)
      if (!build?.url) {
        log.error(`Could not find build for ${tfPlatform}/${tfArch} terraform-ls release version ${release.version}`)
        return
      }

      const downloadResponse = await fetch(build.url)
      if (!downloadResponse.ok) {
        log.error("Failed to download terraform-ls")
        return
      }

      const tempPath = path.join(Global.Path.bin, "terraform-ls.zip")
      if (downloadResponse.body) await Filesystem.writeStream(tempPath, downloadResponse.body)

      const ok = await Archive.extractZip(tempPath, Global.Path.bin)
        .then(() => true)
        .catch((error) => {
          log.error("Failed to extract terraform-ls archive", { error })
          return false
        })
      if (!ok) return
      await fs.rm(tempPath, { force: true })

      bin = path.join(Global.Path.bin, "terraform-ls" + (platform === "win32" ? ".exe" : ""))

      if (!(await Filesystem.exists(bin))) {
        log.error("Failed to extract terraform-ls binary")
        return
      }

      if (platform !== "win32") {
        await fs.chmod(bin, 0o755).catch(() => {})
      }

      log.info(`installed terraform-ls`, { bin })
    }

    return {
      process: spawn(bin, ["serve"], {
        cwd: root,
      }),
      initialization: {
        experimentalFeatures: {
          prefillRequiredFields: true,
          validateOnSave: true,
        },
      },
    }
  },
}
