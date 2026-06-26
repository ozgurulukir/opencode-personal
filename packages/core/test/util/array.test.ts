import { describe, expect, test } from "bun:test"
import { findLast } from "@opencode-ai/core/util/array"

describe("findLast", () => {
  test("returns undefined for empty array", () => {
    expect(findLast([], (x) => x > 0)).toBeUndefined()
  })

  test("finds last matching element", () => {
    expect(findLast([1, 2, 3, 2, 1], (x) => x === 2)).toBe(2)
  })

  test("returns undefined when no match", () => {
    expect(findLast([1, 2, 3], (x) => x > 5)).toBeUndefined()
  })

  test("passes index and array to predicate", () => {
    const results: { index: number; items: number[] }[] = []
    findLast([10, 20, 30], (item, index, items) => {
      results.push({ index, items: [...items] })
      return item === 20
    })
    expect(results.length).toBe(2)
    expect(results[0]!.index).toBe(2)
    expect(results[1]!.index).toBe(1)
  })

  test("returns last element when predicate always true", () => {
    expect(findLast([1, 2, 3], () => true)).toBe(3)
  })
})
