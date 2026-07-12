import { afterAll, describe, expect, mock, test } from "bun:test"

// Mock SST-triggering modules to allow handler.ts to import without SST.
// These 3 modules access SST resources at load time; no other test file imports them at runtime.
mock.module("../../../../src/routes/zen/util/billing", () => ({
  validateBilling: () => "balance",
}))
mock.module("../../../../src/routes/zen/util/reload", () => ({
  reload: async () => {},
}))
mock.module("../../../../src/routes/zen/util/usage", () => ({
  trackUsage: async () => ({ costInMicroCents: 0 }),
}))

afterAll(() => {
  mock.restore()
})

const { handler } = await import("../../../../src/routes/zen/util/handler")

function createInput(url = "https://example.com/v1/chat/completions", body: any = { model: "gpt-4o" }): any {
  return {
    request: new Request(url, {
      method: "POST",
      headers: {
        "x-real-ip": "192.168.1.1",
        "x-opencode-session": "session-1",
        "x-opencode-request": "request-1",
        "x-opencode-project": "project-1",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  }
}

const opts = {
  format: "openai" as const,
  modelList: "full" as const,
  parseApiKey: () => "key-1",
  parseModel: (_url: string, body: any) => body.model,
  parseVariant: () => undefined,
  parseIsStream: (_url: string, body: any) => !!body.stream,
}

function createMockDeps(overrides: any = {}) {
  const setupResult = {
    zenData: {},
    modelInfo: { id: "gpt-4o", providers: [] },
    dataDumper: { provideModel: mock(() => {}), provideRequest: mock(() => {}), flush: mock(() => {}) },
    trialLimiter: { track: mock(async () => {}) },
    trialProviders: undefined,
    rateLimiter: { track: mock(async () => {}) },
    stickyTracker: { set: mock(async () => {}) },
    stickyProvider: undefined,
    authInfo: { workspaceID: "ws-1" },
    billingSource: "balance" as const,
    modelTpmLimiter: { track: mock(async () => {}) },
    modelTpmLimits: undefined,
    ...overrides.setupResult,
  }

  const retryResult = {
    providerInfo: {
      id: "openai",
      model: "gpt-4o",
      format: "openai",
      storeModel: "gpt-4o",
    },
    reqBody: '{"model":"gpt-4o"}',
    res: new Response(JSON.stringify({ id: "chat-1" }), { status: 200 }),
    startTimestamp: Date.now(),
    ...overrides.retryResult,
  }

  return {
    parseRequest: mock(async () => ({
      url: "https://example.com/v1/chat/completions",
      body: { model: "gpt-4o" },
      model: "gpt-4o",
      variant: undefined,
      isStream: false,
      ip: "192.168.1.1",
      zenApiKey: "key-1",
      sessionId: "session-1",
      requestId: "request-1",
      projectId: "project-1",
      ocClient: "",
      userAgent: "",
    })),
    setupRequest: mock(async () => setupResult),
    executeRetriableRequest: mock(async () => retryResult),
    handleNonStreamingResponse: mock(async () => new Response("non-stream", { status: 200 })),
    createStreamingResponse: mock(() => new Response("stream", { status: 200 })),
    createStreamPartConverter: mock(() => (part: string) => part),
    mapErrorToResponse: mock(() => new Response("error", { status: 500 })),
    ...overrides.deps,
  }
}

describe("handler", () => {
  test("non-streaming: calls parseRequest → setupRequest → executeRetriableRequest → handleNonStreamingResponse", async () => {
    const deps = createMockDeps()
    const result = await handler(createInput(), opts, deps)

    expect(result.status).toBe(200)
    expect(deps.parseRequest).toHaveBeenCalledTimes(1)
    expect(deps.setupRequest).toHaveBeenCalledTimes(1)
    expect(deps.executeRetriableRequest).toHaveBeenCalledTimes(1)
    expect(deps.handleNonStreamingResponse).toHaveBeenCalledTimes(1)
    expect(deps.createStreamingResponse).toHaveBeenCalledTimes(0)
    expect(deps.mapErrorToResponse).toHaveBeenCalledTimes(0)
  })

  test("streaming: calls createStreamingResponse when isStream and status 200", async () => {
    const deps = createMockDeps({
      deps: {
        parseRequest: mock(async () => ({
          url: "https://example.com/v1/chat/completions",
          body: { model: "gpt-4o", stream: true },
          model: "gpt-4o",
          variant: undefined,
          isStream: true,
          ip: "192.168.1.1",
          zenApiKey: "key-1",
          sessionId: "session-1",
          requestId: "request-1",
          projectId: "project-1",
          ocClient: "",
          userAgent: "",
        })),
      },
    })
    const result = await handler(createInput(), opts, deps)

    expect(result.status).toBe(200)
    expect(deps.handleNonStreamingResponse).toHaveBeenCalledTimes(0)
    expect(deps.createStreamingResponse).toHaveBeenCalledTimes(1)
    expect(deps.createStreamPartConverter).toHaveBeenCalledTimes(1)
  })

  test("streaming with 400 status falls back to handleNonStreamingResponse", async () => {
    const deps = createMockDeps({
      deps: {
        parseRequest: mock(async () => ({
          url: "https://example.com/v1/chat/completions",
          body: { model: "gpt-4o", stream: true },
          model: "gpt-4o",
          variant: undefined,
          isStream: true,
          ip: "192.168.1.1",
          zenApiKey: "key-1",
          sessionId: "session-1",
          requestId: "request-1",
          projectId: "project-1",
          ocClient: "",
          userAgent: "",
        })),
      },
      retryResult: {
        res: new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
      },
    })
    const result = await handler(createInput(), opts, deps)

    expect(deps.handleNonStreamingResponse).toHaveBeenCalledTimes(1)
    expect(deps.createStreamingResponse).toHaveBeenCalledTimes(0)
  })

  test("error path: calls mapErrorToResponse when parseRequest throws", async () => {
    const deps = createMockDeps({
      deps: {
        parseRequest: mock(async () => {
          throw new Error("parse failed")
        }),
      },
    })
    const result = await handler(createInput(), opts, deps)

    expect(result.status).toBe(500)
    expect(deps.mapErrorToResponse).toHaveBeenCalledTimes(1)
    expect(deps.setupRequest).toHaveBeenCalledTimes(0)
    expect(deps.executeRetriableRequest).toHaveBeenCalledTimes(0)
  })

  test("passes dataDumper and stickyTracker side-effects after retry", async () => {
    const dataDumper = {
      provideModel: mock(() => {}),
      provideRequest: mock(() => {}),
      flush: mock(() => {}),
    }
    const stickyTracker = { set: mock(async () => {}) }
    const deps = createMockDeps({
      setupResult: { dataDumper, stickyTracker },
    })
    await handler(createInput(), opts, deps)

    expect(dataDumper.provideModel).toHaveBeenCalledWith("gpt-4o")
    expect(dataDumper.provideRequest).toHaveBeenCalledWith('{"model":"gpt-4o"}')
    expect(stickyTracker.set).toHaveBeenCalledWith("openai")
  })

  test("error path: calls mapErrorToResponse when setupRequest throws", async () => {
    const deps = createMockDeps({
      deps: {
        setupRequest: mock(async () => {
          throw new Error("setup failed")
        }),
      },
    })
    const result = await handler(createInput(), opts, deps)

    expect(result.status).toBe(500)
    expect(deps.mapErrorToResponse).toHaveBeenCalledTimes(1)
    expect(deps.executeRetriableRequest).toHaveBeenCalledTimes(0)
  })

  test("error path: calls mapErrorToResponse when executeRetriableRequest throws", async () => {
    const deps = createMockDeps({
      deps: {
        executeRetriableRequest: mock(async () => {
          throw new Error("retry failed")
        }),
      },
    })
    const result = await handler(createInput(), opts, deps)

    expect(result.status).toBe(500)
    expect(deps.mapErrorToResponse).toHaveBeenCalledTimes(1)
  })

  test("streaming with 404 status falls back to handleNonStreamingResponse", async () => {
    const deps = createMockDeps({
      deps: {
        parseRequest: mock(async () => ({
          url: "https://example.com/v1/chat/completions",
          body: { model: "gpt-4o", stream: true },
          model: "gpt-4o",
          variant: undefined,
          isStream: true,
          ip: "192.168.1.1",
          zenApiKey: "key-1",
          sessionId: "session-1",
          requestId: "request-1",
          projectId: "project-1",
          ocClient: "",
          userAgent: "",
        })),
      },
      retryResult: {
        res: new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
      },
    })
    await handler(createInput(), opts, deps)

    expect(deps.handleNonStreamingResponse).toHaveBeenCalledTimes(1)
    expect(deps.createStreamingResponse).toHaveBeenCalledTimes(0)
  })

  test("passes responseDeps with correct fields to handleNonStreamingResponse", async () => {
    const deps = createMockDeps()
    await handler(createInput(), opts, deps)

    const [res, responseDeps] = deps.handleNonStreamingResponse.mock.calls[0]
    expect(res.status).toBe(200)
    expect(responseDeps.providerInfo.id).toBe("openai")
    expect(responseDeps.modelInfo.id).toBe("gpt-4o")
    expect(responseDeps.billingSource).toBe("balance")
    expect(responseDeps.format).toBe("openai")
    expect(responseDeps.sessionId).toBe("session-1")
  })
})
