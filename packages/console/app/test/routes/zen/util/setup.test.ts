import { describe, expect, mock, test } from "bun:test"
import { setupRequest } from "../../../../src/routes/zen/util/setup"

describe("setupRequest", () => {
  function createDeps(overrides: any = {}) {
    const modelInfo = {
      id: "gpt-4o",
      allowAnonymous: false,
      rateLimit: 100,
      trialProvider: undefined,
      stickyProvider: undefined,
      providers: [],
      ...overrides.modelInfo,
    }

    return {
      model: "gpt-4o",
      ip: "127.0.0.1",
      sessionId: "session-1",
      requestId: "request-1",
      projectId: "project-1",
      zenApiKey: "key-1",
      modelList: "full" as const,
      format: "openai" as const,
      request: new Request("https://example.com/v1/chat/completions"),
      ADMIN_WORKSPACES: [],
      t: (key: string) => key,
      Database: { use: async () => ({}) },
      logger: { metric: mock(() => {}) },
      ZenData: { list: mock(() => ({ providers: [] })) },
      validateModel: mock(() => modelInfo),
      createDataDumper: mock(() => ({ provideModel: () => {}, provideRequest: () => {}, flush: () => {} })),
      createTrialLimiter: mock(() => undefined),
      createIpRateLimiter: mock(() => ({ check: async () => {}, track: async () => {} })),
      createKeyRateLimiter: mock(() => ({ check: async () => {}, track: async () => {} })),
      createStickyTracker: mock(() => ({ get: async () => undefined, set: async () => {} })),
      authenticate: mock(async () => ({ workspaceID: "ws-1", apiKeyId: "k1", billing: { balance: 1000 }, user: { id: "u1" }, isFree: false, isDisabled: false })),
      validateBilling: mock(() => "balance"),
      createModelTpmLimiter: mock(() => ({ check: async () => undefined, track: async () => {} })),
      ...overrides.deps,
    }
  }

  test("returns all setup values for authenticated request", async () => {
    const deps = createDeps()
    const result = await setupRequest(deps)

    expect(result.modelInfo.id).toBe("gpt-4o")
    expect(result.authInfo).toEqual({
      workspaceID: "ws-1",
      apiKeyId: "k1",
      billing: { balance: 1000 },
      user: { id: "u1" },
      isFree: false,
      isDisabled: false,
    })
    expect(result.billingSource).toBe("balance")
    expect(deps.validateModel).toHaveBeenCalledTimes(1)
    expect(deps.authenticate).toHaveBeenCalledTimes(1)
    expect(deps.validateBilling).toHaveBeenCalledTimes(1)
  })

  test("uses IP rate limiter for anonymous models", async () => {
    const deps = createDeps({
      modelInfo: { id: "gpt-4o", allowAnonymous: true, rateLimit: 100, providers: [] },
    })
    await setupRequest(deps)

    expect(deps.createIpRateLimiter).toHaveBeenCalledTimes(1)
    expect(deps.createKeyRateLimiter).toHaveBeenCalledTimes(0)
  })

  test("uses key rate limiter for authenticated models", async () => {
    const deps = createDeps()
    await setupRequest(deps)

    expect(deps.createKeyRateLimiter).toHaveBeenCalledTimes(1)
    expect(deps.createIpRateLimiter).toHaveBeenCalledTimes(0)
  })

  test("logs billing source metric", async () => {
    const deps = createDeps()
    await setupRequest(deps)

    expect(deps.logger.metric).toHaveBeenCalledWith({ source: "balance" })
  })
})
