import { describe, expect, test } from "bun:test"
import { cleanPrediction } from "@/session/prompt"

describe("cleanPrediction", () => {
  test("returns empty string for empty input", () => {
    expect(cleanPrediction("")).toBe("")
    expect(cleanPrediction("   \n  \t  ")).toBe("")
  })

  test("takes the first non-empty line", () => {
    expect(cleanPrediction("\n\n  looks good, push it  \nfollow up: also...").trim()).toBe("looks good, push it")
  })

  test("strips <think>...</think> blocks the model may emit", () => {
    const input = `<think>The user probably wants a follow-up about tests.</think>add tests for this`
    expect(cleanPrediction(input)).toBe("add tests for this")
  })

  test("strips <think> block even when it spans multiple lines", () => {
    const input = `<think>\nmulti\nline\nthink\n</think>\ncommit and push`
    expect(cleanPrediction(input)).toBe("commit and push")
  })

  test("strips matching surrounding quotes", () => {
    expect(cleanPrediction('"push it"')).toBe("push it")
    expect(cleanPrediction("'ship it'")).toBe("ship it")
    expect(cleanPrediction("`commit`")).toBe("commit")
  })

  test("does not strip unbalanced or internal quotes", () => {
    expect(cleanPrediction(`it's broken`)).toBe(`it's broken`)
    expect(cleanPrediction(`he said "hi" and left`)).toBe(`he said "hi" and left`)
  })

  test("truncates long predictions to 120 chars with ellipsis", () => {
    const long = "a".repeat(200)
    const out = cleanPrediction(long)
    expect(out.length).toBe(120)
    expect(out.endsWith("...")).toBe(true)
  })

  test("does not truncate at exactly 120 chars", () => {
    const exact = "a".repeat(120)
    expect(cleanPrediction(exact)).toBe(exact)
  })

  test("preserves short predictions unchanged", () => {
    expect(cleanPrediction("add tests")).toBe("add tests")
  })
})
