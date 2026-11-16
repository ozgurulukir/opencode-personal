import {
  type Info,
  NearestRoot,
  pathExists,
  run,
  spawn,
  which,
  path,
  fs,
  os,
  log,
  Filesystem,
  Flag,
  Global,
} from "./shared"
import { createHash } from "node:crypto"

export const JDTLS: Info = {
  id: "jdtls",
  root: async (file, ctx) => {
    // Without exclusions, NearestRoot defaults to instance directory so we can't
    // distinguish between a) no project found and b) project found at instance dir.
    // So we can't choose the root from (potential) monorepo markers first.
    // Look for potential subproject markers first while excluding potential monorepo markers.
    const settingsMarkers = ["settings.gradle", "settings.gradle.kts"]
    const gradleMarkers = ["gradlew", "gradlew.bat"]
    const exclusionsForMonorepos = gradleMarkers.concat(settingsMarkers)

    const [projectRoot, wrapperRoot, settingsRoot] = await Promise.all([
      NearestRoot(["pom.xml", "build.gradle", "build.gradle.kts", ".project", ".classpath"], exclusionsForMonorepos)(
        file,
        ctx,
      ),
      NearestRoot(gradleMarkers, settingsMarkers)(file, ctx),
      NearestRoot(settingsMarkers)(file, ctx),
    ])

    // If projectRoot is undefined we know we are in a monorepo or no project at all.
    // So can safely fall through to the other roots
    if (projectRoot) return projectRoot
    if (wrapperRoot) return wrapperRoot
    if (settingsRoot) return settingsRoot
  },
  extensions: [".java"],
  async spawn(root) {
    const java = which("java")
    if (!java) {
      log.error("Java 21 or newer is required to run the JDTLS. Please install it first.")
      return
    }
    const javaMajorVersion = await run(["java", "-version"]).then((result) => {
      const m = /"(\d+)\.\d+\.\d+"/.exec(result.stderr.toString())
      return !m ? undefined : parseInt(m[1])
    })
    if (javaMajorVersion == null || javaMajorVersion < 21) {
      log.error("JDTLS requires at least Java 21.")
      return
    }
    const distPath = path.join(Global.Path.bin, "jdtls")
    const launcherDir = path.join(distPath, "plugins")
    const installed = await pathExists(launcherDir)
    if (!installed) {
      if (Flag.OPENCODE_DISABLE_LSP_DOWNLOAD) return
      log.info("Downloading JDTLS LSP server.")
      await fs.mkdir(distPath, { recursive: true })
      const releaseURL =
        "https://www.eclipse.org/downloads/download.php?file=/jdtls/snapshots/jdt-language-server-latest.tar.gz"
      const archiveName = "release.tar.gz"

      log.info("Downloading JDTLS archive", { url: releaseURL, dest: distPath })
      const download = await fetch(releaseURL)
      if (!download.ok || !download.body) {
        log.error("Failed to download JDTLS", { status: download.status, statusText: download.statusText })
        return
      }
      await Filesystem.writeStream(path.join(distPath, archiveName), download.body)

      log.info("Extracting JDTLS archive")
      const tarResult = await run(["tar", "-xzf", archiveName], { cwd: distPath })
      if (tarResult.code !== 0) {
        log.error("Failed to extract JDTLS", { exitCode: tarResult.code, stderr: tarResult.stderr.toString() })
        return
      }

      await fs.rm(path.join(distPath, archiveName), { force: true })
      log.info("JDTLS download and extraction completed")
    }
    const jarFileName =
      (await fs.readdir(launcherDir).catch(() => []))
        .find((item) => /^org\.eclipse\.equinox\.launcher_.*\.jar$/.test(item))
        ?.trim() ?? ""
    const launcherJar = path.join(launcherDir, jarFileName)
    if (!(await pathExists(launcherJar))) {
      log.error(`Failed to locate the JDTLS launcher module in the installed directory: ${distPath}.`)
      return
    }
    const configFile = path.join(
      distPath,
      (() => {
        switch (process.platform) {
          case "darwin":
            return "config_mac"
          case "linux":
            return "config_linux"
          case "win32":
            return "config_win"
          default:
            return "config_linux"
        }
      })(),
    )
    // Stable per-root data dir instead of a fresh mkdtemp per spawn: the
    // mkdtemp path was never returned to a finalizer, so directories
    // accumulated across spawns/retries. A stable path is bounded by the
    // number of project roots and lets JDTLS reuse its workspace metadata
    // across restarts.
    const dataDir = path.join(
      os.tmpdir(),
      `opencode-jdtls-data-${createHash("sha1").update(root).digest("hex").slice(0, 16)}`,
    )
    await fs.mkdir(dataDir, { recursive: true })
    return {
      process: spawn(
        java,
        [
          "-jar",
          launcherJar,
          "-configuration",
          configFile,
          "-data",
          dataDir,
          "-Declipse.application=org.eclipse.jdt.ls.core.id1",
          "-Dosgi.bundles.defaultStartLevel=4",
          "-Declipse.product=org.eclipse.jdt.ls.core.product",
          "-Dlog.level=ALL",
          "--add-modules=ALL-SYSTEM",
          "--add-opens java.base/java.util=ALL-UNNAMED",
          "--add-opens java.base/java.lang=ALL-UNNAMED",
        ],
        {
          cwd: root,
        },
      ),
    }
  },
}
