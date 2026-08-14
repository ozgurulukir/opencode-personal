import { describe, expect, test } from "bun:test"
import { modelSelectStale, selectApply, variantSelectStale } from "@/cli/cmd/run/footer.shared"

const model = (providerID: string, modelID: string) => ({ providerID, modelID })

describe("selectApply (characterization of footer select handlers)", () => {
  test("empty result produces no actions", () => {
    expect(selectApply({})).toEqual([])
  })

  test("clears variants when the result explicitly carries variants: undefined", () => {
    expect(selectApply({ variants: undefined })).toEqual([{ type: "variants", variants: [] }])
  })

  test("applies variant value including explicit undefined (reset to default)", () => {
    expect(selectApply({ variant: undefined })).toEqual([{ type: "variant", variant: undefined }])
    expect(selectApply({ variant: "high" })).toEqual([{ type: "variant", variant: "high" }])
  })

  test("emits variants, then variant, then a combined patch, in order", () => {
    expect(selectApply({ variants: ["low", "high"], variant: "high", modelLabel: "GPT-5 high", status: "ready" })).toEqual([
      { type: "variants", variants: ["low", "high"] },
      { type: "variant", variant: "high" },
      { type: "patch", patch: { model: "GPT-5 high", status: "ready" } },
    ])
  })

  test("emits no patch action when neither modelLabel nor status is set", () => {
    expect(selectApply({ modelLabel: undefined, status: undefined })).toEqual([])
    expect(selectApply({ status: "" })).toEqual([])
  })
})

describe("modelSelectStale (characterization)", () => {
  test("stale when current model is unset", () => {
    expect(modelSelectStale(undefined, model("anthropic", "claude-3"))).toBe(true)
  })

  test("stale on provider or model mismatch (user picked another model in flight)", () => {
    expect(modelSelectStale(model("openai", "gpt-5"), model("anthropic", "claude-3"))).toBe(true)
    expect(modelSelectStale(model("anthropic", "claude-4"), model("anthropic", "claude-3"))).toBe(true)
  })

  test("fresh when current matches the selection", () => {
    expect(modelSelectStale(model("anthropic", "claude-3"), model("anthropic", "claude-3"))).toBe(false)
  })
})

describe("variantSelectStale (characterization of the asymmetric variant guard)", () => {
  test("never stale when no model was set at select time", () => {
    expect(variantSelectStale(model("openai", "gpt-5"), undefined)).toBe(false)
    expect(variantSelectStale(undefined, undefined)).toBe(false)
  })

  test("stale when a model was captured at select time but current is unset or changed", () => {
    expect(variantSelectStale(undefined, model("openai", "gpt-5"))).toBe(true)
    expect(variantSelectStale(model("anthropic", "claude-3"), model("openai", "gpt-5"))).toBe(true)
  })

  test("fresh when current still matches the model captured at select time", () => {
    expect(variantSelectStale(model("openai", "gpt-5"), model("openai", "gpt-5"))).toBe(false)
  })
})
