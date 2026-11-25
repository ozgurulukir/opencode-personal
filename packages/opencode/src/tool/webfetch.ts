import { Effect, Option, Schema } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"
import { guardedFetch, readBoundedBytes } from "@/util/network"
import { Config, WEBFETCH_DEFAULTS } from "@/config/config"

// Domain defaults (5MB / 30s / 120s) live in WEBFETCH_DEFAULTS so the documented and applied
// limits share one definition. They bound remote content for model context and time-box slow
// servers; operators can override each via the `webfetch` config section.
export function resolveLimits(config?: Config.Info["webfetch"]) {
  return {
    maxResponseBytes: config?.max_response_bytes ?? WEBFETCH_DEFAULTS.max_response_bytes,
    defaultTimeout: config?.default_timeout ?? WEBFETCH_DEFAULTS.default_timeout,
    maxTimeout: config?.max_timeout ?? WEBFETCH_DEFAULTS.max_timeout,
  }
}

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("markdown" as const)))
    .annotate({
      description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
    }),
  timeout: Schema.optional(PositiveInt).annotate({
    description: "Optional positive timeout in seconds. Values above the configured maximum (default: 120) are capped.",
  }),
})

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: {
              url: params.url,
              format: params.format,
              timeout: params.timeout,
            },
          })

          const configSvc = yield* Effect.serviceOption(Config.Service)
          const webfetchConfig = Option.isSome(configSvc)
            ? yield* configSvc.value.get().pipe(Effect.catch(() => Effect.succeed(undefined)))
            : undefined
          const { maxResponseBytes, defaultTimeout, maxTimeout } = resolveLimits(webfetchConfig?.webfetch)
          const timeout = Math.min((params.timeout ?? defaultTimeout / 1000) * 1000, maxTimeout)

          // Build Accept header based on requested format with q parameters for fallbacks
          let acceptHeader = "*/*"
          switch (params.format) {
            case "markdown":
              acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
              break
            case "text":
              acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
              break
            case "html":
              acceptHeader =
                "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
              break
            default:
              acceptHeader =
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
          }

          // SSRF-hardened fetch: validateFetchTarget resolves + checks DNS on
          // every hop and pins http:// targets to their validated IP. https://
          // is not pinned (TLS cert validation checks the URL host, so an
          // IP-pinned https request fails certificate verification) — the
          // per-hop DNS + private-IP validation inside guardedFetch narrows
          // any rebinding window instead. Redirects are followed manually
          // with re-validation, so a public URL cannot 302 into the internal
          // network.
          const fetchHeaders = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          }
          const guarded = (extraHeaders?: Record<string, string>) =>
            Effect.tryPromise({
              try: (signal) =>
                guardedFetch(params.url, "webfetch", {
                  allowHttp: true,
                  headers: { ...fetchHeaders, ...extraHeaders },
                  signal,
                }),
              catch: (error) => new Error(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`),
            })
          const first = yield* guarded().pipe(
            Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }),
          )
          // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
          const retry = first.status === 403 && first.headers.get("cf-mitigated") === "challenge"
          if (retry) {
            // The first response body is never consumed on the retry path. Cancel
            // it so the connection is released instead of left hanging open.
            void first.body?.cancel().catch(() => {})
          }
          const response = retry
            ? yield* guarded({ "User-Agent": "opencode" }).pipe(
                Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }),
              )
            : first

          // Enforce the byte cap while streaming. arrayBuffer() would buffer the
          // entire body first, which is unbounded for chunked responses that
          // omit content-length.
          const bytes = yield* Effect.promise(() =>
            readBoundedBytes(
              response,
              maxResponseBytes,
              () => `Response too large (exceeds ${maxResponseBytes} byte limit)`,
            ),
          )

          const contentType = response.headers.get("content-type") || ""
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
          const title = `${params.url} (${contentType})`

          if (isImageAttachment(mime)) {
            const base64Content = Buffer.from(bytes).toString("base64")
            return {
              title,
              output: "Image fetched successfully",
              metadata: {},
              attachments: [
                {
                  type: "file" as const,
                  mime,
                  url: `data:${mime};base64,${base64Content}`,
                },
              ],
            }
          }

          const content = decodeBody(bytes, contentType)

          // Handle content based on requested format and actual content type
          switch (params.format) {
            case "markdown":
              if (contentType.includes("text/html")) {
                const markdown = convertHTMLToMarkdown(content)
                return {
                  output: markdown,
                  title,
                  metadata: {},
                }
              }
              return { output: content, title, metadata: {} }

            case "text":
              if (contentType.includes("text/html")) {
                const text = yield* Effect.promise(() => extractTextFromHTML(content))
                return { output: text, title, metadata: {} }
              }
              return { output: content, title, metadata: {} }

            case "html":
              return { output: content, title, metadata: {} }

            default:
              return { output: content, title, metadata: {} }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

async function extractTextFromHTML(html: string) {
  let text = ""
  let skipContent = false

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() {
        skipContent = true
      },
      text() {
        // Skip text content inside these elements
      },
    })
    .on("*", {
      element(element) {
        // Reset skip flag when entering other elements
        if (!["script", "style", "noscript", "iframe", "object", "embed"].includes(element.tagName)) {
          skipContent = false
        }
      },
      text(input) {
        if (!skipContent) {
          text += input.text
        }
      },
    })
    .transform(new Response(html))

  await rewriter.text()
  return text.trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const match = /charset=([^\s;]+)/i.exec(contentType)
  const label = match?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "utf-8"
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    // Unknown/unsupported charset label — fall back to UTF-8.
    return new TextDecoder("utf-8").decode(bytes)
  }
}
