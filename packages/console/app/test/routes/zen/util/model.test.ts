import { describe, expect, test } from "bun:test"
import { validateModel } from "../../../../src/routes/zen/util/model"

describe("validateModel", () => {
  test("returns model when found", () => {
    const zenData = {
      models: {
        "gpt-4o": { name: "GPT-4o", allowAnonymous: true },
      },
    }
    const result = validateModel(zenData, "gpt-4o", { format: "openai", t: (key) => key })
    expect(result.id).toBe("gpt-4o")
    expect(result.name).toBe("GPT-4o")
  })

  test("throws when model not found", () => {
    const zenData = { models: {} }
    expect(() => validateModel(zenData, "missing", { format: "openai", t: (key) => key })).toThrow(
      "zen.api.error.modelNotSupported",
    )
  })

  test("throws when format not supported", () => {
    const zenData = {
      models: {
        "gpt-4o": [{ formatFilter: "openai" }, { formatFilter: "other" }],
      },
    }
    expect(() => validateModel(zenData, "gpt-4o", { format: "anthropic", t: (key) => key })).toThrow(
      "zen.api.error.modelFormatNotSupported",
    )
  })

  test("throws when trial ended", () => {
    const zenData = {
      models: {
        "alpha-model": { name: "Alpha", trialEnded: true },
      },
    }
    expect(() => validateModel(zenData, "alpha-model", { format: "openai", t: (key) => key })).toThrow(
      "zen.api.error.trialEnded",
    )
  })
})
