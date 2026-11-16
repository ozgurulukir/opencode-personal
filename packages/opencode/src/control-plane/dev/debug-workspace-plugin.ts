import type { Plugin } from "@opencode-ai/plugin"
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises"
import { randomInt } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

// The dev-data file carries environment secrets, so keep it out of the shared
// /tmp namespace: uid-qualify the final path and stage writes in a private
// mkdtemp directory with 0600 permissions.
const DEV_DATA_FILE = path.join(tmpdir(), `opencode-workspace-dev-data-${process.getuid?.() ?? "u"}.json`)

async function waitForHealth(port: number) {
  const url = `http://127.0.0.1:${port}/global/health`
  const started = Date.now()

  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {}

    await sleep(250)
  }

  throw new Error(`Timed out waiting for debug server health check at ${url}`)
}

let PORT: number | undefined

async function writeDebugData(port: number, id: string, env: Record<string, string | undefined>) {
  const stagingDir = await mkdtemp(path.join(tmpdir(), "opencode-workspace-dev-"))
  const stagingFile = path.join(stagingDir, "data.json")
  try {
    await writeFile(
      stagingFile,
      JSON.stringify(
        {
          port,
          id,
          env,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    )
    await rename(stagingFile, DEV_DATA_FILE)
  } finally {
    await rm(stagingDir, { recursive: true, force: true })
  }
}

export const DebugWorkspacePlugin: Plugin = async ({ experimental_workspace }) => {
  experimental_workspace.register("debug", {
    name: "Debug",
    description: "Create a debugging server",
    configure(config) {
      return config
    },
    async create(config, env) {
      const port = randomInt(5000, 9001)
      PORT = port

      await writeDebugData(port, config.id, env)

      await waitForHealth(port)
    },
    async remove(_config) {},
    target(_config) {
      return {
        type: "remote",
        url: `http://localhost:${PORT!}/`,
      }
    },
  })

  return {}
}

export default DebugWorkspacePlugin
