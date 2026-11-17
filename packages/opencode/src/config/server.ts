import { Schema } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { PositiveInt, withStatics } from "@opencode-ai/core/schema"

// Single source of truth for the mDNS domain, shared with the server and CLI network setup.
export const SERVER_DEFAULTS = {
  mdns_domain: "opencode.local",
} as const

export const Server = Schema.Struct({
  port: Schema.optional(PositiveInt).annotate({
    description: "Port to listen on",
  }),
  hostname: Schema.optional(Schema.String).annotate({ description: "Hostname to listen on" }),
  mdns: Schema.optional(Schema.Boolean).annotate({ description: "Enable mDNS service discovery" }),
  mdnsDomain: Schema.optional(Schema.String).annotate({
    description: `Custom domain name for mDNS service (default: ${SERVER_DEFAULTS.mdns_domain})`,
  }),
  cors: Schema.optional(Schema.mutable(Schema.Array(Schema.String))).annotate({
    description: "Additional domains to allow for CORS",
  }),
})
  .annotate({ identifier: "ServerConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Server = Schema.Schema.Type<typeof Server>

export * as ConfigServer from "./server"
