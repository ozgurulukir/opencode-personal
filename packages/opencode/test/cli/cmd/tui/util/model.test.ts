import { describe, expect, test } from "bun:test"
import type { Model, Provider } from "@opencode-ai/sdk/v2"
import { get, index, name } from "../../../../../src/cli/cmd/tui/util/model"

function model(providerID: string, id: string, name: string): Model {
  const modalities = { text: true, audio: false, image: false, video: false, pdf: false }
  return {
    id,
    providerID,
    name,
    api: { id, url: "https://example.com", npm: "@ai-sdk/openai-compatible" },
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: modalities,
      output: modalities,
      interleaved: false,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 4096 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
  }
}

const mockProviders: Provider[] = [
  {
    id: "openai",
    name: "OpenAI",
    source: "config",
    env: [],
    options: {},
    models: {
      "gpt-4o": model("openai", "gpt-4o", "GPT-4o"),
      "gpt-4o-mini": model("openai", "gpt-4o-mini", "GPT-4o Mini"),
    },
  },
  {
    id: "anthropic",
    name: "Anthropic",
    source: "config",
    env: [],
    options: {},
    models: {
      "claude-3-5-sonnet": model("anthropic", "claude-3-5-sonnet", "Claude 3.5 Sonnet"),
    },
  },
]

describe("tui util model", () => {
  describe("index", () => {
    test("returns empty Map when input is undefined", () => {
      const result = index(undefined)
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })

    test("returns empty Map when input is empty array", () => {
      const result = index([])
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })

    test("indexes providers by id into a Map", () => {
      const result = index(mockProviders)
      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(2)
      expect(result.get("openai")).toBe(mockProviders[0])
      expect(result.get("anthropic")).toBe(mockProviders[1])
    })
  })

  describe("get", () => {
    test("returns undefined when list is undefined", () => {
      expect(get(undefined, "openai", "gpt-4o")).toBeUndefined()
    })

    test("retrieves model from Array provider list when provider and model exist", () => {
      const model = get(mockProviders, "openai", "gpt-4o")
      expect(model).toMatchObject({
        id: "gpt-4o",
        name: "GPT-4o",
      })
    })

    test("retrieves model from Map provider list when provider and model exist", () => {
      const providerMap = index(mockProviders)
      const model = get(providerMap, "anthropic", "claude-3-5-sonnet")
      expect(model).toMatchObject({
        id: "claude-3-5-sonnet",
        name: "Claude 3.5 Sonnet",
      })
    })

    test("returns undefined when providerID does not exist in Array list", () => {
      expect(get(mockProviders, "nonexistent", "gpt-4o")).toBeUndefined()
    })

    test("returns undefined when providerID does not exist in Map list", () => {
      const providerMap = index(mockProviders)
      expect(get(providerMap, "nonexistent", "gpt-4o")).toBeUndefined()
    })

    test("returns undefined when modelID does not exist in provider models", () => {
      expect(get(mockProviders, "openai", "nonexistent-model")).toBeUndefined()
      const providerMap = index(mockProviders)
      expect(get(providerMap, "openai", "nonexistent-model")).toBeUndefined()
    })
  })

  describe("name", () => {
    test("returns model name when model is found in Array list", () => {
      expect(name(mockProviders, "openai", "gpt-4o")).toBe("GPT-4o")
    })

    test("returns model name when model is found in Map list", () => {
      const providerMap = index(mockProviders)
      expect(name(providerMap, "anthropic", "claude-3-5-sonnet")).toBe("Claude 3.5 Sonnet")
    })

    test("falls back to modelID when model or provider is not found", () => {
      expect(name(mockProviders, "openai", "unknown-model")).toBe("unknown-model")
      expect(name(mockProviders, "unknown-provider", "gpt-4o")).toBe("gpt-4o")
      expect(name(undefined, "openai", "gpt-4o")).toBe("gpt-4o")
    })
  })
})
