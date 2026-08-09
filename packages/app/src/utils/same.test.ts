import { describe, expect, test } from "bun:test"
import { same } from "./same"

describe("same", () => {
  test("returns true for same reference", () => {
    const arr = [1, 2, 3]
    expect(same(arr, arr)).toBe(true)
  })

  test("returns true for both undefined", () => {
    expect(same(undefined, undefined)).toBe(true)
  })

  test("returns false if one is undefined", () => {
    expect(same([1, 2], undefined)).toBe(false)
    expect(same(undefined, [1, 2])).toBe(false)
  })

  test("returns false for different lengths", () => {
    expect(same([1, 2], [1, 2, 3])).toBe(false)
    expect(same([1, 2, 3], [1, 2])).toBe(false)
  })

  test("returns true for identical empty arrays", () => {
    expect(same([], [])).toBe(true)
  })

  test("returns true for different arrays with identical primitive elements", () => {
    expect(same([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(same(["a", "b"], ["a", "b"])).toBe(true)
  })

  test("returns false for arrays with different elements", () => {
    expect(same([1, 2, 3], [1, 4, 3])).toBe(false)
  })

  test("checks object references strictly", () => {
    const obj1 = { id: 1 }
    const obj2 = { id: 2 }
    expect(same([obj1, obj2], [obj1, obj2])).toBe(true)

    // Different objects with same values should fail because of `===` comparison
    expect(same([obj1], [{ id: 1 }])).toBe(false)
  })
})
