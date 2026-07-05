import { describe, expect, test } from "bun:test"
import { ConsoleState } from "@/config/console-state"

describe("ConsoleState Schema", () => {
  test("parses valid state", () => {
    const valid = {
      consoleManagedProviders: ["openai", "anthropic"],
      activeOrgName: "my-org",
      switchableOrgCount: 3,
    }
    const result = ConsoleState.zod.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.consoleManagedProviders).toEqual(valid.consoleManagedProviders)
      expect(result.data.activeOrgName).toBe(valid.activeOrgName)
      expect(result.data.switchableOrgCount).toBe(valid.switchableOrgCount)
    }
  })

  test("rejects negative switchableOrgCount", () => {
    const invalid = {
      consoleManagedProviders: [],
      switchableOrgCount: -1,
    }
    const result = ConsoleState.zod.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  test("accepts empty activeOrgName when optional", () => {
    const valid = {
      consoleManagedProviders: [],
      switchableOrgCount: 0,
    }
    const result = ConsoleState.zod.safeParse(valid)
    expect(result.success).toBe(true)
  })
})
