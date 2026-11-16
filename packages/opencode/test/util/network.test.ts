import { describe, expect, test } from "bun:test"
import { assertSafeRemoteUrl, isLoopbackHostname, isPrivateIP, safeFetchJson } from "@/util/network"

describe("network safety", () => {
  describe("isLoopbackHostname", () => {
    test("detects loopback hostnames", () => {
      expect(isLoopbackHostname("localhost")).toBe(true)
      expect(isLoopbackHostname("127.0.0.1")).toBe(true)
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
  })

  describe("safeFetchJson", () => {
    test("enforces response body size cap", async () => {
      const originalFetch = globalThis.fetch
      try {
        globalThis.fetch = (async () => {
          return new Response(JSON.stringify({ big: "x".repeat(100) }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        }) as any

        await expect(
          safeFetchJson("http://localhost:1234/data", "test", {
            allowLocalhost: true,
            maxBytes: 10,
          }),
        ).rejects.toThrow("exceeds maximum allowed size")
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
})
