import { afterAll, beforeEach, afterEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { resolveLimits, WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"
import { TestConfig } from "../fixture/config"

const projectRoot = path.join(import.meta.dir, "../..")

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

void mock.module("dns", () => {
  const dns = require("dns")
  const originalLookup = dns.promises.lookup.bind(dns.promises)
  dns.promises.lookup = async (hostname: string, options?: { all?: boolean }) => {
    if (hostname.toLowerCase() === "localhost") {
      // guardedFetch resolves with { all: true }, which expects an address array.
      if (options?.all) return [{ address: "8.8.8.8", family: 4 }]
      return { address: "8.8.8.8", family: 4 }
    }
    return originalLookup(hostname)
  }
  return dns
})

afterAll(() => {
  mock.restore()
})

const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

beforeEach(() => {
  const originalFetch = globalThis.fetch
  ;(globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.includes("/image.png")) {
      return new Response(imageBytes, { status: 200, headers: { "content-type": "IMAGE/PNG" } })
    }
    if (url.includes("/image.svg")) {
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>', {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      })
    }
    return new Response("hello from webfetch", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })
  }
})

afterEach(() => {
  ;(globalThis as any).fetch = undefined
})

const mockHttpClient = HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
  Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      new Response("hello from webfetch", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    ),
  ),
)

const mockHttpClientLayer = Layer.succeed(HttpClient.HttpClient, mockHttpClient)

async function exec(args: { url: string; format: "text" | "markdown" | "html" }) {
  const { WebFetchTool } = await import("../../src/tool/webfetch")
  return WebFetchTool.pipe(
    Effect.flatMap((info) => info.init()),
    Effect.flatMap((tool) => tool.execute(args, ctx)),
    Effect.provideService(HttpClient.HttpClient, mockHttpClient),
    Effect.provide(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer)),
    Effect.runPromise,
  )
}

describe("webfetch limits", () => {
  test("uses domain defaults when config is unset", () => {
    expect(resolveLimits()).toEqual({
      maxResponseBytes: 5 * 1024 * 1024,
      defaultTimeout: 30_000,
      maxTimeout: 120_000,
    })
  })

  test("honors configured overrides independently", () => {
    expect(resolveLimits({ max_response_bytes: 1024 })).toEqual({
      maxResponseBytes: 1024,
      defaultTimeout: 30_000,
      maxTimeout: 120_000,
    })
    expect(resolveLimits({ default_timeout: 5_000, max_timeout: 10_000 })).toEqual({
      maxResponseBytes: 5 * 1024 * 1024,
      defaultTimeout: 5_000,
      maxTimeout: 10_000,
    })
  })

  test("enforces the byte cap incrementally for chunked responses without content-length", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        // A ReadableStream body has no content-length. Enforcing the cap only
        // after arrayBuffer() would buffer all chunks; the reader must cancel
        // as soon as the cap is crossed.
        let pulled = 0
        let cancelled = false
        const chunk = new TextEncoder().encode("x".repeat(16))
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled++
            if (pulled > 8) {
              controller.close()
              return
            }
            controller.enqueue(chunk)
          },
          cancel() {
            cancelled = true
          },
        })
        const originalFetch = globalThis.fetch
        ;(globalThis as any).fetch = async () =>
          new Response(stream, { status: 200, headers: { "content-type": "text/plain" } })
        try {
          const config = TestConfig.layer({
            get: () => Effect.succeed({ webfetch: { max_response_bytes: 32 } }),
          })
          const { WebFetchTool } = await import("../../src/tool/webfetch")
          await expect(
            WebFetchTool.pipe(
              Effect.flatMap((info) => info.init()),
              Effect.flatMap((tool) => tool.execute({ url: "http://localhost/chunked", format: "text" }, ctx)),
              Effect.provide(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, config)),
              Effect.runPromise,
            ),
          ).rejects.toThrow("exceeds 32 byte limit")
          // Only enough chunks to cross 32 bytes were consumed, and the reader
          // cancelled the stream instead of draining all 8 chunks.
          expect(pulled).toBeLessThan(8)
          expect(cancelled).toBe(true)
        } finally {
          ;(globalThis as any).fetch = originalFetch
        }
      },
    })
  })

  test("cancels the first response body when retrying a Cloudflare challenge", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        let calls = 0
        let firstBodyCancelled = false
        const originalFetch = globalThis.fetch
        ;(globalThis as any).fetch = async () => {
          calls++
          if (calls === 1) {
            // Cloudflare challenge response: 403 with the cf-mitigated header.
            // Its body is never consumed on the retry path, so the tool must
            // cancel it to release the connection.
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("challenge"))
              },
              cancel() {
                firstBodyCancelled = true
              },
            })
            return new Response(body, {
              status: 403,
              headers: { "content-type": "text/plain", "cf-mitigated": "challenge" },
            })
          }
          return new Response("retried ok", { status: 200, headers: { "content-type": "text/plain" } })
        }
        try {
          const result = await exec({ url: "http://localhost/cf-challenge", format: "text" })
          expect(result.output).toContain("retried ok")
          expect(calls).toBe(2)
          expect(firstBodyCancelled).toBe(true)
        } finally {
          ;(globalThis as any).fetch = originalFetch
        }
      },
    })
  })

  test("applies the configured response size limit to fetches", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const client = HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response("x".repeat(64), { status: 200, headers: { "content-type": "text/plain" } }),
            ),
          ),
        )
        const config = TestConfig.layer({
          get: () => Effect.succeed({ webfetch: { max_response_bytes: 8 } }),
        })
        const { WebFetchTool } = await import("../../src/tool/webfetch")
        await expect(
          WebFetchTool.pipe(
            Effect.flatMap((info) => info.init()),
            Effect.flatMap((tool) =>
              tool.execute({ url: "http://localhost/large", format: "text" }, ctx),
            ),
            Effect.provideService(HttpClient.HttpClient, client),
            Effect.provide(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, config)),
            Effect.runPromise,
          ),
        ).rejects.toThrow("exceeds 8 byte limit")
      },
    })
  })
})

