import { afterAll, beforeEach, afterEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { Instance } from "../../src/project/instance"
import { WithInstance } from "../../src/project/with-instance"
import { WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"

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
  dns.promises.lookup = async (hostname: string) => {
    if (hostname.toLowerCase() === "localhost") {
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
          "SSRF guard: requests to private/internal IPs are not allowed",
        )
      },
    })
  })

  test("rejects requests to 169.254.169.254", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://169.254.169.254/latest/meta-data/", format: "text" })).rejects.toThrow(
          "SSRF guard: requests to private/internal IPs are not allowed",
        )
      },
    })
  })

  test("rejects requests to 10.0.0.1", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://10.0.0.1/", format: "text" })).rejects.toThrow(
          "SSRF guard: requests to private/internal IPs are not allowed",
        )
      },
    })
  })

  test("rejects requests to 192.168.1.1", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://192.168.1.1/", format: "text" })).rejects.toThrow(
          "SSRF guard: requests to private/internal IPs are not allowed",
        )
      },
    })
  })

  test("rejects requests to [::1]", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://[::1]/", format: "text" })).rejects.toThrow(
          "SSRF guard: requests to private/internal IPs are not allowed",
        )
      },
    })
  })

  test("rejects requests to [fc00::1]", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://[fc00::1]/", format: "text" })).rejects.toThrow(
          "SSRF guard: requests to private/internal IPs are not allowed",
        )
      },
    })
  })

  test("rejects requests to [fd00::1]", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(exec({ url: "http://[fd00::1]/", format: "text" })).rejects.toThrow(
          "SSRF guard: requests to private/internal IPs are not allowed",
        )
      },
    })
  })
})
