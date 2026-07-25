import { describe, expect, test } from "bun:test"
import { ProviderID, ModelID } from "../../src/provider/schema"

// Characterization tests for session-config pure functions.
// These lock down behavior before extraction from agent.ts.

describe("sortProvidersByName", () => {
  test("sorts providers alphabetically by name (case-insensitive)", async () => {
    const { sortProvidersByName } = await import("../../src/acp/session-config")
    const result = sortProvidersByName([
      { id: "z", name: "Zebra" },
      { id: "a", name: "alpha" },
      { id: "m", name: "Mongo" },
    ])
    expect(result.map((p) => p.id)).toEqual(["a", "m", "z"])
  })

  test("does not mutate original array", async () => {
    const { sortProvidersByName } = await import("../../src/acp/session-config")
    const original = [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }]
    const copy = [...original]
    sortProvidersByName(original)
    expect(original).toEqual(copy)
  })
})

describe("modelVariantsFromProviders", () => {
  test("returns variant keys for matching model", async () => {
    const { modelVariantsFromProviders } = await import("../../src/acp/session-config")
    const providers = [
      {
        id: "anthropic",
        models: {
          "claude-sonnet-4": { variants: { high: {}, low: {} } },
        },
      },
    ]
    const result = modelVariantsFromProviders(providers, {
      providerID: ProviderID.make("anthropic"),
      modelID: ModelID.make("claude-sonnet-4"),
    })
    expect(result).toEqual(["high", "low"])
  })

  test("returns empty when provider not found", async () => {
    const { modelVariantsFromProviders } = await import("../../src/acp/session-config")
    const result = modelVariantsFromProviders([], {
      providerID: ProviderID.make("openai"),
      modelID: ModelID.make("gpt-4"),
    })
    expect(result).toEqual([])
  })

  test("returns empty when model has no variants", async () => {
    const { modelVariantsFromProviders } = await import("../../src/acp/session-config")
    const providers = [{ id: "anthropic", models: { "claude-3-opus": {} } }]
    const result = modelVariantsFromProviders(providers, {
      providerID: ProviderID.make("anthropic"),
      modelID: ModelID.make("claude-3-opus"),
    })
    expect(result).toEqual([])
  })
})

describe("buildAvailableModels", () => {
  test("builds model list from providers", async () => {
    const { buildAvailableModels } = await import("../../src/acp/session-config")
    const providers = [
      {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-3-opus": { id: "claude-3-opus", name: "Opus" },
        },
      },
    ]
    const result = buildAvailableModels(providers as any)
    expect(result).toEqual([{ modelId: "anthropic/claude-3-opus", name: "Anthropic/Opus" }])
  })

  test("includes variants when option set", async () => {
    const { buildAvailableModels } = await import("../../src/acp/session-config")
    const providers = [
      {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-sonnet-4": {
            id: "claude-sonnet-4",
            name: "Sonnet 4",
            variants: { high: {}, low: {} },
          },
        },
      },
    ]
    const result = buildAvailableModels(providers as any, { includeVariants: true })
    expect(result.length).toBe(3) // base + 2 variants (excluding "default")
    expect(result[0].modelId).toBe("anthropic/claude-sonnet-4")
    expect(result[1].modelId).toBe("anthropic/claude-sonnet-4/high")
    expect(result[2].modelId).toBe("anthropic/claude-sonnet-4/low")
  })

  test("excludes 'default' variant from list", async () => {
    const { buildAvailableModels } = await import("../../src/acp/session-config")
    const providers = [
      {
        id: "anthropic",
        name: "Anthropic",
        models: {
          "claude-sonnet-4": {
            id: "claude-sonnet-4",
            name: "Sonnet 4",
            variants: { default: {}, high: {} },
          },
        },
      },
    ]
    const result = buildAvailableModels(providers as any, { includeVariants: true })
    expect(result.length).toBe(2) // base + 1 variant (default excluded)
    expect(result.map((m) => m.modelId)).toEqual([
      "anthropic/claude-sonnet-4",
      "anthropic/claude-sonnet-4/high",
    ])
  })
})

