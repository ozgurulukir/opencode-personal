import { describe, expect, test } from "bun:test"
import { createStreamingResponse, handleNonStreamingResponse, prepareResponseMetadata } from "../../../../src/routes/zen/util/response"

describe("prepareResponseMetadata", () => {
  test("maps 404 to 400 status", () => {
    const res = new Response(null, { status: 404, headers: { "content-type": "application/json" } })
    const result = prepareResponseMetadata(res)
    expect(result.status).toBe(400)
    expect(result.headers.get("content-type")).toBe("application/json")
  })

  test("keeps content-type and cache-control headers only", () => {
    const res = new Response(null, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-cache",
        "x-custom": "value",
        "set-cookie": "session=1",
      },
    })
    const result = prepareResponseMetadata(res)
    expect(result.headers.get("content-type")).toBe("application/json")
    expect(result.headers.get("cache-control")).toBe("no-cache")
    expect(result.headers.get("x-custom")).toBeNull()
    expect(result.headers.get("set-cookie")).toBeNull()
  })
})

describe("handleNonStreamingResponse", () => {
  function createDeps(overrides: any = {}) {
    return {
      providerInfo: {
        id: "provider-1",
        model: "provider-model",
        format: "openai",
        normalizeUsage: () => ({ inputTokens: 10, outputTokens: 20 }),
        ...overrides.providerInfo,
      },
      modelInfo: {
        id: "gpt-4o",
        cost: { input: 1, output: 2 },
        ...overrides.modelInfo,
      },
      billingSource: "balance" as const,
      authInfo: { workspaceID: "ws-1" },
      sessionId: "session-1",
      format: "openai" as const,
      rateLimiter: { track: async () => {} },
      trialLimiter: { track: async () => {} },
      modelTpmLimiter: { track: async () => {} },
      dataDumper: { provideResponse: () => {}, flush: () => {} },
      Database: { use: async () => {} },
      logger: { metric: () => {}, debug: () => {} },
      trackUsage: async () => ({ costInMicroCents: 100 }),
      reload: async () => {},
      ...overrides.deps,
    }
  }

  test("returns converted response with cost when usage is present", async () => {
    const res = new Response(JSON.stringify({ id: "chat-1", usage: { total_tokens: 30 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
    const deps = createDeps()
    const result = await handleNonStreamingResponse(res, deps)

    expect(result.status).toBe(200)
    expect(result.headers.get("content-type")).toBe("application/json")
    const json = await result.json()
    expect(json.id).toBe("chat-1")
    expect(json.cost).toBe("50.00000000")
  })

  test("prefixes provider error message", async () => {
    const res = new Response(
      JSON.stringify({ error: { message: "Rate limited" } }),
      { status: 400, headers: { "content-type": "application/json" } },
    )
    const deps = createDeps({
      providerInfo: { displayName: "OpenAI" },
    })
    const result = await handleNonStreamingResponse(res, deps)
    const json = await result.json()
    expect(json.error.message).toBe("Error from provider (OpenAI): Rate limited")
  })

  test("returns response without cost when usage is absent", async () => {
    const res = new Response(JSON.stringify({ id: "chat-2" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
    const deps = createDeps()
    const result = await handleNonStreamingResponse(res, deps)
    const json = await result.json()
    expect(json.id).toBe("chat-2")
    expect(json.cost).toBeUndefined()
  })

  test("converts response body when formats differ and preserves cost", async () => {
    const res = new Response(
      JSON.stringify({
        id: "msg_123",
        type: "message",
        model: "claude",
        content: [{ type: "text", text: "hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
    const deps = createDeps({
      providerInfo: { format: "anthropic", normalizeUsage: () => ({ inputTokens: 1, outputTokens: 2 }) },
    })
    const result = await handleNonStreamingResponse(res, deps)
    const json = await result.json()
    expect(json.object).toBe("response")
    expect(json.output[0].content[0].text).toBe("hi")
    expect(json.cost).toBe("5.00000000")
  })
})

describe("createStreamingResponse", () => {
  function createStreamResponse(chunks: Uint8Array[], status = 200) {
    return new Response(
      new ReadableStream({
        start(c) {
          for (const chunk of chunks) c.enqueue(chunk)
          c.close()
        },
      }),
      { status, headers: { "content-type": "text/event-stream" } },
    )
  }

  function createDeps(overrides: any = {}) {
    return {
      providerInfo: {
        id: "provider-1",
        model: "provider-model",
        format: "openai",
        streamSeparator: "\n\n",
        normalizeUsage: () => ({ inputTokens: 5, outputTokens: 10 }),
        createUsageParser: () => ({
          parse: () => {},
          retrieve: () => ({ total_tokens: 15 }),
        }),
        createBinaryStreamDecoder: () => undefined,
        ...overrides.providerInfo,
      },
      modelInfo: {
        id: "gpt-4o",
        cost: { input: 1, output: 2 },
        ...overrides.modelInfo,
      },
      billingSource: "balance" as const,
      authInfo: { workspaceID: "ws-1" },
      sessionId: "session-1",
      format: "openai" as const,
      rateLimiter: { track: async () => {} },
      trialLimiter: { track: async () => {} },
      modelTpmLimiter: { track: async () => {} },
      dataDumper: { provideStream: () => {}, flush: () => {} },
      Database: { use: async () => {} },
      logger: { metric: () => {}, debug: () => {} },
      trackUsage: async () => ({ costInMicroCents: 100 }),
      reload: async () => {},
      ...overrides.deps,
    }
  }

  test("passes through chunks when formats match and appends cost chunk", async () => {
    const encoder = new TextEncoder()
    const res = createStreamResponse([encoder.encode('data: {"chunk":1}\n\n')])
    const deps = createDeps()
    const result = createStreamingResponse(res, 1000, (part) => part, deps)

    expect(result.status).toBe(200)
    expect(result.headers.get("content-type")).toBe("text/event-stream")

    const reader = result.body!.getReader()
    const chunks: string[] = []
    const decoder = new TextDecoder()
    let done = false
    while (!done) {
      const { value, done: d } = await reader.read()
      done = d
      if (value) chunks.push(decoder.decode(value))
    }

    const text = chunks.join("")
    expect(text).toContain('data: {"chunk":1}')
    expect(text).toContain('event: ping')
    expect(text).toContain('"type":"ping"')
  })

  test("converts chunks when formats differ", async () => {
    const encoder = new TextEncoder()
    const res = createStreamResponse([encoder.encode('data: {"chunk":1}\n\n')])
    const deps = createDeps({ providerInfo: { format: "anthropic" } })
    const streamConverter = (part: string) => `converted:${part}`
    const result = createStreamingResponse(res, 1000, streamConverter, deps)

    const reader = result.body!.getReader()
    const chunks: string[] = []
    const decoder = new TextDecoder()
    let done = false
    while (!done) {
      const { value, done: d } = await reader.read()
      done = d
      if (value) chunks.push(decoder.decode(value))
    }

    const text = chunks.join("")
    expect(text).toContain("converted:data: {\"chunk\":1}\n\n")
  })

  test("uses binary decoder when provided", async () => {
    const encoder = new TextEncoder()
    const res = createStreamResponse([new Uint8Array([1, 2, 3])])
    const binaryDecoder = (chunk: Uint8Array) => new Uint8Array([...chunk, 4])
    const deps = createDeps({
      providerInfo: {
        createBinaryStreamDecoder: () => binaryDecoder,
      },
    })
    const result = createStreamingResponse(res, 1000, (part) => part, deps)

    const reader = result.body!.getReader()
    const chunks: Uint8Array[] = []
    let done = false
    while (!done) {
      const { value, done: d } = await reader.read()
      done = d
      if (value) chunks.push(value)
    }

    expect(chunks[0]).toEqual(new Uint8Array([1, 2, 3, 4]))
  })
})
