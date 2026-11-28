import dns from "node:dns"
import { Effect, Stream } from "effect"


export function online() {
  const nav = globalThis.navigator
  if (!nav || typeof nav.onLine !== "boolean") return true
  return nav.onLine
}

export function proxied() {
  return !!(process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy)
}

function ipv4ToInt(ip: string): number {
  const rawParts = ip.split(".")
  if (rawParts.length !== 4) return -1
  for (const part of rawParts) {
    if (!/^\d+$/.test(part)) return -1
    // Reject leading zeros (octal or ambiguous notation in C/POSIX) to fail closed
    if (part.length > 1 && part.startsWith("0")) return -1
    const n = Number(part)
    if (n < 0 || n > 255) return -1
  }
  const parts = rawParts.map(Number)
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
  if (lower === "::" || /^::0*[01]$/.test(lower)) return true // unspecified + loopback
  // Expanded or zero-padded unspecified (0:0:0:0:0:0:0:0) and loopback (0:0:0:0:0:0:0:1)
  if (/^(?:0{1,4}:){7}0{0,3}[01]$/.test(lower)) return true
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
  return ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)?.[1]
}

export function isPrivateIP(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7)
    if (!v4.includes(":")) return isPrivateIPv4(v4)
    const hex = v4.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hex) {
      const hi = parseInt(hex[1], 16)
      const lo = parseInt(hex[2], 16)
      return isPrivateIPv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`)
    }
  }
  if (lower.includes(":")) {
    const v4 = embeddedIPv4(lower)
    if (v4 && isPrivateIPv4(v4)) return true
    return isPrivateIPv6(lower)
  }
  return isPrivateIPv4(lower)
}

export function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*?)\]$/, "$1")
}

/**
 * True when the host is a literal IP address (IPv4 or IPv6) rather than a DNS
 * name. Only literal IPs may be classified directly by `isPrivateIP`; DNS names
 * must be judged by the addresses they resolve to.
 */
function isLiteralIPHost(host: string): boolean {
  const isIPv4Literal = ipv4ToInt(host) !== -1 && /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
  return host.includes(":") || isIPv4Literal
}

export function isLoopbackHostname(hostname: string): boolean {
  const bare = normalizeHostname(hostname).toLowerCase()
  if (bare === "localhost" || bare.endsWith(".localhost") || bare === "::1") return true
  const num = ipv4ToInt(bare)
  return num >= 0x7f000000 && num <= 0x7fffffff // 127.0.0.0/8
}

export const MAX_REMOTE_CONFIG_BYTES = 2 * 1024 * 1024 // 2MB

export interface SafeUrlOptions {
  allowLocalhost?: boolean
}

export async function assertSafeRemoteUrl(url: string, what: string, options?: SafeUrlOptions): Promise<URL> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`invalid ${what}: ${url}`)
  }

  const loopback = isLoopbackHostname(parsed.hostname)
  if (options?.allowLocalhost && loopback) {
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`${what} must use https:// or http:// for localhost: ${url}`)
    }
    return parsed
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${what} must use https://: ${url}`)
  }

  const bareHost = normalizeHostname(parsed.hostname)

  // Only classify the hostname itself when it is a literal IP — non-IP
  // hostnames (including "localhost") are judged by what DNS resolves them to.
  if (isLiteralIPHost(bareHost) && isPrivateIP(bareHost)) {
    throw new Error(`Refusing to fetch ${what} from private/internal network target (${bareHost}): ${url}`)
  }

  let addresses: dns.LookupAddress[]
  try {
    addresses = await dns.promises.lookup(bareHost, { all: true })
  } catch (error) {
    throw new Error(
      `DNS lookup failed for ${what} host (${parsed.hostname}): ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (addresses.length === 0) {
    throw new Error(`DNS lookup returned no addresses for ${what} host (${parsed.hostname}): ${url}`)
  }

  for (const record of addresses) {
    if (isPrivateIP(record.address)) {
      throw new Error(`Refusing to fetch ${what} from private/internal network target (${record.address}): ${url}`)
    }
  }

  return parsed
}

/**
 * Reads a response body into bytes, cancelling the stream once the cap is
 * crossed. Chunked responses have no content-length, so the header check alone
 * cannot bound memory usage.
 */
export async function readBoundedBytes(
  response: Response,
  maxBytes: number,
  describeOverflow: (size?: number) => string,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length")
  if (contentLength) {
    const declared = parseInt(contentLength, 10)
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(describeOverflow(declared))
    }
  }

  const reader = response.body && typeof response.body.getReader === "function" ? response.body.getReader() : undefined
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error(describeOverflow())
    return bytes
  }

  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error(describeOverflow())
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export async function safeFetchJson<T = unknown>(
  url: string,
  what: string,
  options?: RequestInit & { maxBytes?: number; allowLocalhost?: boolean },
): Promise<T> {
  const response = await guardedFetch(url, what, { allowLocalhost: options?.allowLocalhost, ...options })
  if (!response.ok) {
    throw new Error(`failed to fetch ${what} from ${url}: ${response.status}`)
  }

  const maxBytes = options?.maxBytes ?? MAX_REMOTE_CONFIG_BYTES
  const bytes = await readBoundedBytes(response, maxBytes, (size) =>
    size === undefined
      ? `Response size for ${what} from ${url} exceeds maximum allowed size of ${maxBytes} bytes`
      : `Response size for ${what} from ${url} (${size} bytes) exceeds maximum allowed size of ${maxBytes} bytes`,
  )
  return JSON.parse(new TextDecoder().decode(bytes)) as T
}

const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface FetchTarget {
  /** URL to actually fetch (the validated IP is pinned in for http:// targets). */
  url: URL
  /** Host header to send when the URL is IP-pinned; undefined otherwise. */
  host?: string
}

/**
 * Validates one fetch target and returns what to fetch:
 * - scheme must be http/https (https-only unless `allowHttp`, which also
 *   requires loopback + allowLocalhost semantics to stay strict elsewhere)
 * - literal and DNS-resolved IPs must be public unless the target is loopback
 *   and `allowLocalhost` is set
 * - http:// targets are pinned to the validated IP with the original host
 *   returned for the Host header, defeating DNS rebinding. https:// targets
 *   are NOT pinned: TLS certificate validation checks the URL host, so an
 *   IP-pinned https request fails certificate verification; instead the DNS
 *   validation runs on every hop, narrowing any rebinding window to the one
 *   lookup performed inside fetch().
 */
export async function validateFetchTarget(
  rawUrl: string,
  what: string,
  options?: SafeUrlOptions & { allowHttp?: boolean },
): Promise<FetchTarget> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`invalid ${what}: ${rawUrl}`)
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`${what} must use http:// or https://: ${rawUrl}`)
  }
  const loopback = isLoopbackHostname(parsed.hostname)
  if (parsed.protocol === "http:" && !(options?.allowHttp || (options?.allowLocalhost && loopback))) {
    throw new Error(`${what} must use https://: ${rawUrl}`)
  }

  const bareHost = normalizeHostname(parsed.hostname)
  const allowPrivate = options?.allowLocalhost && loopback

  // Only classify the hostname itself when it is a literal IP — non-IP
  // hostnames (including "localhost") are judged by what DNS resolves them to.
  const isLiteralIP = isLiteralIPHost(bareHost)
  if (isLiteralIP && !allowPrivate && isPrivateIP(bareHost)) {
    throw new Error(`Refusing to fetch ${what} from private/internal network target (${bareHost}): ${rawUrl}`)
  }

  let address: string | undefined
  if (!isLiteralIP) {
    let addresses: dns.LookupAddress[]
    try {
      addresses = await dns.promises.lookup(bareHost, { all: true })
    } catch (error) {
      throw new Error(
        `DNS lookup failed for ${what} host (${parsed.hostname}): ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (addresses.length === 0) {
      throw new Error(`DNS lookup returned no addresses for ${what} host (${parsed.hostname}): ${rawUrl}`)
    }
    for (const record of addresses) {
      if (!allowPrivate && isPrivateIP(record.address)) {
        throw new Error(`Refusing to fetch ${what} from private/internal network target (${record.address}): ${rawUrl}`)
      }
    }
    address = addresses[0]?.address
  } else {
    address = bareHost
  }

  if (parsed.protocol === "http:") {
    const pin = address!.includes(":") ? `[${address!}]` : address!
    const pinned = new URL(parsed.toString())
    pinned.hostname = pin
    return { url: pinned, host: parsed.host }
  }
  return { url: parsed }
}

/**
 * Fetch with SSRF guards: the initial target and every redirect hop are
 * validated (`redirect: "manual"` + bounded loop), and http:// targets are
 * pinned to their validated IP. Use this for any fetch whose URL can be
 * influenced by untrusted input.
 */
export async function guardedFetch(
  url: string,
  what: string,
  options?: RequestInit & SafeUrlOptions & { allowHttp?: boolean; maxRedirects?: number },
): Promise<Response> {
  const maxRedirects = options?.maxRedirects ?? MAX_REDIRECTS
  let target = await validateFetchTarget(url, what, options)
  for (let hop = 0; ; hop++) {
    const response = await fetch(target.url, {
      ...options,
      redirect: "manual",
      headers: { ...options?.headers, ...(target.host ? { Host: target.host } : {}) },
    })
    const location = response.headers.get("location")
    if (!REDIRECT_STATUSES.has(response.status) || !location || hop >= maxRedirects) return response
    const next = new URL(location, target.url)
    target = await validateFetchTarget(next.toString(), what, options)
  }
}

// Effect-HttpClient counterpart of readBoundedBytes: accumulate the response
// stream until the cap, failing as soon as it is crossed. Chunked responses
// have no reliable content-length, so buffering (arrayBuffer/text) first would
// let a hostile proxy stream unbounded data into memory.
export const readBoundedResponseBytes = (
  response: { readonly stream: Stream.Stream<Uint8Array, unknown> },
  maxBytes: number,
  describeOverflow: (size?: number) => string,
) =>
  Effect.gen(function* () {
    const chunks: Uint8Array[] = []
    let total = 0
    yield* response.stream
      .pipe(
        Stream.mapEffect((chunk: Uint8Array) =>
          Effect.suspend(() => {
            total += chunk.byteLength
            if (total > maxBytes) return Effect.fail(new Error(describeOverflow(total)))
            chunks.push(chunk)
            return Effect.void
          }),
        ),
        Stream.runDrain,
      )
      .pipe(
        Effect.mapError((error) => new Error(error instanceof Error ? error.message : String(error))),
      )
    const out = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      out.set(chunk, offset)
      offset += chunk.byteLength
    }
    return out
  })