describe("formatModelIdWithVariant", () => {
  test("returns base modelId when no variants", async () => {
    const { formatModelIdWithVariant } = await import("../../src/acp/session-config")
    const result = formatModelIdWithVariant(
      { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-3-opus") },
      undefined,
      [],
      false,
    )
    expect(result).toBe("anthropic/claude-3-opus")
  })

  test("appends selected variant", async () => {
    const { formatModelIdWithVariant } = await import("../../src/acp/session-config")
    const result = formatModelIdWithVariant(
      { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-sonnet-4") },
      "high",
      ["high", "low"],
      true,
    )
    expect(result).toBe("anthropic/claude-sonnet-4/high")
  })

  test("falls back to 'default' variant when selected not available", async () => {
    const { formatModelIdWithVariant } = await import("../../src/acp/session-config")
    const result = formatModelIdWithVariant(
      { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-sonnet-4") },
      "medium",
      ["default", "high"],
      true,
    )
    expect(result).toBe("anthropic/claude-sonnet-4/default")
  })

  test("falls back to first variant when no default", async () => {
    const { formatModelIdWithVariant } = await import("../../src/acp/session-config")
    const result = formatModelIdWithVariant(
      { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-sonnet-4") },
      undefined,
      ["high", "low"],
      true,
    )
    expect(result).toBe("anthropic/claude-sonnet-4/high")
  })
})

describe("buildVariantMeta", () => {
  test("builds meta with variant info", async () => {
    const { buildVariantMeta } = await import("../../src/acp/session-config")
    const result = buildVariantMeta({
      model: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-sonnet-4") },
      variant: "high",
      availableVariants: ["high", "low"],
    })
    expect(result).toEqual({
      opencode: {
        modelId: "anthropic/claude-sonnet-4",
        variant: "high",
        availableVariants: ["high", "low"],
      },
    })
  })

  test("variant is null when undefined", async () => {
    const { buildVariantMeta } = await import("../../src/acp/session-config")
    const result = buildVariantMeta({
      model: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-3-opus") },
      availableVariants: [],
    })
    expect(result.opencode.variant).toBeNull()
  })
})

describe("parseModelSelection", () => {
  test("parses simple provider/model", async () => {
    const { parseModelSelection } = await import("../../src/acp/session-config")
    const providers = [{ id: "anthropic", models: { "claude-3-opus": {} } }]
    const result = parseModelSelection("anthropic/claude-3-opus", providers)
    expect(result.model.providerID as string).toBe("anthropic")
    expect(result.model.modelID as string).toBe("claude-3-opus")
    expect(result.variant).toBeUndefined()
  })

  test("extracts variant from model/modelID/variant format", async () => {
    const { parseModelSelection } = await import("../../src/acp/session-config")
    const providers = [
      {
        id: "anthropic",
        models: {
          "claude-sonnet-4": { variants: { high: {}, low: {} } },
        },
      },
    ]
    const result = parseModelSelection("anthropic/claude-sonnet-4/high", providers)
    expect(result.model.modelID as string).toBe("claude-sonnet-4")
    expect(result.variant).toBe("high")
  })

  test("returns no variant when variant not in model variants", async () => {
    const { parseModelSelection } = await import("../../src/acp/session-config")
    const providers = [
      {
        id: "anthropic",
        models: {
          "claude-sonnet-4": { variants: { high: {} } },
        },
      },
    ]
    const result = parseModelSelection("anthropic/claude-sonnet-4/unknown", providers)
    expect(result.variant).toBeUndefined()
  })

  test("returns no variant when provider not found", async () => {
    const { parseModelSelection } = await import("../../src/acp/session-config")
    const result = parseModelSelection("openai/gpt-4", [])
    expect(result.variant).toBeUndefined()
  })
})

describe("formatVariantName", () => {
  test("capitalizes variant parts separated by hyphens", async () => {
    const { formatVariantName } = await import("../../src/acp/session-config")
    expect(formatVariantName("high-effort")).toBe("High Effort")
  })

  test("capitalizes variant parts separated by underscores", async () => {
    const { formatVariantName } = await import("../../src/acp/session-config")
    expect(formatVariantName("max_thinking")).toBe("Max Thinking")
  })

  test("handles single word", async () => {
    const { formatVariantName } = await import("../../src/acp/session-config")
    expect(formatVariantName("default")).toBe("Default")
  })
})

describe("buildConfigOptions", () => {
  test("always includes model option", async () => {
    const { buildConfigOptions } = await import("../../src/acp/session-config")
    const result = buildConfigOptions({
      currentModelId: "anthropic/claude-3-opus",
      availableModels: [{ modelId: "anthropic/claude-3-opus", name: "Anthropic/Opus" }],
    })
    expect(result.length).toBe(1)
    expect(result[0].id).toBe("model")
    expect(result[0].type).toBe("select")
  })

  test("includes effort option when variants available", async () => {
    const { buildConfigOptions } = await import("../../src/acp/session-config")
    const result = buildConfigOptions({
      currentModelId: "anthropic/claude-sonnet-4",
      availableModels: [],
      currentVariant: "high",
      availableVariants: ["high", "low"],
    })
    expect(result.length).toBe(2)
    expect(result[1].id).toBe("effort")
    expect(result[1].category).toBe("thought_level")
    expect(result[1].currentValue).toBe("high")
  })

  test("includes mode option when modes available", async () => {
    const { buildConfigOptions } = await import("../../src/acp/session-config")
    const result = buildConfigOptions({
      currentModelId: "anthropic/claude-3-opus",
      availableModels: [],
      modes: {
        availableModes: [{ id: "build", name: "Build" }, { id: "plan", name: "Plan" }],
        currentModeId: "build",
      },
    })
    expect(result.length).toBe(2)
    expect(result[1].id).toBe("mode")
    expect(result[1].category).toBe("mode")
  })

  test("includes all three options when all available", async () => {
    const { buildConfigOptions } = await import("../../src/acp/session-config")
    const result = buildConfigOptions({
      currentModelId: "anthropic/claude-sonnet-4",
      availableModels: [],
      currentVariant: "high",
      availableVariants: ["high", "low"],
      modes: {
        availableModes: [{ id: "build", name: "Build" }],
        currentModeId: "build",
      },
    })
    expect(result.length).toBe(3)
  })
})
