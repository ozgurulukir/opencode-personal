import { describe, expect, test } from "bun:test"
import type { Provider } from "@opencode-ai/sdk/v2"
import { get, index, name } from "../../../../../src/cli/cmd/tui/util/model"

const mockProviders: Provider[] = [
  {
    id: "openai",
    name: "OpenAI",
    models: {
      "gpt-4o": {
        id: "gpt-4o",
        name: "GPT-4o",
      } as any,
      "gpt-4o-mini": {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
      } as any,
    },
  } as any,
  {
    id: "anthropic",
    name: "Anthropic",
    models: {
      "claude-3-5-sonnet": {
        id: "claude-3-5-sonnet",
        name: "Claude 3.5 Sonnet",
      } as any,
    },
  } as any,
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
      expect(model).toEqual({
        id: "gpt-4o",
        name: "GPT-4o",
      } as any)
    })

    test("retrieves model from Map provider list when provider and model exist", () => {
      const providerMap = index(mockProviders)
      const model = get(providerMap, "anthropic", "claude-3-5-sonnet")
      expect(model).toEqual({
        id: "claude-3-5-sonnet",
        name: "Claude 3.5 Sonnet",
      } as any)
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
