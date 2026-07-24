# Server Implementation Guide

## Server Shutdown Patterns

- `Effect.runPromiseExit()` returns a `Promise<Exit>`, NOT an Effect — do NOT use `.pipe()` on the result
- For shutdown logic, use async/await with `.catch()` on the Promise, then wrap cleanup Effects separately
- Atomic `stopPromise` assignment prevents race conditions on concurrent shutdown calls
- Pattern:

```ts
const forceStop = async () => {
  await Effect.runPromiseExit(effect).catch(() => undefined)
}

stop: (close?: boolean) => {
  if (stopPromise) return stopPromise
  stopPromise = (async () => {
    if (close) await forceStop()
    await Effect.runPromiseExit(cleanupEffect).catch(() => undefined)
  })()
  return stopPromise
}
```

## Embedded UI Module

- `opencode-web-ui.gen.ts` is build-time generated — always use `@ts-expect-error` comment before import
- Cache the import Promise to prevent repeated module resolution
- Add error recovery: failed import should fallback to `null` (upstream proxy mode)
- Export `invalidateEmbeddedUICache()` for development hot-reload scenarios

## Embedded UI Caching Strategy

The embedded UI has **zero browser caching by default** — every page load re-downloads the entire JS/CSS bundle. Vite's production build produces content-hashed filenames (`assets/index-abc12345.js`), so aggressive caching is safe.

Apply these `Cache-Control` headers in `embeddedUIResponse()`:

- **Hashed assets** (matches `-[0-9a-f]{8,}\.[a-z0-9]+$`): `public, max-age=31536000, immutable`
- **`index.html`**: `no-cache` (must always validate — it references hashed bundles)
- **Other static files** (favicon, manifest, etc.): `public, max-age=86400`

Also add an **in-memory file content cache** (`Map<string, Uint8Array>`) with LRU eviction (256 entries) to avoid `fs.readFile` on every request. The embedded UI files are static for the server lifetime, so the cache never needs invalidation. This is separate from the `embeddedUICache` Promise cache (which caches the file-name map, not file contents).

Add **ETag support** for conditional requests: compute `SHA256(body).base64.slice(0, 27)` as the ETag value. Check `If-None-Match` header and return `HttpServerResponse.empty({ status: 304 })` on match. The `embeddedUIResponse()` function must accept an optional `HttpServerRequest` parameter to read request headers.

```ts
const HASHED_ASSET_REGEX = /-[0-9a-f]{8,}\.[a-z0-9]+$/i

function computeETag(body: Uint8Array): string {
  return `"${createHash("sha256").update(body).digest("base64").slice(0, 27)}"`
}

function embeddedUIResponse(file: string, body: Uint8Array, request?: HttpServerRequest.HttpServerRequest) {
  const headers = new Headers({ "content-type": AppFileSystem.mimeType(file) })
  const etag = computeETag(body)
  headers.set("etag", etag)
  if (mime.startsWith("text/html")) {
    headers.set("cache-control", "no-cache")
  } else if (HASHED_ASSET_REGEX.test(file)) {
    headers.set("cache-control", "public, max-age=31536000, immutable")
  } else {
    headers.set("cache-control", "public, max-age=86400")
  }
  if (request?.headers["if-none-match"] === etag) {
    return HttpServerResponse.empty({ status: 304, headers })
  }
  return HttpServerResponse.raw(body, { headers })
}
```

## CSP Hash Caching

- Use LRU cache (256 entry limit) for CSP hash calculations
- Cache key: SHA256 of HTML body content
- Static embedded UI benefits most (single calculation per unique body)
- Pattern:

```ts
const cspCache = new Map<string, string>()
const contentHash = createHash("sha256").update(body).digest("hex")
const cached = cspCache.get(contentHash)
if (cached) return cached
// ... compute ...
if (cspCache.size > 256) cspCache.delete(cspCache.keys().next().value)
cspCache.set(contentHash, result)
```

## Proxy Header Security

Block these headers when proxying upstream responses (prevent info disclosure + spoofing):

```ts
const securitySensitive = new Set([
  "set-cookie",        // upstream cookie leak
  "x-forwarded-for",   // IP spoofing
  "x-forwarded-host",  // host spoofing
  "x-forwarded-proto", // protocol spoofing
  "forwarded",
  "x-real-ip",
])
```

## Network Interface Detection

Filter virtual interfaces when showing network IPs:

```ts
const virtualPatterns = [
  /^docker\d+$/i, /^br-[0-9a-f]+$/i, /^veth/i,
  /^virbr\d+$/i, /^vboxnet/i, /^tun/i, /^tap/i, /^wsl/i
]
```

- Skip link-local (`169.254.x.x`) and Docker range (`172.x.x.x`)
- Sort results: prefer RFC1918 private ranges (`192.168.x.x`, `10.x.x.x`)

## mDNS Retry Logic

- Use `setTimeout` for retry delays (acceptable in `publish()` which is called from async `listen()`)
- Exponential backoff: `BASE_DELAY_MS * Math.pow(2, MAX_RETRIES - retriesLeft)`
- 3 retries max, then give up permanently (same as single-shot failure)

## `bonjour-service` type import

`bonjour-service` uses `export = Bonjour` (CommonJS). With `esModuleInterop`, `import { Bonjour } from "bonjour-service"` imports the class constructor as a value, but it cannot be used as a type. Use `InstanceType<typeof Bonjour>` instead of `Bonjour` for type annotations.

## WebSocket Tracker

- Use `Effect.sync` for simple state mutations (no yield needed)
- Limit `Effect.all` concurrency to prevent resource exhaustion during shutdown
- Pattern: `{ concurrency: 20, discard: true }` instead of `concurrency: "unbounded"`
