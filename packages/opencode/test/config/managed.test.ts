import { test, expect } from "bun:test"
import { parseManagedPlist, managedConfigDir } from "../../src/config/managed"

// ---- parseManagedPlist ----

test("returns JSON string with PLIST_META keys stripped", () => {
  const input = JSON.stringify({
    PayloadDisplayName: "Managed Preferences",
    PayloadIdentifier: "ai.opencode.managed",
    model: "managed/model",
    theme: "managed/theme",
  })
  const result = parseManagedPlist(input)
  const parsed = JSON.parse(result)
  expect(parsed.model).toBe("managed/model")
  expect(parsed.theme).toBe("managed/theme")
  expect("PayloadDisplayName" in parsed).toBe(false)
  expect("PayloadIdentifier" in parsed).toBe(false)
})

test("returns JSON unchanged when no PLIST_META keys present", () => {
  const input = JSON.stringify({ model: "managed/model", theme: "managed/theme" })
  const result = parseManagedPlist(input)
  expect(JSON.parse(result)).toEqual({ model: "managed/model", theme: "managed/theme" })
})

test("handles empty object", () => {
  const result = parseManagedPlist("{}")
  expect(result).toBe("{}")
})

test("strips all PLIST_META keys", () => {
  const input = JSON.stringify({
    PayloadDisplayName: "x",
    PayloadIdentifier: "y",
    PayloadType: "z",
    PayloadUUID: "u",
    PayloadVersion: "v",
    _manualProfile: "m",
  })
  const result = parseManagedPlist(input)
  expect(result).toBe("{}")
})

// ---- managedConfigDir ----

test("returns the OPENCODE_TEST_MANAGED_CONFIG_DIR env override when set", () => {
  const original = process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR
  process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = "/custom/managed"
  try {
    expect(managedConfigDir()).toBe("/custom/managed")
  } finally {
    if (original === undefined) delete process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR
    else process.env.OPENCODE_TEST_MANAGED_CONFIG_DIR = original
  }
})
