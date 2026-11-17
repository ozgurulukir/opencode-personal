import * as Log from "@opencode-ai/core/util/log"
import { Bonjour } from "bonjour-service"
import { SERVER_DEFAULTS } from "@/config/server"

const log = Log.create({ service: "mdns" })

const MAX_RETRIES = 3
const BASE_DELAY_MS = 500

let bonjour: InstanceType<typeof Bonjour> | undefined
let currentPort: number | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let unpublished = false

export function publish(port: number, domain?: string) {
  if (currentPort === port) return
  if (bonjour) unpublish()
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
  unpublished = false

  const attempt = (retriesLeft: number) => {
    if (unpublished) return
    try {
      const host = domain ?? SERVER_DEFAULTS.mdns_domain
      const name = `opencode-${port}`
      bonjour = new Bonjour()
      const service = bonjour.publish({
        name,
        type: "http",
        host,
        port,
        txt: { path: "/" },
      })

      service.on("up", () => {
        log.info("mDNS service published", { name, port })
      })

      service.on("error", (err) => {
        log.error("mDNS service error", { error: err })
      })

      currentPort = port
    } catch (err) {
      log.error("mDNS publish failed", { error: err, retriesLeft })
      if (bonjour) {
        try {
          bonjour.destroy()
        } catch {}
      }
      bonjour = undefined
      currentPort = undefined

      if (!unpublished && retriesLeft > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, MAX_RETRIES - retriesLeft)
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          attempt(retriesLeft - 1)
        }, delay)
      }
    }
  }

  attempt(MAX_RETRIES)
}

export function unpublish() {
  unpublished = true
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = undefined
  }
  if (bonjour) {
    try {
      bonjour.unpublishAll()
      bonjour.destroy()
    } catch (err) {
      log.error("mDNS unpublish failed", { error: err })
    }
    bonjour = undefined
    currentPort = undefined
    log.info("mDNS service unpublished")
  }
}

export * as MDNS from "./mdns"
