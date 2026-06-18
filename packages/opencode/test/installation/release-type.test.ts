import { test, expect, describe } from "bun:test"
import { getReleaseType } from "../../src/installation/index"

describe("getReleaseType", () => {
  test("returns major when major version increases", () => {
    expect(getReleaseType("1.0.0", "2.0.0")).toBe("major")
  })

  test("returns minor when minor version increases but major stays the same", () => {
    expect(getReleaseType("1.0.0", "1.1.0")).toBe("minor")
  })

  test("returns patch when only patch version increases", () => {
    expect(getReleaseType("1.0.0", "1.0.1")).toBe("patch")
  })

  test("returns minor when minor increases and patch also changes", () => {
    expect(getReleaseType("1.2.3", "1.3.0")).toBe("minor")
  })

  test("returns patch when patch increases within same major.minor", () => {
    expect(getReleaseType("1.2.3", "1.2.5")).toBe("patch")
  })

  test("returns patch when versions are identical", () => {
    expect(getReleaseType("1.0.0", "1.0.0")).toBe("patch")
  })

  test("returns major for jump across major with minor and patch change", () => {
    expect(getReleaseType("0.9.0", "1.0.0")).toBe("major")
  })
})
