import { describe, expect, test } from "bun:test"
import { pickCycleNext } from "./cycler"

describe("pickCycleNext", () => {
  test("yields undefined for an empty list", () => {
    expect(pickCycleNext([], "a")).toBeUndefined()
  })

  test("restarts at the head when current is not in the list", () => {
    expect(pickCycleNext(["a", "b", "c"], "z")).toBe("a")
    expect(pickCycleNext(["a", "b", "c"], "")).toBe("a")
  })

  test("steps forward and wraps", () => {
    expect(pickCycleNext(["a", "b", "c"], "b")).toBe("c")
    expect(pickCycleNext(["a", "b", "c"], "c")).toBe("a")
  })

  test("steps backward and wraps", () => {
    expect(pickCycleNext(["a", "b", "c"], "a", -1)).toBe("c")
  })

  test("large directions wrap", () => {
    expect(pickCycleNext(["a", "b", "c", "d", "e"], "c", 7)).toBe("e")
    expect(pickCycleNext(["a", "b", "c", "d", "e"], "c", -7)).toBe("a")
  })

  test("direction defaults to forward", () => {
    expect(pickCycleNext(["a", "b"], "a")).toBe("b")
  })
})
