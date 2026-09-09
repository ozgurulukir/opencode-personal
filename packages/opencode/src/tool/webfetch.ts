import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"
import dns from "dns"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

function ipv4ToInt(ip: string): number {
  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return -1
  return parts[0] * 16777216 + parts[1] * 65536 + parts[2] * 256 + parts[3]
}

export function isPrivateIPv4(ip: string): boolean {
  // Returns true for any non-global-public IPv4 range so the SSRF guard fails
  // closed on malformed input (ipv4ToInt returns -1) as well as private/reserved ranges.
  const num = ipv4ToInt(ip)
  if (num === -1) return true
  return (
    (num >= 0x00000000 && num <= 0x00ffffff) || // 0.0.0.0/8 "this network"
    (num >= 0x0a000000 && num <= 0x0affffff) || // 10.0.0.0/8
    (num >= 0x64400000 && num <= 0x647fffff) || // 100.64.0.0/10 CGNAT
    (num >= 0x7f000000 && num <= 0x7fffffff) || // 127.0.0.0/8 loopback
    (num >= 0xa9fe0000 && num <= 0xa9feffff) || // 169.254.0.0/16 link-local (incl. 169.254.169.254 IMDS)
    (num >= 0xac100000 && num <= 0xac1fffff) || // 172.16.0.0/12
    (num >= 0xc0000000 && num <= 0xc00000ff) || // 192.0.0.0/24 IETF protocol assignments
    (num >= 0xc0000200 && num <= 0xc00002ff) || // 192.0.2.0/24 TEST-NET-1
    (num >= 0xc0586300 && num <= 0xc05863ff) || // 192.88.99.0/24 deprecated 6to4 relay anycast
    (num >= 0xc0a80000 && num <= 0xc0a8ffff) || // 192.168.0.0/16
    (num >= 0xc6120000 && num <= 0xc613ffff) || // 198.18.0.0/15 benchmarking
    (num >= 0xc6336400 && num <= 0xc63364ff) || // 198.51.100.0/24 TEST-NET-2
    (num >= 0xcb007100 && num <= 0xcb0071ff) || // 203.0.113.0/24 TEST-NET-3
    (num >= 0xe0000000 && num <= 0xefffffff) || // 224.0.0.0/4 multicast
    (num >= 0xf0000000 && num <= 0xffffffff) // 240.0.0.0/4 reserved
  )
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === "::" || lower === "::1") return true // unspecified + loopback
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb"))
    return true // fe80::/10 link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true // fc00::/7 unique local
  if (lower.startsWith("ff")) return true // ff00::/8 multicast
  if (lower.startsWith("::ffff:0:")) return true // ::ffff:0:0/96 (IPv4-mapped with leading zero)
  if (lower.startsWith("100::")) return true // 100::/64 discard-only
  if (lower.startsWith("2001:db8:")) return true // 2001:db8::/32 documentation
  if (lower.startsWith("64:ff9b::")) return true // 64:ff9b::/96 NAT64 well-known prefix
  if (lower.startsWith("2001::")) return true // 2001::/32 Teredo
  if (lower.startsWith("2002:")) return true // 2002::/16 6to4 (embeds IPv4)
  if (lower.startsWith("2001:10:") || lower.startsWith("2001:20:")) return true // ORCHID prefixes
  return false
}

function embeddedIPv4(ip: string): string | undefined {
  // IPv4-compatible/mapped forms embed a dotted-quad in the last 32 bits,
  // e.g. ::ffff:a.b.c.d, 64:ff9b::a.b.c.d, 2002::a.b.c.d, ::a.b.c.d.
  return ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)?.[1]
}

export function isPrivateIP(ip: string): boolean {
  if (ip.startsWith("::ffff:")) {
    const v4 = ip.slice(7)
    if (!v4.includes(":")) return isPrivateIPv4(v4)
  }
  if (ip.includes(":")) {
    const v4 = embeddedIPv4(ip)
    if (v4 && isPrivateIPv4(v4)) return true
    return isPrivateIPv6(ip)
  }
  return isPrivateIPv4(ip)
}

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("markdown" as const)))
    .annotate({
      description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
    }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const httpOk = HttpClient.filterStatusOk(http)

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          const { hostname } = new URL(params.url)
          const resolvedAddress = yield* Effect.tryPromise({
            try: () => dns.promises.lookup(hostname.replace(/^\[(.*?)\]$/, "$1"), { all: false }),
            catch: (error) => new Error(`DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`),
          })

          if (isPrivateIP(resolvedAddress.address)) {
            throw new Error("SSRF guard: requests to private/internal IPs are not allowed")
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

          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)

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
          const headers = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          }

          const originalUrl = new URL(params.url)
          // Pin the resolved IP into the request URL to defeat DNS rebinding: the
          // HTTP client would otherwise re-resolve the hostname independently and
          // could be directed at a different (private) IP on the second lookup.
          // The WHATWG URL hostname setter IGNORES unbracketed IPv6 (assignment is
          // a silent no-op), so IPv6 literals must be wrapped in brackets.
          const pin = resolvedAddress.address.includes(":") ? `[${resolvedAddress.address}]` : resolvedAddress.address
          const pinnedUrl = new URL(params.url)
          pinnedUrl.hostname = pin
          const pinnedHeaders = {
            ...headers,
            // Preserve virtual hosting: original hostname AND port (`.host`, not
            // `.hostname`, so non-default ports survive).
            Host: originalUrl.host,
          }
          const request = HttpClientRequest.get(pinnedUrl.toString()).pipe(HttpClientRequest.setHeaders(pinnedHeaders))

          // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
          const response = yield* httpOk.execute(request).pipe(
            Effect.catchIf(
              (err) =>
                err.reason._tag === "StatusCodeError" &&
                err.reason.response.status === 403 &&
                err.reason.response.headers["cf-mitigated"] === "challenge",
              () =>
                httpOk.execute(
                  HttpClientRequest.get(pinnedUrl.toString()).pipe(
                    HttpClientRequest.setHeaders({ ...pinnedHeaders, "User-Agent": "opencode" }),
                  ),
                ),
            ),
            Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error("Request timed out")) }),
          )

          // Check content length
          const contentLength = response.headers["content-length"]
          if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const arrayBuffer = yield* response.arrayBuffer
          if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const contentType = response.headers["content-type"] || ""
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
          const title = `${params.url} (${contentType})`

          if (isImageAttachment(mime)) {
            const base64Content = Buffer.from(arrayBuffer).toString("base64")
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

          const content = decodeBody(new Uint8Array(arrayBuffer), contentType)

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
