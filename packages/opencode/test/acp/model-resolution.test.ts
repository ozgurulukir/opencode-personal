import { describe, expect, test } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { ProviderID, ModelID } from "../../src/provider/schema"

// These tests lock down the behavior of model-resolution functions before extraction.
// They test the fallback chains and error handling of:
// - getContextLimit
// - sendUsageUpdate
// - defaultModel
// - lastUsedModel

function createMockSDK(overrides: Record<string, any> = {}): any {
  const { config: configOverrides, sessions, messages, providers: providerList, ...rest } = overrides
  return {
    config: {
      async providers({ directory }: { directory: string }) {
        return { data: { providers: providerList ?? [] } }
      },
      async get({ directory }: { directory: string }) {
        if (configOverrides?.get) return configOverrides.get({ directory })
        return { data: configOverrides?.data ?? undefined }
      },
    },
    session: {
      async list({ directory, roots, limit }: any) {
        return { data: sessions ?? [] }
      },
      async messages({ sessionID, directory, limit }: any) {
        return { data: messages ?? [] }
      },
    },
    ...rest,
  }
}

function createMockConnection(): { connection: AgentSideConnection; sessionUpdates: any[] } {
  const sessionUpdates: any[] = []
  const connection = {
    async sessionUpdate(params: any) {
      sessionUpdates.push(params)
    },
  } as unknown as AgentSideConnection
  return { connection, sessionUpdates }
}

describe("getContextLimit", () => {
  test("returns context limit when provider and model exist", async () => {
    const sdk = createMockSDK({
      providers: [
        {
          id: "anthropic",
          models: {
            "claude-3-opus": {
              limit: { context: 200000 },
            },
          },
        },
      ],
    })

    // Import after extraction
    const { getContextLimit } = await import("../../src/acp/model-resolution")
    const result = await getContextLimit(sdk, ProviderID.make("anthropic"), ModelID.make("claude-3-opus"), "/tmp")
    expect(result).toBe(200000)
  })

  test("returns null when provider not found", async () => {
    const sdk = createMockSDK({
      providers: [{ id: "openai", models: {} }],
    })

    const { getContextLimit } = await import("../../src/acp/model-resolution")
    const result = await getContextLimit(sdk, ProviderID.make("anthropic"), ModelID.make("claude-3-opus"), "/tmp")
    expect(result).toBeNull()
  })

  test("returns null when model not found", async () => {
    const sdk = createMockSDK({
      providers: [{ id: "anthropic", models: { "claude-3-sonnet": { limit: { context: 100000 } } } }],
    })

    const { getContextLimit } = await import("../../src/acp/model-resolution")
    const result = await getContextLimit(sdk, ProviderID.make("anthropic"), ModelID.make("claude-3-opus"), "/tmp")
    expect(result).toBeNull()
  })

  test("returns null when providers API fails", async () => {
    const sdk = createMockSDK({
      config: {
        async providers() {
          throw new Error("API error")
        },
        async get() {
          return { data: undefined }
        },
      },
    })

    const { getContextLimit } = await import("../../src/acp/model-resolution")
    const result = await getContextLimit(sdk, ProviderID.make("anthropic"), ModelID.make("claude-3-opus"), "/tmp")
    expect(result).toBeNull()
  })

  test("returns null when model has no limit", async () => {
    const sdk = createMockSDK({
      providers: [{ id: "anthropic", models: { "claude-3-opus": { name: "Opus" } } }],
    })

    const { getContextLimit } = await import("../../src/acp/model-resolution")
    const result = await getContextLimit(sdk, ProviderID.make("anthropic"), ModelID.make("claude-3-opus"), "/tmp")
    expect(result).toBeNull()
  })
})

describe("sendUsageUpdate", () => {
  test("sends usage update with correct values", async () => {
    const { connection, sessionUpdates } = createMockConnection()
    const sdk = createMockSDK({
      messages: [
        {
          info: {
            role: "assistant",
            providerID: "anthropic",
            modelID: "claude-3-opus",
            tokens: { input: 1000, cache: { read: 500 } },
            cost: 0.05,
          },
          parts: [],
        },
      ],
      providers: [
        {
          id: "anthropic",
          models: {
            "claude-3-opus": { limit: { context: 200000 } },
          },
        },
      ],
    })

    const { sendUsageUpdate } = await import("../../src/acp/model-resolution")
    await sendUsageUpdate(connection, sdk, "ses_1", "/tmp")

    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0]).toEqual({
      sessionId: "ses_1",
      update: {
        sessionUpdate: "usage_update",
        used: 1500, // input + cache.read
        size: 200000,
        cost: { amount: 0.05, currency: "USD" },
      },
    })
  })

  test("does nothing when no messages", async () => {
    const { connection, sessionUpdates } = createMockConnection()
    const sdk = createMockSDK({ messages: [] })

    const { sendUsageUpdate } = await import("../../src/acp/model-resolution")
    await sendUsageUpdate(connection, sdk, "ses_1", "/tmp")

    expect(sessionUpdates).toHaveLength(0)
  })

  test("does nothing when no assistant messages", async () => {
    const { connection, sessionUpdates } = createMockConnection()
    const sdk = createMockSDK({
      messages: [{ info: { role: "user" }, parts: [] }],
    })

    const { sendUsageUpdate } = await import("../../src/acp/model-resolution")
    await sendUsageUpdate(connection, sdk, "ses_1", "/tmp")

    expect(sessionUpdates).toHaveLength(0)
  })

  test("does nothing when context limit is null", async () => {
    const { connection, sessionUpdates } = createMockConnection()
    const sdk = createMockSDK({
      messages: [
        {
          info: {
            role: "assistant",
            providerID: "anthropic",
            modelID: "claude-3-opus",
            tokens: { input: 1000 },
            cost: 0.05,
          },
          parts: [],
        },
      ],
      providers: [], // No providers → context limit is null
    })

    const { sendUsageUpdate } = await import("../../src/acp/model-resolution")
    await sendUsageUpdate(connection, sdk, "ses_1", "/tmp")

    expect(sessionUpdates).toHaveLength(0)
  })

  test("sums cost across all assistant messages", async () => {
    const { connection, sessionUpdates } = createMockConnection()
    const sdk = createMockSDK({
      messages: [
        {
          info: {
            role: "assistant",
            providerID: "anthropic",
            modelID: "claude-3-opus",
            tokens: { input: 1000 },
            cost: 0.05,
          },
          parts: [],
        },
        {
          info: {
            role: "assistant",
            providerID: "anthropic",
            modelID: "claude-3-opus",
            tokens: { input: 500 },
            cost: 0.03,
          },
          parts: [],
        },
      ],
      providers: [
        {
          id: "anthropic",
          models: { "claude-3-opus": { limit: { context: 200000 } } },
        },
      ],
    })

    const { sendUsageUpdate } = await import("../../src/acp/model-resolution")
    await sendUsageUpdate(connection, sdk, "ses_1", "/tmp")

    expect(sessionUpdates[0].update.cost.amount).toBe(0.08)
  })
})

