import { Flag } from "@opencode-ai/core/flag/flag"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { Effect, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import { ProxyUtil } from "../proxy-util"

const log = Log.create({ service: "ui" })

// Cache for embedded UI bundle with error recovery
let embeddedUICache: { promise: Promise<Record<string, string> | null>; disabled: boolean } | undefined

export function embeddedUI() {
  if (Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI) return Promise.resolve(null)

  if (!embeddedUICache) {
    const promise =
      // @ts-expect-error - generated file at build time
      import("opencode-web-ui.gen.ts")
        .then((module) => module.default as Record<string, string>)
        .catch((error) => {
          log.warn("embedded UI import failed, falling back to upstream", {
            error: error instanceof Error ? error.message : String(error),
          })
          return null
        })
    embeddedUICache = { promise, disabled: false }
  }

  return embeddedUICache.promise
}

/**
 * Invalidate the embedded UI cache.
 * Useful for development hot-reload scenarios.
 */
export function invalidateEmbeddedUICache() {
  embeddedUICache = undefined
}

// CSP cache to avoid recomputing hashes for static embedded UI
const cspCache = new Map<string, string>()

// In-memory cache for embedded UI file contents (static for server lifetime)
const fileCache = new Map<string, Uint8Array>()

// Vite produces content-hashed filenames: assets/index-abc12345.js
const HASHED_ASSET_REGEX = /-[0-9a-f]{8,}\.[a-z0-9]+$/i

function isHashedAsset(file: string): boolean {
  return HASHED_ASSET_REGEX.test(file)
}

function computeETag(body: Uint8Array): string {
  return `"${createHash("sha256").update(body).digest("base64").slice(0, 27)}"`
}

export const UI_UPSTREAM = new URL("https://app.opencode.ai")

export const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src * data:`
export const DEFAULT_CSP = csp()

export function themePreloadHash(body: string) {
  return body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
}

export function cspForHtml(body: string) {
  // Fast path: cache by content hash for static embedded UI
  const contentHash = createHash("sha256").update(body).digest("hex")
  const cached = cspCache.get(contentHash)
  if (cached) return cached

  const match = themePreloadHash(body)
  const result = csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")

  // Bound cache size to prevent unbounded memory growth
  if (cspCache.size > 256) {
    const firstKey = cspCache.keys().next().value
    if (firstKey) cspCache.delete(firstKey)
  }
  cspCache.set(contentHash, result)
  return result
}

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  const len = request.headers["content-length"]
  return HttpBody.stream(request.stream, request.headers["content-type"], len === undefined ? undefined : Number(len))
}

function proxyResponseHeaders(headers: Record<string, string>) {
  const result = new Headers(headers)
  // FetchHttpClient exposes decoded response bodies, so forwarding upstream
  // transfer metadata makes browsers decode already-decoded assets again.
  result.delete("content-encoding")
  result.delete("content-length")
  result.delete("transfer-encoding")
  return result
}

export function upstreamURL(path: string) {
  return new URL(path, UI_UPSTREAM).toString()
}

function notFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

function embeddedUIResponse(
  file: string,
  body: Uint8Array,
  request?: HttpServerRequest.HttpServerRequest,
) {
  const mime = AppFileSystem.mimeType(file)
  const headers = new Headers({ "content-type": mime })

  const etag = computeETag(body)
  headers.set("etag", etag)

  if (mime.startsWith("text/html")) {
    headers.set("content-security-policy", cspForHtml(new TextDecoder().decode(body)))
    headers.set("cache-control", "no-cache")
  } else if (isHashedAsset(file)) {
    headers.set("cache-control", "public, max-age=31536000, immutable")
  } else {
    headers.set("cache-control", "public, max-age=86400")
  }

  if (request?.headers["if-none-match"] === etag) {
    return HttpServerResponse.empty({ status: 304, headers })
  }

  return HttpServerResponse.raw(body, { headers })
}

export function serveEmbeddedUIEffect(
  requestPath: string,
  fs: AppFileSystem.Interface,
  embeddedWebUI: Record<string, string>,
  request?: HttpServerRequest.HttpServerRequest,
) {
  const file = embeddedWebUI[requestPath.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
  if (!file) return Effect.succeed(notFound())

  const cached = fileCache.get(file)
  if (cached) return Effect.succeed(embeddedUIResponse(file, cached, request))

  return fs.readFile(file).pipe(
    Effect.map((body) => {
      // LRU eviction to prevent unbounded memory growth
      if (fileCache.size > 256) {
        const firstKey = fileCache.keys().next().value
        if (firstKey) fileCache.delete(firstKey)
      }
      fileCache.set(file, body)
      return embeddedUIResponse(file, body, request)
    }),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(notFound())),
    Effect.catch((error) =>
      Effect.sync(() => {
        log.warn("serveEmbeddedUIEffect: failed to read embedded UI file", {
          file,
          path: requestPath,
          error: error instanceof Error ? error.message : String(error),
        })
      }).pipe(Effect.andThen(() => Effect.succeed(notFound()))),
    ),
  )
}

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: { fs: AppFileSystem.Interface; client: HttpClient.HttpClient },
) {
  return Effect.gen(function* () {
    const embeddedWebUI = yield* Effect.promise(() => embeddedUI())
    const path = new URL(request.url, "http://localhost").pathname

    if (embeddedWebUI) return yield* serveEmbeddedUIEffect(path, services.fs, embeddedWebUI, request)

    const response = yield* services.client.execute(
      HttpClientRequest.make(request.method)(upstreamURL(path), {
        headers: ProxyUtil.headers(request.headers, { host: UI_UPSTREAM.host }),
        body: requestBody(request),
      }),
    )
    const headers = proxyResponseHeaders(response.headers)

    if (response.headers["content-type"]?.includes("text/html")) {
      const body = yield* response.text
      headers.set("Content-Security-Policy", cspForHtml(body))
      return HttpServerResponse.text(body, { status: response.status, headers })
    }

    headers.set("Content-Security-Policy", csp())
    return HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
      status: response.status,
      headers,
    })
  })
}
