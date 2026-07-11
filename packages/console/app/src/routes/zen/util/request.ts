import type { APIEvent } from "@solidjs/start/server"
import { logger } from "./logger"

export type RequestInfo = {
  url: string
  body: unknown
  model: string
  variant: string | undefined
  isStream: boolean
  ip: string
  zenApiKey: string | undefined
  sessionId: string
  requestId: string
  projectId: string
  ocClient: string
  userAgent: string
}

export async function parseRequest(
  input: APIEvent,
  opts: {
    parseApiKey: (headers: Headers) => string | undefined
    parseModel: (url: string, body: unknown) => string
    parseVariant: (url: string, body: unknown) => string | undefined
    parseIsStream: (url: string, body: unknown) => boolean
  },
): Promise<RequestInfo> {
  const url = input.request.url
  const body = await input.request.json()
  const model = opts.parseModel(url, body)
  const variant = opts.parseVariant(url, body)
  const isStream = opts.parseIsStream(url, body)
  const rawIp = input.request.headers.get("x-real-ip") ?? ""
  const ip = rawIp.includes(":") ? rawIp.split(":").slice(0, 4).join(":") : rawIp
  const rawZenApiKey = opts.parseApiKey(input.request.headers)
  const zenApiKey = rawZenApiKey === "public" ? undefined : rawZenApiKey
  const sessionId = input.request.headers.get("x-opencode-session") ?? ""
  const requestId = input.request.headers.get("x-opencode-request") ?? ""
  const projectId = input.request.headers.get("x-opencode-project") ?? ""
  const ocClient = input.request.headers.get("x-opencode-client") ?? ""
  const userAgent = input.request.headers.get("user-agent") ?? ""

  logger.metric({
    is_stream: isStream,
    session: sessionId,
    request: requestId,
    client: ocClient,
    user_agent: userAgent,
    "model.variant": variant,
  })

  return {
    url,
    body,
    model,
    variant,
    isStream,
    ip,
    zenApiKey,
    sessionId,
    requestId,
    projectId,
    ocClient,
    userAgent,
  }
}
