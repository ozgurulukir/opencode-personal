import { describe, expect, test } from "bun:test"
import { selectProvider } from "../../../../src/routes/zen/util/provider-selector"

const baseZenData = {
  providers: {
    openai: { api: "https://api.openai.com", apiKey: "sk-test", format: "openai" },
    anthropic: { api: "https://api.anthropic.com", apiKey: "sk-ant-test", format: "anthropic" },
    google: { api: "https://generativelanguage.googleapis.com", apiKey: "google-key", format: "google" },
    "oa-compat": { api: "https://custom.example.com", apiKey: "custom-key", format: "oa-compat" },
  },
}

const baseDeps = {
  t: (key: string) => key,
  opts: { format: "openai" },
  logger: { metric: () => {} },
}

describe("selectProvider", () => {
  test("selects byok provider when provider credentials exist", () => {
    const modelInfo = {
      id: "gpt-4o",
      byokProvider: "openai",
      providers: [{ id: "openai", model: "gpt-4o" }],
    }
    const result = selectProvider(
      "gpt-4o",
      baseZenData,
      { provider: { credentials: {} } },
      modelInfo,
      "1.2.3.4",
      "",
      undefined,
      { excludeProviders: [], retryCount: 0 },
      undefined,
      undefined,
      baseDeps,
    )
    expect(result.id).toBe("openai")
    expect(result.format).toBe("openai")
  })

  test("selects sticky provider", () => {
    const modelInfo = {
      id: "gpt-4o",
      providers: [
        { id: "openai", model: "gpt-4o", priority: 0, weight: 1 },
        { id: "anthropic", model: "gpt-4o", priority: 0, weight: 1 },
      ],
    }
    const result = selectProvider(
      "gpt-4o",
      baseZenData,
      {},
      modelInfo,
      "1.2.3.4",
      "",
      undefined,
      { excludeProviders: [], retryCount: 0 },
      "anthropic",
      undefined,
      baseDeps,
    )
    expect(result.id).toBe("anthropic")
  })

  test("selects trial provider", () => {
    const modelInfo = {
      id: "gpt-4o",
      providers: [
        { id: "openai", model: "gpt-4o", priority: 0, weight: 1 },
        { id: "google", model: "gpt-4o", priority: 0, weight: 1 },
      ],
    }
    const result = selectProvider(
      "gpt-4o",
      baseZenData,
      {},
      modelInfo,
      "1.2.3.4",
      "",
      ["google"],
      { excludeProviders: [], retryCount: 0 },
      undefined,
      undefined,
      baseDeps,
    )
    expect(result.id).toBe("google")
  })

  test("throws when no provider available", () => {
    const modelInfo = { id: "missing", providers: [], fallbackProvider: "nonexistent" }
    expect(() =>
      selectProvider(
        "missing",
        { providers: {} },
        {},
        modelInfo,
        "1.2.3.4",
        "",
        undefined,
        { excludeProviders: [], retryCount: 0 },
        undefined,
        undefined,
        baseDeps,
      ),
    ).toThrow("zen.api.error.noProviderAvailable")
  })

  test("throws when selected provider not in zenData", () => {
    const modelInfo = { id: "x", providers: [{ id: "missing", model: "x" }], fallbackProvider: "missing" }
    expect(() =>
      selectProvider(
        "x",
        { providers: {} },
        {},
        modelInfo,
        "1.2.3.4",
        "",
        undefined,
        { excludeProviders: [], retryCount: 0 },
        undefined,
        undefined,
        baseDeps,
      ),
    ).toThrow("zen.api.error.providerNotSupported")
  })

  test("returns highest-priority provider when none excluded", () => {
    const modelInfo = {
      id: "gpt-4o",
      providers: [
        { id: "openai", model: "gpt-4o", priority: 1, weight: 1 },
        { id: "anthropic", model: "gpt-4o", priority: 0, weight: 1 },
      ],
    }
    const result = selectProvider(
      "gpt-4o",
      baseZenData,
      {},
      modelInfo,
      "1.2.3.4",
      "",
      undefined,
      { excludeProviders: [], retryCount: 0 },
      undefined,
      undefined,
      baseDeps,
    )
    expect(result.id).toBe("anthropic")
  })

  test("excludes providers on retry", () => {
    const modelInfo = {
      id: "gpt-4o",
      providers: [
        { id: "openai", model: "gpt-4o", priority: 0, weight: 1 },
        { id: "anthropic", model: "gpt-4o", priority: 0, weight: 1 },
      ],
    }
    const result = selectProvider(
      "gpt-4o",
      baseZenData,
      {},
      modelInfo,
      "1.2.3.4",
      "",
      undefined,
      { excludeProviders: ["anthropic"], retryCount: 0 },
      undefined,
      undefined,
      baseDeps,
    )
    expect(result.id).toBe("openai")
  })

  test("selects fallback provider after max retries", () => {
    const modelInfo = {
      id: "gpt-4o",
      providers: [
        { id: "openai", model: "gpt-4o", priority: 0, weight: 1 },
        { id: "anthropic", model: "gpt-4o", priority: 0, weight: 1 },
      ],
      fallbackProvider: "openai",
    }
    const result = selectProvider(
      "gpt-4o",
      baseZenData,
      {},
      modelInfo,
      "1.2.3.4",
      "",
      undefined,
      { excludeProviders: [], retryCount: 3 },
      undefined,
      undefined,
      baseDeps,
    )
    expect(result.id).toBe("openai")
  })
})
