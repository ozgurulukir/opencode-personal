import path from "path"
import * as Process from "./process"

export async function extractZip(zipPath: string, destDir: string) {
  if (process.platform === "win32") {
    const winZipPath = path.resolve(zipPath)
    const winDestDir = path.resolve(destDir)
    // -LiteralPath (no wildcard interpretation) and doubled single quotes so a
    // `'` in a path cannot terminate the quoted literal and inject statements.
    // $global:ProgressPreference suppresses PowerShell's blue progress bar popup
    const quote = (value: string) => value.replaceAll("'", "''")
    const cmd = `$global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${quote(winZipPath)}' -DestinationPath '${quote(winDestDir)}' -Force`
    await Process.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd])
    return
  }

  await Process.run(["unzip", "-o", "-q", zipPath, "-d", destDir])
}

export * as Archive from "./archive"
