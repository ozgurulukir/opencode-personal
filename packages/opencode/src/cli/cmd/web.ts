import { Effect } from "effect"
import { Server } from "../../server/server"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@opencode-ai/core/flag/flag"
import open from "open"
import { networkInterfaces } from "os"

function getNetworkIPs() {
  const nets = networkInterfaces()
  const results: string[] = []

  // Virtual/docker interface name patterns
  const virtualPatterns = [
    /^docker\d+$/i,
    /^br-[0-9a-f]+$/i,
    /^veth[a-f0-9]+$/i,
    /^virbr\d+$/i,
    /^vboxnet\d+$/i,
    /^tun\d+$/i,
    /^tap\d+$/i,
    /^wsl$/i,
    /^wsl\d+$/i,
  ]

  const isVirtual = (name: string) => virtualPatterns.some((pattern) => pattern.test(name))

  for (const name of Object.keys(nets)) {
    const net = nets[name]
    if (!net) continue
    if (isVirtual(name)) continue

    for (const netInfo of net) {
      if (netInfo.internal || netInfo.family !== "IPv4") continue
      if (netInfo.address.startsWith("169.254.")) continue // link-local
      if (netInfo.address.startsWith("172.")) continue // docker/vpn range

      results.push(netInfo.address)
    }
  }

  // Sort: prefer RFC1918 private ranges (192.168.x.x, 10.x.x.x) over others
  results.sort((a, b) => {
    const aPrivate = a.startsWith("192.168.") || a.startsWith("10.") ? 0 : 1
    const bPrivate = b.startsWith("192.168.") || b.startsWith("10.") ? 0 : 1
    return aPrivate - bPrivate || a.localeCompare(b)
  })

  return results
}

export const WebCommand = effectCmd({
  command: "web",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "start opencode server and open web interface",
  // Server loads instances per-request via x-opencode-directory header — no
  // ambient project InstanceContext needed at startup.
  instance: false,
  handler: Effect.fn("Cli.web")(function* (args) {
    if (!Flag.OPENCODE_SERVER_PASSWORD) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "!  OPENCODE_SERVER_PASSWORD is not set; server is unsecured.")
    }
    const opts = yield* resolveNetworkOptions(args)
    const server = yield* Effect.promise(() => Server.listen(opts))
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    if (opts.hostname === "0.0.0.0") {
      // Show localhost for local access
      const localhostUrl = `http://localhost:${server.port}`
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Local access:      ", UI.Style.TEXT_NORMAL, localhostUrl)

      // Show network IPs for remote access
      const networkIPs = getNetworkIPs()
      if (networkIPs.length > 0) {
        for (const ip of networkIPs) {
          UI.println(
            UI.Style.TEXT_INFO_BOLD + "  Network access:    ",
            UI.Style.TEXT_NORMAL,
            `http://${ip}:${server.port}`,
          )
        }
      }

      if (opts.mdns) {
        UI.println(
          UI.Style.TEXT_INFO_BOLD + "  mDNS:              ",
          UI.Style.TEXT_NORMAL,
          `${opts.mdnsDomain}:${server.port}`,
        )
      }

      // Open localhost in browser
      open(localhostUrl).catch(() => {})
    } else {
      const displayUrl = server.url.toString()
      UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, displayUrl)
      open(displayUrl).catch(() => {})
    }

    yield* Effect.never
  }),
})
