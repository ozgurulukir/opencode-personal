import { describe, expect, test } from "bun:test"
import { MergeOptions } from "@/session/merge-options"

describe("MergeOptions.mergeOptions", () => {
  test("base options are overridden by model.options", () => {
    const result = MergeOptions.mergeOptions({ a: 1 }, { a: 2 })
    expect(result).toEqual({ a: 2 })
  })

  test("nested keys are merged deeply (not replaced)", () => {
    const result = MergeOptions.mergeOptions({ x: { a: 1, b: 2 } }, { x: { b: 3, c: 4 } })
    expect(result).toEqual({ x: { a: 1, b: 3, c: 4 } })
  })

  test("undefined source does not modify target", () => {
    const result = MergeOptions.mergeOptions({ a: 1 }, undefined)
    expect(result).toEqual({ a: 1 })
  })

  test("empty object source does not modify target", () => {
    const result = MergeOptions.mergeOptions({ a: 1 }, {})
    expect(result).toEqual({ a: 1 })
  })

  test("arrays from source replace target arrays", () => {
    // remeda mergeDeep replaces arrays, does not merge them
    const result = MergeOptions.mergeOptions({ items: [1, 2, 3] }, { items: [4, 5] })
    expect(result).toEqual({ items: [4, 5] })
  })

  test("three-layer merge: base -> model -> agent preserves all layers", () => {
    const base = { temperature: 0.7, maxTokens: 1000, headers: { "X-Custom": "base" } }
    const model = { temperature: 0.5, topP: 0.9, headers: { "X-Model": "v1" } }
    const agent = { topP: 0.8, stop: ["END"], headers: { "X-Agent": "build" } }

    const result = MergeOptions.mergeOptions(
      MergeOptions.mergeOptions(base, model),
      agent,
    )

    expect(result).toEqual({
      temperature: 0.5, // overridden by model
      maxTokens: 1000, // preserved from base
      topP: 0.8, // overridden by agent
      stop: ["END"], // added by agent
      headers: {
        "X-Custom": "base", // preserved from base
        "X-Model": "v1", // added by model
        "X-Agent": "build", // added by agent
      },
    })
  })
})