describe("defaultModel", () => {
  test("returns configured defaultModel when provided", async () => {
    const sdk = createMockSDK()
    const config = {
      sdk,
      defaultModel: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-3-opus") },
    }

    const { defaultModel } = await import("../../src/acp/model-resolution")
    const result = await defaultModel(config, "/tmp")
    expect(result.providerID as string).toBe("anthropic")
    expect(result.modelID as string).toBe("claude-3-opus")
  })

  test("uses config.model when no defaultModel", async () => {
    const sdk = createMockSDK({
      config: {
        async get() {
          return { data: { model: "anthropic/claude-3-opus" } }
        },
      },
      providers: [{ id: "anthropic", models: { "claude-3-opus": {} } }],
    })
    const config = { sdk }

    const { defaultModel } = await import("../../src/acp/model-resolution")
    const result = await defaultModel(config, "/tmp")
    expect(result.providerID as string).toBe("anthropic")
    expect(result.modelID as string).toBe("claude-3-opus")
  })

  test("falls back to lastUsedModel when config.model not in providers", async () => {
    const sdk = createMockSDK({
      config: {
        async get() {
          return { data: { model: "openai/gpt-4" } }
        },
      },
      providers: [{ id: "anthropic", models: { "claude-3-opus": {} } }],
      sessions: [{ id: "ses_1" }],
      messages: [
        {
          info: {
            role: "user",
            model: { providerID: "anthropic", modelID: "claude-3-opus" },
          },
        },
      ],
    })
    const config = { sdk }

    const { defaultModel } = await import("../../src/acp/model-resolution")
    const result = await defaultModel(config, "/tmp")
    expect(result.providerID as string).toBe("anthropic")
    expect(result.modelID as string).toBe("claude-3-opus")
  })

  test("falls back to opencode provider when no lastUsed", async () => {
    const sdk = createMockSDK({
      providers: [
        {
          id: "opencode",
          models: {
            "default-model": { id: "default-model", providerID: "opencode", name: "Default" },
          },
        },
      ],
    })
    const config = { sdk }

    const { defaultModel } = await import("../../src/acp/model-resolution")
    const result = await defaultModel(config, "/tmp")
    expect(result.providerID as string).toBe("opencode")
  })

  test("throws when no models available", async () => {
    const sdk = createMockSDK({ providers: [] })
    const config = { sdk }

    const { defaultModel } = await import("../../src/acp/model-resolution")
    await expect(defaultModel(config, "/tmp")).rejects.toThrow("No models available")
  })
})

describe("lastUsedModel", () => {
  test("returns model from last user message", async () => {
    const sdk = createMockSDK({
      sessions: [{ id: "ses_1" }],
      messages: [
        {
          info: {
            role: "user",
            model: { providerID: "anthropic", modelID: "claude-3-opus" },
          },
        },
      ],
      providers: [{ id: "anthropic", models: { "claude-3-opus": {} } }],
    })

    const { lastUsedModel } = await import("../../src/acp/model-resolution")
    const providers = [{ id: "anthropic", models: { "claude-3-opus": {} } }]
    const result = await lastUsedModel(sdk, "/tmp", providers)
    expect(result?.providerID as string).toBe("anthropic")
    expect(result?.modelID as string).toBe("claude-3-opus")
  })

  test("returns undefined when no sessions", async () => {
    const sdk = createMockSDK({ sessions: [] })

    const { lastUsedModel } = await import("../../src/acp/model-resolution")
    const result = await lastUsedModel(sdk, "/tmp", [])
    expect(result).toBeUndefined()
  })

  test("returns undefined when model not in providers", async () => {
    const sdk = createMockSDK({
      sessions: [{ id: "ses_1" }],
      messages: [
        {
          info: {
            role: "user",
            model: { providerID: "openai", modelID: "gpt-4" },
          },
        },
      ],
      providers: [{ id: "anthropic", models: { "claude-3-opus": {} } }],
    })

    const { lastUsedModel } = await import("../../src/acp/model-resolution")
    const result = await lastUsedModel(sdk, "/tmp", [{ id: "anthropic", models: { "claude-3-opus": {} } }])
    expect(result).toBeUndefined()
  })
})
