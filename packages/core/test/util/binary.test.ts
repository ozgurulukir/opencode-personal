import { describe, expect, test } from "bun:test"
import { Binary } from "@opencode-ai/core/util/binary"

const compare = (item: { id: string }) => item.id

describe("Binary.search", () => {
  test("returns index 0 and not found for empty array", () => {
    expect(Binary.search([], "a", compare)).toEqual({ found: false, index: 0 })
  })

  test("finds element in single-item array", () => {
    const arr = [{ id: "b" }]
    expect(Binary.search(arr, "b", compare)).toEqual({ found: true, index: 0 })
  })

  test("returns insertion index when not found in single-item array", () => {
    const arr = [{ id: "b" }]
    expect(Binary.search(arr, "a", compare)).toEqual({ found: false, index: 0 })
    expect(Binary.search(arr, "c", compare)).toEqual({ found: false, index: 1 })
  })

  test("finds first element", () => {
    const arr = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(Binary.search(arr, "a", compare)).toEqual({ found: true, index: 0 })
  })

  test("finds middle element", () => {
    const arr = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(Binary.search(arr, "b", compare)).toEqual({ found: true, index: 1 })
  })

  test("finds last element", () => {
    const arr = [{ id: "a" }, { id: "b" }, { id: "c" }]
    expect(Binary.search(arr, "c", compare)).toEqual({ found: true, index: 2 })
  })

  test("returns correct insertion index when not found", () => {
    const arr = [{ id: "a" }, { id: "c" }, { id: "e" }]
    expect(Binary.search(arr, "b", compare)).toEqual({ found: false, index: 1 })
    expect(Binary.search(arr, "d", compare)).toEqual({ found: false, index: 2 })
    expect(Binary.search(arr, "f", compare)).toEqual({ found: false, index: 3 })
  })

  test("works with numeric string comparison", () => {
    const arr = [{ id: "1" }, { id: "10" }, { id: "2" }]
    expect(Binary.search(arr, "10", compare)).toEqual({ found: true, index: 1 })
  })
})

describe("Binary.insert", () => {
  test("inserts into empty array", () => {
    const arr: { id: string }[] = []
    const result = Binary.insert(arr, { id: "a" }, compare)
    expect(result).toEqual([{ id: "a" }])
    expect(result).toBe(arr)
  })

  test("inserts at beginning", () => {
    const arr = [{ id: "b" }, { id: "c" }]
    Binary.insert(arr, { id: "a" }, compare)
    expect(arr.map(compare)).toEqual(["a", "b", "c"])
  })

  test("inserts in middle", () => {
    const arr = [{ id: "a" }, { id: "c" }]
    Binary.insert(arr, { id: "b" }, compare)
    expect(arr.map(compare)).toEqual(["a", "b", "c"])
  })

  test("inserts at end", () => {
    const arr = [{ id: "a" }, { id: "b" }]
    Binary.insert(arr, { id: "c" }, compare)
    expect(arr.map(compare)).toEqual(["a", "b", "c"])
  })

  test("mutates array in place and returns same reference", () => {
    const arr = [{ id: "a" }]
    const result = Binary.insert(arr, { id: "b" }, compare)
    expect(result).toBe(arr)
    expect(arr.length).toBe(2)
  })

  test("inserts duplicate before existing equal element", () => {
    const arr = [{ id: "a" }, { id: "b" }]
    Binary.insert(arr, { id: "b" }, compare)
    expect(arr.length).toBe(3)
    expect(arr[1]!.id).toBe("b")
    expect(arr[2]!.id).toBe("b")
  })

  test("maintains sorted order across multiple inserts", () => {
    const arr: { id: string }[] = []
    for (const id of ["d", "a", "c", "b", "e"]) {
      Binary.insert(arr, { id }, compare)
    }
    expect(arr.map(compare)).toEqual(["a", "b", "c", "d", "e"])
  })
})
