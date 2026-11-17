import { Schema } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { PositiveInt, withStatics } from "@opencode-ai/core/schema"

// Single source of truth for MCP defaults, shared with the MCP client and OAuth provider.
export const MCP_DEFAULTS = {
  timeout: 30_000,
  oauth_callback_port: 19876,
} as const

export const Local = Schema.Struct({
  type: Schema.Literal("local").annotate({ description: "Type of MCP server connection" }),
  command: Schema.mutable(Schema.Array(Schema.String)).annotate({
    description: "Command and arguments to run the MCP server",
  }),
  environment: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Environment variables to set when running the MCP server",
  }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: `Timeout in ms for MCP server requests. Defaults to ${MCP_DEFAULTS.timeout} (30 seconds) if not specified.`,
  }),
})
  .annotate({ identifier: "McpLocalConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Local = Schema.Schema.Type<typeof Local>

export const OAuth = Schema.Struct({
  clientId: Schema.optional(Schema.String).annotate({
    description: "OAuth client ID. If not provided, dynamic client registration (RFC 7591) will be attempted.",
  }),
  clientSecret: Schema.optional(Schema.String).annotate({
    description: "OAuth client secret (if required by the authorization server)",
  }),
  scope: Schema.optional(Schema.String).annotate({ description: "OAuth scopes to request during authorization" }),
  redirectUri: Schema.optional(Schema.String).annotate({
    description: `OAuth redirect URI (default: http://127.0.0.1:${MCP_DEFAULTS.oauth_callback_port}/mcp/oauth/callback).`,
  }),
})
  .annotate({ identifier: "McpOAuthConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type OAuth = Schema.Schema.Type<typeof OAuth>

export const Remote = Schema.Struct({
  type: Schema.Literal("remote").annotate({ description: "Type of MCP server connection" }),
  url: Schema.String.annotate({ description: "URL of the remote MCP server" }),
  enabled: Schema.optional(Schema.Boolean).annotate({
    description: "Enable or disable the MCP server on startup",
  }),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)).annotate({
    description: "Headers to send with the request",
  }),
  oauth: Schema.optional(Schema.Union([OAuth, Schema.Literal(false)])).annotate({
    description: "OAuth authentication configuration for the MCP server. Set to false to disable OAuth auto-detection.",
  }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: `Timeout in ms for MCP server requests. Defaults to ${MCP_DEFAULTS.timeout} (30 seconds) if not specified.`,
  }),
})
  .annotate({ identifier: "McpRemoteConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Remote = Schema.Schema.Type<typeof Remote>

export const Info = Schema.Union([Local, Remote])
  .annotate({ discriminator: "type" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export * as ConfigMCP from "./mcp"
