import { test, expect } from "bun:test"
import { ascending, descending, create, timestamp, Identifier } from "../../src/id/id"

// ---- create ----

test("create returns ID with correct prefix", () => {
  const id = create("evt", "ascending")
  expect(id.startsWith("evt_")).toBe(true)
})

test("create returns an ID of reasonable length", () => {
  const id = create("evt", "ascending")
  // 3-char prefix + "_" + 14 hex chars + 14 base62 chars = 32
  expect(id.length).toBeGreaterThanOrEqual(28)
  expect(id.length).toBeLessThanOrEqual(40)
})

test("create with a modern timestamp round-trips through timestamp", () => {
  const known = 1_700_000_000_000
  const id = create("evt", "ascending", known)
  expect(timestamp(id)).toBe(known)
})

// ---- ascending / descending ----

test("ascending and descending generate valid IDs with correct prefix", () => {
  const asc = ascending("session")
  const desc = descending("session")

  expect(asc.startsWith("ses_")).toBe(true)
  expect(desc.startsWith("ses_")).toBe(true)
})

test("ascending IDs produced within same millisecond are unique", () => {
  const a = ascending("message")
  const b = ascending("message")
  expect(a).not.toBe(b)
})

test("ascending IDs sort lexicographically for increasing timestamps", () => {
  const a = create("tool", "ascending", 1_700_000_000_000)
  const b = create("tool", "ascending", 1_800_000_000_000)
  expect(a < b).toBe(true)
})

test("descending IDs sort inversely for increasing timestamps", () => {
  const a = create("tool", "descending", 1_700_000_000_000)
  const b = create("tool", "descending", 1_800_000_000_000)
  expect(a > b).toBe(true)
})

// ---- edge cases ----

test("generateID throws on mismatched prefix", () => {
  expect(() => ascending("message", "ses_abc123def45600")).toThrow("does not start with msg")
})

test("generateID returns given ID when prefix matches", () => {
  const given = ascending("session")
  expect(ascending("session", given)).toBe(given)
})

test("ascending with timestamp 0 produces valid ID", () => {
  const id = create("evt", "ascending", 0)
  expect(id.startsWith("evt_")).toBe(true)
  expect(timestamp(id)).toBe(0)
})

test("descending produces different output than ascending for same timestamp", () => {
  const asc = create("evt", "ascending", 1_700_000_000_000)
  const desc = create("evt", "descending", 1_700_000_000_000)
  expect(asc).not.toBe(desc)
})

// ---- namespace export ----

test("Identifier namespace re-exports the public API", () => {
  expect(typeof Identifier.create).toBe("function")
  expect(typeof Identifier.ascending).toBe("function")
  expect(typeof Identifier.descending).toBe("function")
  expect(typeof Identifier.timestamp).toBe("function")
})
