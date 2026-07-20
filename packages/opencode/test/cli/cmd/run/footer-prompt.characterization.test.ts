import { describe, expect, test } from "bun:test"
import {
  hintFlags,
  HINT_BREAKPOINTS,
  TEXTAREA_MIN_ROWS,
  TEXTAREA_MAX_ROWS,
} from "../../../../src/cli/cmd/run/footer.prompt"

// The pure functions in footer.prompt.tsx are not exported. We test them
// indirectly through their behavior or re-export them for characterization.
// The following are exported and testable:

// ─── hintFlags ───────────────────────────────────────────────────────────────

describe("hintFlags", () => {
  test("all flags false at narrow width", () => {
    const flags = hintFlags(10)
    expect(flags.send).toBe(false)
    expect(flags.newline).toBe(false)
    expect(flags.history).toBe(false)
    expect(flags.command).toBe(false)
  })

  test("send flag at 50", () => {
    const flags = hintFlags(HINT_BREAKPOINTS.send)
    expect(flags.send).toBe(true)
    expect(flags.newline).toBe(false)
  })

  test("newline flag at 66", () => {
    const flags = hintFlags(HINT_BREAKPOINTS.newline)
    expect(flags.send).toBe(true)
    expect(flags.newline).toBe(true)
    expect(flags.history).toBe(false)
  })

  test("history flag at 80", () => {
    const flags = hintFlags(HINT_BREAKPOINTS.history)
    expect(flags.send).toBe(true)
    expect(flags.newline).toBe(true)
    expect(flags.history).toBe(true)
    expect(flags.command).toBe(false)
  })

  test("all flags at wide width", () => {
    const flags = hintFlags(200)
    expect(flags.send).toBe(true)
    expect(flags.newline).toBe(true)
    expect(flags.history).toBe(true)
    expect(flags.command).toBe(true)
  })
})

// ─── Constants ───────────────────────────────────────────────────────────────

describe("constants", () => {
  test("TEXTAREA_MIN_ROWS is 1", () => {
    expect(TEXTAREA_MIN_ROWS).toBe(1)
  })

  test("TEXTAREA_MAX_ROWS is 6", () => {
    expect(TEXTAREA_MAX_ROWS).toBe(6)
  })

  test("HINT_BREAKPOINTS are in ascending order", () => {
    expect(HINT_BREAKPOINTS.send).toBeLessThan(HINT_BREAKPOINTS.newline)
    expect(HINT_BREAKPOINTS.newline).toBeLessThan(HINT_BREAKPOINTS.history)
    expect(HINT_BREAKPOINTS.history).toBeLessThan(HINT_BREAKPOINTS.command)
  })
})
