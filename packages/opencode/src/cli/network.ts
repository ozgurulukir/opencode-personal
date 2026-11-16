import type { Argv, InferredOptionTypes } from "yargs"
import { Config } from "@/config/config"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect } from "effect"

const options = {
  port: {
    type: "number" as const,
    describe: "port to listen on",
    default: 0,
  },
  hostname: {
    type: "string" as const,
    describe: "hostname to listen on",
    default: "127.0.0.1",
  },
  mdns: {
    type: "boolean" as const,
    describe: "enable mDNS service discovery (defaults hostname to 0.0.0.0)",
    default: false,
  },
  "mdns-domain": {
    type: "string" as const,
    describe: "custom domain name for mDNS service (default: opencode.local)",
    default: "opencode.local",
  },
  cors: {
    type: "string" as const,
    array: true,
    describe: "additional domains to allow for CORS",
    default: [] as string[],
  },
}

export type NetworkOptions = InferredOptionTypes<typeof options>

export function withNetworkOptions<T>(yargs: Argv<T>) {
  return yargs.options(options)
}
export const resolveNetworkOptions = Effect.fn("Cli.resolveNetworkOptions")(function* (args: NetworkOptions) {
  const config = yield* Config.Service.use((cfg) => cfg.getGlobal())
  return resolveNetworkOptionsNoConfig(args, config)
})

export function resolveNetworkOptionsNoConfig(args: NetworkOptions, config?: Config.Info) {
  const portExplicitlySet = process.argv.includes("--port")
  const hostnameExplicitlySet = process.argv.includes("--hostname")
  const mdnsExplicitlySet = process.argv.includes("--mdns")
  const mdnsDomainExplicitlySet = process.argv.includes("--mdns-domain")
  const mdns = mdnsExplicitlySet ? args.mdns : (config?.server?.mdns ?? args.mdns)
  const mdnsDomain = mdnsDomainExplicitlySet ? args["mdns-domain"] : (config?.server?.mdnsDomain ?? args["mdns-domain"])
  const port = portExplicitlySet ? args.port : (config?.server?.port ?? args.port)
  const hostname = hostnameExplicitlySet
    ? args.hostname
    : mdns && !config?.server?.hostname
      ? "0.0.0.0"
      : (config?.server?.hostname ?? args.hostname)
  const configCors = config?.server?.cors ?? []
  const argsCors = Array.isArray(args.cors) ? args.cors : args.cors ? [args.cors] : []
  const cors = [...configCors, ...argsCors]

  return { hostname, port, mdns, mdnsDomain, cors }
}

function isLoopbackHostname(hostname: string) {
  const bare = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  return bare === "localhost" || bare === "::1" || bare === "::" || bare.startsWith("127.")
}

/**
 * Returns an error message when the resolved server hostname would expose the
 * API beyond loopback without any authentication: the Authorization middleware
 * is a no-op unless OPENCODE_SERVER_PASSWORD is set, so binding a non-loopback
 * hostname (including the `--mdns` default `0.0.0.0`) would expose
 * shell/PTY/config endpoints to the network. Honors the explicit
 * OPENCODE_ALLOW_INSECURE_REMOTE=1 opt-in.
 */
export function insecureBindingError(hostname: string): string | undefined {
  if (isLoopbackHostname(hostname)) return undefined
  if (Flag.OPENCODE_SERVER_PASSWORD) return undefined
  if (Flag.OPENCODE_ALLOW_INSECURE_REMOTE === "1" || Flag.OPENCODE_ALLOW_INSECURE_REMOTE === "true") return undefined
  return `Refusing to bind to non-loopback hostname "${hostname}" without OPENCODE_SERVER_PASSWORD. Set OPENCODE_SERVER_PASSWORD, use --hostname 127.0.0.1, or set OPENCODE_ALLOW_INSECURE_REMOTE=1 to accept the risk.`
}
