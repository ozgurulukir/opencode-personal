import { describe, expect, mock, test } from "bun:test"
import { executeRetriableRequest } from "../../../../src/routes/zen/util/retry"

describe("executeRetriableRequest", () => {
  function createDeps(overrides: any = {}) {
    const providerInfo = {
      id: "openai",
      model: "gpt-4o",
      api: "https://api.openai.com/v1/responses",
      format: "openai",
      displayName: "OpenAI",
      modifyUrl: (api: string) => api,
      modifyBody: (body: any) => body,
      modifyHeaders: () => {},
      payloadModifier: {},
      headerMappings: {},
      apiKey: "key-1",
      storeModel: "gpt-4o",
      ...overrides.providerInfo,
    }

    return {
      model: "gpt-4o",
      zenData: {} as any,
      authInfo: { workspaceID: "ws-1" },
      modelInfo: {
        id: "gpt-4o",
        stickyProvider: undefined,
        fallbackProvider: undefined,
        ...overrides.modelInfo,
      },
      ip: "127.0.0.1",
      sessionId: "session-1",
      trialProviders: undefined,
      stickyProvider: undefined,
      modelTpmLimits: undefined,
      body: { messages: [] },
      isStream: false,
      billingSource: "balance" as const,
      request: new Request("https://example.com/v1/chat/completions", {
        headers: { "x-opencode-request": "req-1" },
      }),
      opts: { format: "openai" as const, parseApiKey: () => undefined },
      t: (key: string) => key,
      logger: { metric: () => {}, debug: () => {} },
      selectProvider: mock(() => providerInfo),
      validateModelSettings: mock(() => {}),
      updateProviderKey: mock(() => {}),
      createBodyConverter: mock(() => (body: any) => body),
      fetchWith429Retry: mock(() =>
        Promise.resolve(new Response(JSON.stringify({ id: "chat-1" }), { status: 200 })),
      ),
      ...overrides.deps,
    }
  }

  test("returns provider response on first 200", async () => {
    const deps = createDeps()
    const result = await executeRetriableRequest(deps)

    expect(result.res.status).toBe(200)
    expect(result.providerInfo.id).toBe("openai")
    expect(deps.fetchWith429Retry).toHaveBeenCalledTimes(1)
  })

  test("retries on 502 and stops at fallback provider", async () => {
    const primaryProvider = {
      id: "primary",
      model: "gpt-4o",
      api: "https://primary.com",
      format: "openai",
      modifyUrl: (api: string) => api,
      modifyBody: (body: any) => body,
      modifyHeaders: () => {},
      payloadModifier: {},
      headerMappings: {},
      apiKey: "key-1",
      storeModel: "gpt-4o",
    }
    const fallbackProvider = {
      id: "fallback",
      model: "gpt-4o",
      api: "https://fallback.com",
      format: "openai",
      modifyUrl: (api: string) => api,
      modifyBody: (body: any) => body,
      modifyHeaders: () => {},
      payloadModifier: {},
      headerMappings: {},
      apiKey: "key-2",
      storeModel: "gpt-4o",
    }

    let callCount = 0
    const deps = createDeps({
      modelInfo: { fallbackProvider: "fallback" },
      deps: {
        selectProvider: mock(() => {
          callCount++
          return callCount === 1 ? primaryProvider : fallbackProvider
        }),
        fetchWith429Retry: mock(() =>
          Promise.resolve(new Response(JSON.stringify({ error: "bad gateway" }), { status: 502 })),
        ),
      },
    })

    const result = await executeRetriableRequest(deps)

    expect(result.providerInfo.id).toBe("fallback")
    expect(result.res.status).toBe(502)
    expect(deps.selectProvider).toHaveBeenCalledTimes(2)
    expect(deps.fetchWith429Retry).toHaveBeenCalledTimes(2)
  })

  test("does not retry on 404 errors", async () => {
    const deps = createDeps({
      deps: {
        fetchWith429Retry: mock(() =>
          Promise.resolve(new Response(JSON.stringify({ error: "not found" }), { status: 404 })),
        ),
      },
    })

    const result = await executeRetriableRequest(deps)

    expect(result.res.status).toBe(404)
    expect(deps.fetchWith429Retry).toHaveBeenCalledTimes(1)
  })

  test("does not retry when stickyProvider is strict", async () => {
    const deps = createDeps({
      modelInfo: { stickyProvider: "strict" as const, fallbackProvider: "fallback" },
      deps: {
        fetchWith429Retry: mock(() =>
          Promise.resolve(new Response(JSON.stringify({ error: "bad gateway" }), { status: 502 })),
        ),
      },
    })

    const result = await executeRetriableRequest(deps)

    expect(result.res.status).toBe(502)
    expect(deps.fetchWith429Retry).toHaveBeenCalledTimes(1)
  })

  test("does not retry when fallback provider is already reached", async () => {
    const fallbackProvider = {
      id: "fallback",
      model: "gpt-4o",
      api: "https://fallback.com",
      format: "openai",
      modifyUrl: (api: string) => api,
      modifyBody: (body: any) => body,
      modifyHeaders: () => {},
      payloadModifier: {},
      headerMappings: {},
      apiKey: "key-2",
      storeModel: "gpt-4o",
    }

    const deps = createDeps({
      modelInfo: { fallbackProvider: "fallback" },
      providerInfo: fallbackProvider,
      deps: {
        fetchWith429Retry: mock(() =>
          Promise.resolve(new Response(JSON.stringify({ error: "bad gateway" }), { status: 502 })),
        ),
      },
    })

    const result = await executeRetriableRequest(deps)

    expect(result.providerInfo.id).toBe("fallback")
    expect(result.res.status).toBe(502)
    expect(deps.fetchWith429Retry).toHaveBeenCalledTimes(1)
  })

  test("does not retry on 400 errors", async () => {
    const deps = createDeps({
      deps: {
        fetchWith429Retry: mock(() =>
          Promise.resolve(new Response(JSON.stringify({ error: "bad request" }), { status: 400 })),
        ),
      },
    })

    const result = await executeRetriableRequest(deps)

    expect(result.res.status).toBe(400)
    expect(deps.fetchWith429Retry).toHaveBeenCalledTimes(1)
  })
})
