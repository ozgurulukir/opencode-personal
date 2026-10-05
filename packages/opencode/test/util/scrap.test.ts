import { describe, expect, test, spyOn } from "bun:test"
import { bar, dummyFunction, foo, randomHelper } from "../../src/util/scrap"

describe("util.scrap", () => {
  test("foo should equal '42'", () => {
    expect(foo).toBe("42")
  })

  test("bar should equal 123", () => {
    expect(bar).toBe(123)
  })

  test("dummyFunction should execute without throwing and log to console", () => {
    const spy = spyOn(console, "log").mockImplementation(() => {})
    try {
      expect(() => dummyFunction()).not.toThrow()
      expect(spy).toHaveBeenCalledWith("This is a dummy function")
    } finally {
      spy.mockRestore()
    }
  })

  test("randomHelper should return boolean based on Math.random", () => {
    const spy = spyOn(Math, "random")
    try {
      spy.mockReturnValue(0.6)
      expect(randomHelper()).toBe(true)

      spy.mockReturnValue(0.4)
      expect(randomHelper()).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})
