import { describe, expect, test } from "bun:test"
import { Avatar } from "./avatar"

describe("Avatar component rendering logic", () => {
  test("Avatar is defined as a component function", () => {
    expect(typeof Avatar).toBe("function")
  })
})
