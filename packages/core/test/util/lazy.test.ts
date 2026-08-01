import { describe, expect, test } from "bun:test"
import { lazy } from "@opencode-ai/core/util/lazy"

describe("lazy", () => {
  test("calls wrapped function only once across multiple invocations", () => {
    let count = 0
    const get = lazy(() => {
      count++
      return "value"
    })
    get()
    get()
    get()
    expect(count).toBe(1)
  })

  test("returns the computed value on every call", () => {
    const get = lazy(() => 42)
    expect(get()).toBe(42)
    expect(get()).toBe(42)
  })

  test("does not call wrapped function until first invocation", () => {
    let called = false
    const get = lazy(() => {
      called = true
      return "x"
    })
    expect(called).toBe(false)
    get()
    expect(called).toBe(true)
  })

  test("memoizes falsy values correctly", () => {
    let count = 0
    const get = lazy(() => {
      count++
      return 0
    })
    expect(get()).toBe(0)
    expect(get()).toBe(0)
    expect(count).toBe(1)
  })

  test("returns same object reference across calls", () => {
    const obj = { a: 1 }
    const get = lazy(() => obj)
    expect(get()).toBe(get())
  })
})
