import { describe, expect, mock, test } from "bun:test"
import {
  DEFAULT_CHUNK_TIMEOUT,
  DEFAULT_HTTP_TIMEOUT,
  __exportTestFetchFn,
  resolveChunkTimeout,
  resolveHttpTimeout,
} from "../../src/provider/provider"
import { ConfigProvider } from "../../src/config/provider"

describe("resolveHttpTimeout", () => {
  test("undefined resolves to the documented default", () => {
    expect(resolveHttpTimeout(undefined)).toBe(DEFAULT_HTTP_TIMEOUT)
  })

  test("null resolves to the documented default", () => {
    expect(resolveHttpTimeout(null)).toBe(DEFAULT_HTTP_TIMEOUT)
  })

  test("false preserves the opt-out (unbounded)", () => {
    expect(resolveHttpTimeout(false)).toBe(false)
  })

  test("an explicit positive number is honored verbatim", () => {
    expect(resolveHttpTimeout(30000)).toBe(30000)
  })
})

describe("resolveChunkTimeout", () => {
  test("undefined resolves to the documented default", () => {
    expect(resolveChunkTimeout(undefined)).toBe(DEFAULT_CHUNK_TIMEOUT)
  })

  test("false preserves the new opt-out (watchdog suppressed)", () => {
    expect(resolveChunkTimeout(false)).toBe(false)
  })

  test("an explicit positive number is honored verbatim", () => {
    expect(resolveChunkTimeout(15000)).toBe(15000)
  })

  test("0 and negative numbers fall back to the default", () => {
    expect(resolveChunkTimeout(0)).toBe(DEFAULT_CHUNK_TIMEOUT)
    expect(resolveChunkTimeout(-5)).toBe(DEFAULT_CHUNK_TIMEOUT)
  })
})

describe("ProviderConfig chunkTimeout/timeout schema (false opt-outs)", () => {
  const parse = (options: Record<string, unknown>) =>
    ConfigProvider.Info.zod.safeParse({ provider: { test: { options } } })

  test("accepts timeout: false and chunkTimeout: false", () => {
    expect(parse({ timeout: false, chunkTimeout: false }).success).toBe(true)
  })

  test("accepts explicit positive numbers for both fields", () => {
    expect(parse({ timeout: 30000, chunkTimeout: 15000 }).success).toBe(true)
  })

  test("accepts omitted fields", () => {
    expect(parse({}).success).toBe(true)
  })
})

describe("__exportTestFetchFn abort lifetime", () => {
  test("keeps the combined signal active after headers until the body completes", async () => {
    let observed: AbortSignal | undefined
    const customFetch = mock(async (_input: any, init?: any) => {
      observed = init?.signal
      return new Response(
        new ReadableStream<Uint8Array>({
          pull() {
            // Stall forever: never enqueue, never close.
            return new Promise<void>(() => {})
          },
        }),
        { headers: { "content-type": "application/json" } },
      )
    }) as any

    const external = new AbortController()
    const fetchFn = __exportTestFetchFn({ timeout: 25 }, { api: { npm: "@ai-sdk/anthropic" } }, customFetch, false)
    const res = await fetchFn("https://example.com", { method: "POST", signal: external.signal })
    expect(res).toBeDefined()
    await Bun.sleep(60)
    expect(observed?.aborted).toBe(true)
  })

  test("keeps the combined signal active while an SSE stream is in flight", async () => {
    let observed: AbortSignal | undefined
    let emitted = false
    const customFetch = mock(async (_input: any, init?: any) => {
      observed = init?.signal
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(ctrl) {
            if (!emitted) {
              emitted = true
              ctrl.enqueue(new TextEncoder().encode("data: hi\n\n"))
            }
            return new Promise<void>(() => {})
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      )
    }) as any

    const external = new AbortController()
    const fetchFn = __exportTestFetchFn({ timeout: 25 }, { api: { npm: "@ai-sdk/anthropic" } }, customFetch, 5000)
    const res = await fetchFn("https://example.com", { method: "POST", signal: external.signal })
    const reader = res.body!.getReader()
    await reader.read()
    await Bun.sleep(60)
    expect(observed?.aborted).toBe(true)
  })

  test("body chunks pass through intact", async () => {
    const customFetch = mock(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(ctrl) {
              ctrl.enqueue(new TextEncoder().encode("hello"))
              ctrl.close()
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    ) as any
    const fetchFn = __exportTestFetchFn({ timeout: 1000 }, { api: { npm: "@ai-sdk/anthropic" } }, customFetch, false)
    const res = await fetchFn("https://example.com", { method: "POST" })
    expect(await res.text()).toBe("hello")
  })
})
