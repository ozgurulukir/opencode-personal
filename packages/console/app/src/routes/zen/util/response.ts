import type { ZenData } from "@opencode-ai/console-core/model.js"
import { calculateCost, calculateOccurredCost, type CostInfo } from "./cost"
import { buildCostChunk, createResponseConverter, type UsageInfo } from "./provider/provider"
import type { BillingSource } from "./billing"
import type { AuthInfo } from "./auth"

export type ResponseDeps = {
    providerInfo: {
    id: string
    model: string
    displayName?: string
    format: ZenData.Format
    normalizeUsage: (usage: any) => UsageInfo
    createUsageParser: () => { parse: (chunk: string) => void; retrieve: () => any }
    createBinaryStreamDecoder: () => ((chunk: Uint8Array) => Uint8Array | undefined) | undefined
    streamSeparator: string
  }
  modelInfo: {
    id: string
    cost: {
      input: number
      output: number
      cacheRead?: number
      cacheWrite5m?: number
      cacheWrite1h?: number
    }
    cost200K?: {
      input: number
      output: number
      cacheRead?: number
      cacheWrite5m?: number
      cacheWrite1h?: number
    }
  }
  billingSource: BillingSource
  authInfo: AuthInfo | undefined
  sessionId: string
  format: ZenData.Format
  rateLimiter: { track: () => Promise<void> } | undefined
  trialLimiter: { track: (usage: UsageInfo) => Promise<void> } | undefined
  modelTpmLimiter: {
    track: (providerId: string, providerModel: string, usage: UsageInfo) => Promise<void>
  } | undefined
  dataDumper: {
    provideStream?: (buffer: string) => void
    provideResponse?: (body: string) => void
    flush: () => void
  } | undefined
  Database: { use: (fn: (tx: any) => Promise<any>) => Promise<any> }
  logger: {
    metric: (values: Record<string, any>) => void
    debug: (message: string) => void
  }
  trackUsage: (
    sessionId: string,
    billingSource: string,
    authInfo: AuthInfo | undefined,
    modelInfo: { id: string },
    providerInfo: { id: string },
    usageInfo: UsageInfo,
    costInfo: CostInfo,
    Database: { use: (fn: (tx: any) => Promise<any>) => Promise<any> },
    logger: { metric: (obj: Record<string, unknown>) => void },
  ) => Promise<{ costInMicroCents: number } | undefined>
  reload: (
    billingSource: string,
    authInfo: AuthInfo | undefined,
    costInfo: { totalCostInCent: number },
    Database: { use: (fn: (tx: any) => Promise<any>) => Promise<any> },
  ) => Promise<void>
}

export function prepareResponseMetadata(res: Response): { status: number; headers: Headers } {
  const status = res.status === 404 ? 400 : res.status
  const headers = new Headers()
  const keepHeaders = ["content-type", "cache-control"]
  for (const [k, v] of res.headers.entries()) {
    if (keepHeaders.includes(k.toLowerCase())) headers.set(k, v)
  }
  return { status, headers }
}

export async function handleNonStreamingResponse(res: Response, deps: ResponseDeps): Promise<Response> {
  const { status, headers } = prepareResponseMetadata(res)
  deps.logger.debug("STATUS: " + res.status + " " + res.statusText)
  const json = await res.json()
  await deps.rateLimiter?.track()

  let costInfo: CostInfo | undefined
  if (json.usage) {
    const usageInfo = deps.providerInfo.normalizeUsage(json.usage)
    costInfo = calculateCost(deps.modelInfo, usageInfo)
    await deps.trialLimiter?.track(usageInfo)
    await deps.modelTpmLimiter?.track(deps.providerInfo.id, deps.providerInfo.model, usageInfo)
    await deps.trackUsage(
      deps.sessionId,
      deps.billingSource,
      deps.authInfo,
      deps.modelInfo,
      deps.providerInfo,
      usageInfo,
      costInfo,
      deps.Database,
      deps.logger,
    )
    await deps.reload(deps.billingSource, deps.authInfo, costInfo, deps.Database)
  }

  if (res.status === 400) {
    deps.logger.metric({ "error.response": JSON.stringify(json) })
  }

  const responseConverter = createResponseConverter(deps.providerInfo.format, deps.format)
  const converted = responseConverter(json)

  if (converted.error?.message) {
    converted.error.message = `Error from provider${deps.providerInfo.displayName ? ` (${deps.providerInfo.displayName})` : ""}: ${converted.error.message}`
  }

  if (costInfo) {
    converted.cost = calculateOccurredCost(deps.billingSource, costInfo)
  }

  const body = JSON.stringify(converted)
  deps.logger.metric({ response_length: body.length })
  deps.logger.debug("RESPONSE: " + body)
  deps.dataDumper?.provideResponse?.(body)
  deps.dataDumper?.flush()

  return new Response(body, {
    status,
    statusText: res.statusText,
    headers,
  })
}

export function createStreamingResponse(
  res: Response,
  startTimestamp: number,
  streamConverter: (part: any) => any,
  deps: ResponseDeps,
): Response {
  const { status, headers } = prepareResponseMetadata(res)
  const providerInfo = deps.providerInfo
  const usageParser = providerInfo.createUsageParser()
  const binaryDecoder = providerInfo.createBinaryStreamDecoder()

  const stream = new ReadableStream({
    start(c) {
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ""
      let responseLength = 0

      function pump(): Promise<void> {
        return (
          reader?.read().then(async ({ done, value: rawValue }) => {
            if (done) {
              deps.logger.metric({
                response_length: responseLength,
                "timestamp.last_byte": Date.now(),
              })
              deps.dataDumper?.flush()
              await deps.rateLimiter?.track()
              const usage = usageParser.retrieve()
              if (usage) {
                const usageInfo = providerInfo.normalizeUsage(usage)
                const costInfo = calculateCost(deps.modelInfo, usageInfo)
                await deps.trialLimiter?.track(usageInfo)
                await deps.modelTpmLimiter?.track(providerInfo.id, deps.modelInfo.id, usageInfo)
                await deps.trackUsage(
                  deps.sessionId,
                  deps.billingSource,
                  deps.authInfo,
                  deps.modelInfo,
                  providerInfo,
                  usageInfo,
                  costInfo,
                  deps.Database,
                  deps.logger,
                )
                await deps.reload(deps.billingSource, deps.authInfo, costInfo, deps.Database)
                const cost = calculateOccurredCost(deps.billingSource, costInfo)
                c.enqueue(encoder.encode(buildCostChunk(deps.format, cost)))
              }
              c.close()
              return
            }

            if (responseLength === 0) {
              const now = Date.now()
              deps.logger.metric({
                time_to_first_byte: now - startTimestamp,
                "timestamp.first_byte": now,
              })
            }

            const value = binaryDecoder ? binaryDecoder(rawValue) : rawValue
            if (!value) return

            responseLength += value.length
            buffer += decoder.decode(value, { stream: true })
            deps.dataDumper?.provideStream?.(buffer)

            const parts = buffer.split(providerInfo.streamSeparator)
            buffer = parts.pop() ?? ""

            for (let part of parts) {
              deps.logger.debug("PART: " + part)
              part = part.trim()
              usageParser.parse(part)

              if (providerInfo.format !== deps.format) {
                part = streamConverter(part)
                c.enqueue(encoder.encode(part + "\n\n"))
              }
            }

            if (providerInfo.format === deps.format) {
              c.enqueue(value)
            }

            return pump()
          }) || Promise.resolve()
        )
      }

      return pump()
    },
  })

  return new Response(stream, {
    status,
    statusText: res.statusText,
    headers,
  })
}
