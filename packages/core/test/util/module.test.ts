import { describe, expect, test } from "bun:test"
import { Module } from "@opencode-ai/core/util/module"

describe("Module.resolve", () => {
  test("resolves module relative to directory with package.json", async () => {
    const resolved = Module.resolve("node:os", __dirname)
    expect(resolved).toBeDefined()
    expect(typeof resolved).toBe("string")
  })

  test("returns undefined when resolving nonexistent module", () => {
    const resolved = Module.resolve("nonexistent-pkg-xyz-abc", __dirname)
    expect(resolved).toBeUndefined()
  })

  test("does not throw on nonexistent module", () => {
    expect(() => Module.resolve("nonexistent-pkg-xyz-abc", __dirname)).not.toThrow()
  })
})