describe("tool.webfetch", () => {
  test("returns image responses as file attachments", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const imageClient = HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(imageBytes, { status: 200, headers: { "content-type": "IMAGE/PNG" } }),
            ),
          ),
        )

        const { WebFetchTool } = await import("../../src/tool/webfetch")
        const result = await WebFetchTool.pipe(
          Effect.flatMap((info) => info.init()),
          Effect.flatMap((tool) =>
            tool.execute({ url: "http://localhost/image.png", format: "markdown" }, ctx),
          ),
          Effect.provideService(HttpClient.HttpClient, imageClient),
          Effect.provide(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer)),
          Effect.runPromise,
        )

        expect(result.output).toBe("Image fetched successfully")
        expect(result.attachments).toBeDefined()
        expect(result.attachments?.length).toBe(1)
        expect(result.attachments?.[0].type).toBe("file")
        expect(result.attachments?.[0].mime).toBe("image/png")
        expect(result.attachments?.[0].url.startsWith("data:image/png;base64,")).toBe(true)
        expect(result.attachments?.[0]).not.toHaveProperty("id")
        expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
        expect(result.attachments?.[0]).not.toHaveProperty("messageID")
      },
    })
  })

  test("keeps svg as text output", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const svgClient = HttpClient.make((request: HttpClientRequest.HttpClientRequest) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response('<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>', {
                status: 200,
                headers: { "content-type": "image/svg+xml" },
              }),
            ),
          ),
        )

        const { WebFetchTool } = await import("../../src/tool/webfetch")
        const result = await WebFetchTool.pipe(
          Effect.flatMap((info) => info.init()),
          Effect.flatMap((tool) =>
            tool.execute({ url: "http://localhost/image.svg", format: "html" }, ctx),
          ),
          Effect.provideService(HttpClient.HttpClient, svgClient),
          Effect.provide(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer)),
          Effect.runPromise,
        )

        expect(result.output).toContain("<svg")
        expect(result.attachments).toBeUndefined()
      },
    })
  })

  test("keeps text responses as text output", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await exec({ url: "http://localhost/file.txt", format: "text" })
        expect(result.output).toBe("hello from webfetch")
        expect(result.attachments).toBeUndefined()
      },
    })
  })

  test("rejects requests to 127.0.0.1", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://127.0.0.1/", format: "text" })).rejects.toThrow(
          "Refusing to fetch webfetch from private/internal network target",
        )
      },
    })
  })

  test("rejects requests to 169.254.169.254", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://169.254.169.254/latest/meta-data/", format: "text" })).rejects.toThrow(
          "Refusing to fetch webfetch from private/internal network target",
        )
      },
    })
  })

  test("rejects requests to 10.0.0.1", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://10.0.0.1/", format: "text" })).rejects.toThrow(
          "Refusing to fetch webfetch from private/internal network target",
        )
      },
    })
  })

  test("rejects requests to 192.168.1.1", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://192.168.1.1/", format: "text" })).rejects.toThrow(
          "Refusing to fetch webfetch from private/internal network target",
        )
      },
    })
  })

  test("rejects requests to [::1]", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://[::1]/", format: "text" })).rejects.toThrow(
          "Refusing to fetch webfetch from private/internal network target",
        )
      },
    })
  })

  test("rejects requests to [fc00::1]", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://[fc00::1]/", format: "text" })).rejects.toThrow(
          "Refusing to fetch webfetch from private/internal network target",
        )
      },
    })
  })

  test("decodes quoted charset correctly", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        // webfetch now fetches through util/network guardedFetch (global fetch),
        // so responses are injected via a fetch mock instead of an HttpClient layer.
        const originalFetch = globalThis.fetch
        ;(globalThis as any).fetch = async () =>
          new Response("<p>hello from quoted charset</p>", {
            status: 200,
            headers: { "content-type": 'text/html; charset="utf-8"' },
          })
        try {
          const { WebFetchTool } = await import("../../src/tool/webfetch")
          const result = await WebFetchTool.pipe(
            Effect.flatMap((info) => info.init()),
            Effect.flatMap((tool) => tool.execute({ url: "http://localhost/quoted-charset", format: "text" }, ctx)),
            Effect.provide(Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer)),
            Effect.runPromise,
          )
          expect(result.output).toContain("hello from quoted charset")
        } finally {
          ;(globalThis as any).fetch = originalFetch
        }
      },
    })
  })

  test("rejects requests to [fd00::1]", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://[fd00::1]/", format: "text" })).rejects.toThrow(
          "Refusing to fetch webfetch from private/internal network target",
        )
      },
    })
  })

  test("rejects requests to IPv6 addresses with brackets containing private IPs", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://[fc00::1]/", format: "text" })).rejects.toThrow(
          "Refusing to fetch webfetch from private/internal network target",
        )
      },
    })
  })
})
