import { describe, expect, test } from "bun:test"
import { computeScrollState, scrollStateChanged } from "./scroll-state"

describe("computeScrollState", () => {
  test("content shorter than the viewport is not overflowing and counts as bottom", () => {
    expect(computeScrollState({ scrollHeight: 400, clientHeight: 600, scrollTop: 0 })).toEqual({
      overflow: false,
      bottom: true,
      jump: false,
    })
  })

  test("content within 1px of the viewport is treated as not overflowing", () => {
    expect(computeScrollState({ scrollHeight: 601, clientHeight: 600, scrollTop: 0 }).overflow).toBe(false)
  })

  test("pinned to the bottom when within 2px of the end", () => {
    expect(computeScrollState({ scrollHeight: 2000, clientHeight: 600, scrollTop: 1399 }).bottom).toBe(true)
    expect(computeScrollState({ scrollHeight: 2000, clientHeight: 600, scrollTop: 1400 }).bottom).toBe(true)
  })

  test("not at the bottom when scrolled up", () => {
    expect(computeScrollState({ scrollHeight: 2000, clientHeight: 600, scrollTop: 800 }).bottom).toBe(false)
  })

  test("jump is set when the distance exceeds the threshold", () => {
    // max = 1400, scrollTop = 500 → distance 900 > max(400, 600)
    expect(computeScrollState({ scrollHeight: 2000, clientHeight: 600, scrollTop: 500 }).jump).toBe(true)
  })

  test("jump is false near the bottom", () => {
    expect(computeScrollState({ scrollHeight: 2000, clientHeight: 600, scrollTop: 1300 }).jump).toBe(false)
  })

  test("respects an explicit jump threshold", () => {
    expect(
      computeScrollState({ scrollHeight: 2000, clientHeight: 600, scrollTop: 500, jumpThreshold: 1000 }).jump,
    ).toBe(false)
  })
})

describe("scrollStateChanged", () => {
  const base = { overflow: true, bottom: false, jump: false }

  test("detects each field change", () => {
    expect(scrollStateChanged(base, { ...base, overflow: false })).toBe(true)
    expect(scrollStateChanged(base, { ...base, bottom: true })).toBe(true)
    expect(scrollStateChanged(base, { ...base, jump: true })).toBe(true)
  })

  test("returns false for identical state", () => {
    expect(scrollStateChanged(base, { ...base })).toBe(false)
  })
})
