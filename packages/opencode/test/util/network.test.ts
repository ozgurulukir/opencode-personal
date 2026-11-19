import { describe, expect, test } from "bun:test"
import dns from "node:dns"
import { assertSafeRemoteUrl, guardedFetch, isLoopbackHostname, isPrivateIP, safeFetchJson } from "@/util/network"

describe("network safety", () => {
  describe("isLoopbackHostname", () => {
    test("detects loopback hostnames", () => {
      expect(isLoopbackHostname("localhost")).toBe(true)
      expect(isLoopbackHostname("127.0.0.1")).toBe(true)
      expect(isLoopbackHostname("127.0.0.2")).toBe(true)
      expect(isLoopbackHostname("dev.localhost")).toBe(true)
      expect(isLoopbackHostname("::1")).toBe(true)
      expect(isLoopbackHostname("[::1]")).toBe(true)
      expect(isLoopbackHostname("LOCALHOST")).toBe(true)
    })

    test("non-loopback hostnames return false", () => {
      expect(isLoopbackHostname("example.com")).toBe(false)
      expect(isLoopbackHostname("192.168.1.1")).toBe(false)
      expect(isLoopbackHostname("10.0.0.1")).toBe(false)
    })
  })

  describe("assertSafeRemoteUrl", () => {
    test("rejects invalid URLs", async () => {
      await expect(assertSafeRemoteUrl("not-a-url", "test")).rejects.toThrow("invalid test")
    })

    test("rejects non-https URLs when localhost is not allowed", async () => {
      await expect(assertSafeRemoteUrl("http://example.com", "test")).rejects.toThrow("must use https://")
      await expect(assertSafeRemoteUrl("http://localhost", "test")).rejects.toThrow("must use https://")
    })

    test("allows localhost with http when allowLocalhost is true", async () => {
      const url = await assertSafeRemoteUrl("http://localhost:3000/config", "test", { allowLocalhost: true })
      expect(url.hostname).toBe("localhost")

      const urlIp = await assertSafeRemoteUrl("http://127.0.0.1:8080/config", "test", { allowLocalhost: true })
      expect(urlIp.hostname).toBe("127.0.0.1")
    })

    test("rejects private IPv4 addresses even with https", async () => {
      await expect(assertSafeRemoteUrl("https://10.0.0.1/config", "test")).rejects.toThrow("private/internal network target")
      await expect(assertSafeRemoteUrl("https://192.168.1.1/config", "test")).rejects.toThrow("private/internal network target")
      await expect(assertSafeRemoteUrl("https://172.16.0.1/config", "test")).rejects.toThrow("private/internal network target")
      await expect(assertSafeRemoteUrl("https://169.254.169.254/latest", "test")).rejects.toThrow("private/internal network target")
    })

    test("rejects loopback when allowLocalhost is false", async () => {
      await expect(assertSafeRemoteUrl("https://127.0.0.1/config", "test")).rejects.toThrow("private/internal network target")
      await expect(assertSafeRemoteUrl("https://localhost/config", "test")).rejects.toThrow("private/internal network target")
    })

    test("fails closed on ambiguous octal or malformed IPv4", () => {
      expect(isPrivateIP("0177.0.0.1")).toBe(true)
      expect(isPrivateIP("127.0..1")).toBe(true)
      expect(isPrivateIP("010.0.0.1")).toBe(true)
    })

    test("resolves non-IP hostnames via DNS instead of treating them as IPs", async () => {
      const originalLookup = dns.promises.lookup
      dns.promises.lookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as typeof dns.promises.lookup
      try {
        const url = await assertSafeRemoteUrl("https://example.com/config", "test")
        expect(url.hostname).toBe("example.com")
      } finally {
        dns.promises.lookup = originalLookup
      }
    })

    test("rejects hostnames that resolve to private IPs", async () => {
      const originalLookup = dns.promises.lookup
      dns.promises.lookup = (async () => [{ address: "10.0.0.5", family: 4 }]) as unknown as typeof dns.promises.lookup
      try {
        await expect(assertSafeRemoteUrl("https://example.com/config", "test")).rejects.toThrow(
          "private/internal network target",
        )
      } finally {
        dns.promises.lookup = originalLookup
      }
    })
  })

  describe("safeFetchJson", () => {
    test("enforces response body size cap on streaming responses without content-length", async () => {
      const originalFetch = globalThis.fetch
      let streamCancelled = false
      try {
        globalThis.fetch = (async () => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"chunks": "'))
              controller.enqueue(new TextEncoder().encode("x".repeat(200)))
              controller.enqueue(new TextEncoder().encode('"}'))
              controller.close()
            },
            cancel() {
              streamCancelled = true
            },
          })
          return new Response(stream, {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        }) as any

        await expect(
          safeFetchJson("http://localhost:1234/data", "test", {
            allowLocalhost: true,
            maxBytes: 50,
          }),
        ).rejects.toThrow("exceeds maximum allowed size")
        expect(streamCancelled).toBe(true)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test("parses JSON within size limit", async () => {
      const originalFetch = globalThis.fetch
      try {
        globalThis.fetch = (async () => {
          return new Response(JSON.stringify({ ok: true, version: 1 }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        }) as any

        const result = await safeFetchJson<{ ok: boolean; version: number }>("http://localhost:1234/data", "test", {
          allowLocalhost: true,
          maxBytes: 1000,
        })
        expect(result).toEqual({ ok: true, version: 1 })
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe("guardedFetch", () => {
    test("rejects a redirect to a private IP target", async () => {
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url)
          if (url.pathname === "/redirect") {
            return new Response(null, { status: 302, headers: { location: "https://10.0.0.1/secret" } })
          }
          return new Response("ok")
        },
      })
      try {
        await expect(
          guardedFetch(`http://localhost:${server.port}/redirect`, "test", { allowLocalhost: true }),
        ).rejects.toThrow("private/internal network target")
      } finally {
        server.stop(true)
      }
    })

    test("pins http targets to the resolved IP and keeps the original Host header", async () => {
      let seenHost: string | undefined
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          seenHost = req.headers.get("host") ?? undefined
          return new Response("ok")
        },
      })
      try {
        const response = await guardedFetch(`http://localhost:${server.port}/pin`, "test", { allowLocalhost: true })
        expect(response.status).toBe(200)
        expect(seenHost).toBe(`localhost:${server.port}`)
      } finally {
        server.stop(true)
      }
    })

    test("follows a bounded redirect chain that stays valid", async () => {
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          const url = new URL(req.url)
          if (url.pathname === "/hop1") {
            return new Response(null, { status: 302, headers: { location: "/hop2" } })
          }
          return new Response("landed")
        },
      })
      try {
        const response = await guardedFetch(`http://localhost:${server.port}/hop1`, "test", { allowLocalhost: true })
        expect(await response.text()).toBe("landed")
      } finally {
        server.stop(true)
      }
    })

    test("returns the last 3xx response once the redirect budget is exhausted", async () => {
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response(null, { status: 302, headers: { location: "/loop" } })
        },
      })
      try {
        const response = await guardedFetch(`http://localhost:${server.port}/loop`, "test", {
          allowLocalhost: true,
          maxRedirects: 2,
        })
        expect(response.status).toBe(302)
      } finally {
        server.stop(true)
      }
    })

    test("rejects plain http for non-loopback targets without allowHttp", async () => {
      await expect(guardedFetch("http://example.com/x", "test")).rejects.toThrow("must use https://")
    })
  })
})
