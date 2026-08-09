import { describe, expect, test } from "bun:test"
import { iife } from "@opencode-ai/core/util/iife"

describe("iife", () => {
  test("invokes the callback and returns its result", () => {
    let invoked = false
    const result = iife(() => {
      invoked = true
      return "success"
    })

    expect(invoked).toBe(true)
    expect(result).toBe("success")
  })

  test("propagates errors thrown from the callback", () => {
    const error = new Error("Test error")
    expect(() => {
      iife(() => {
        throw error
      })
    }).toThrow(error)
  })
})
