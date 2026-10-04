export * as ConfigManaged from "./managed"

import { existsSync } from "fs"
import os from "os"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { Process } from "@/util/process"

const log = Log.create({ service: "config" })

const MANAGED_PLIST_DOMAIN = "ai.opencode.managed"

// Keys injected by macOS/MDM into the managed plist that are not OpenCode config
const PLIST_META = new Set([
  "PayloadDisplayName",
  "PayloadIdentifier",
  "PayloadType",
  "PayloadUUID",
  "PayloadVersion",
  "_manualProfile",
])

function systemManagedConfigDir(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/opencode"
    case "win32":
      return path.join(process.env.ProgramData || "C:\\ProgramData", "opencode")
    default:
      return "/etc/opencode"
  }
}

export function managedConfigDir() {
  return process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR || systemManagedConfigDir()
}

export function parseManagedPlist(json: string): string {
  const raw = JSON.parse(json)
  for (const key of Object.keys(raw)) {
    if (PLIST_META.has(key)) delete raw[key]
  }
  return JSON.stringify(raw)
}

export async function readManagedPreferences(): Promise<{ source: string; text: string } | undefined> {
  if (process.platform !== "darwin") return undefined

  const user = os.userInfo().username
  const candidatePaths = [
    path.join("/Library/Managed Preferences", user, `${MANAGED_PLIST_DOMAIN}.plist`),
    path.join("/Library/Managed Preferences", `${MANAGED_PLIST_DOMAIN}.plist`),
  ]

  const existingPaths = candidatePaths.filter((plist) => existsSync(plist))
  if (existingPaths.length === 0) return undefined

  for (const plist of existingPaths) {
    log.info("reading macOS managed preferences", { path: plist })
  }

  const results = await Promise.allSettled(
    existingPaths.map((plist) => Process.run(["plutil", "-convert", "json", "-o", "-", plist], { nothrow: true })),
  )

  for (let i = 0; i < existingPaths.length; i++) {
    const plist = existingPaths[i]
    const conversion = results[i]
    if (conversion.status === "rejected") throw conversion.reason
    const result = conversion.value
    if (result.code !== 0) {
      log.warn("failed to convert managed preferences plist", { path: plist })
      continue
    }
    return {
      source: `mobileconfig:${plist}`,
      text: parseManagedPlist(result.stdout.toString()),
    }
  }

  return undefined
}
