import { describe, expect, test } from "bun:test"
import { pickOffsetIndex, pickUnseenOffsetIndex } from "./navigation"

describe("pickOffsetIndex", () => {
  const input = (overrides: Partial<Parameters<typeof pickOffsetIndex>[0]> = {}) => ({
    offset: 1,
    length: 5,
    activeIndex: -1,
    ...overrides,
  })

  test("lands on the first entry when no active index and moving forward", () => {
    expect(pickOffsetIndex(input())).toBe(0)
  })

  test("lands on the last entry when no active index and moving backward", () => {
    expect(pickOffsetIndex(input({ offset: -1 }))).toBe(4)
  })

  test("steps forward and wraps past the end", () => {
    expect(pickOffsetIndex(input({ activeIndex: 4 }))).toBe(0)
    expect(pickOffsetIndex(input({ activeIndex: 2 }))).toBe(3)
  })

  test("steps backward and wraps before the start", () => {
    expect(pickOffsetIndex(input({ offset: -1, activeIndex: 0 }))).toBe(4)
    expect(pickOffsetIndex(input({ offset: -1, activeIndex: 3 }))).toBe(2)
  })

  test("wraps multiple times for large offsets", () => {
    expect(pickOffsetIndex(input({ offset: 7, activeIndex: 2 }))).toBe(4)
    expect(pickOffsetIndex(input({ offset: -6, activeIndex: 2 }))).toBe(1)
  })

  test("offset zero stays on the active index", () => {
    expect(pickOffsetIndex(input({ offset: 0, activeIndex: 3 }))).toBe(3)
  })
})

describe("pickUnseenOffsetIndex", () => {
  const input = (unseen: (index: number) => boolean, overrides: Partial<Parameters<typeof pickUnseenOffsetIndex>[0]> = {}) => ({
    offset: 1,
    length: 5,
    activeIndex: -1,
    unseen,
    ...overrides,
  })
  const none = () => false
  const only = (...indexes: number[]) => (index: number) => indexes.includes(index)

  test("returns undefined when nothing is unseen", () => {
    expect(pickUnseenOffsetIndex(input(none))).toBeUndefined()
    expect(pickUnseenOffsetIndex(input(only(9)))).toBeUndefined()
  })

  test("scans forward from the list start when there is no active session", () => {
    expect(pickUnseenOffsetIndex(input(only(0)))).toBe(0)
    expect(pickUnseenOffsetIndex(input(only(2)))).toBe(2)
  })

  test("scans forward from the active index and wraps", () => {
    expect(pickUnseenOffsetIndex(input(only(3), { activeIndex: 2 }))).toBe(3)
    expect(pickUnseenOffsetIndex(input(only(1), { activeIndex: 2 }))).toBe(1)
    expect(pickUnseenOffsetIndex(input(only(0), { activeIndex: 3 }))).toBe(0)
  })

  test("scans backward from the active index and wraps", () => {
    expect(pickUnseenOffsetIndex(input(only(1), { offset: -1, activeIndex: 2 }))).toBe(1)
    expect(pickUnseenOffsetIndex(input(only(4), { offset: -1, activeIndex: 0 }))).toBe(4)
  })

  test("scans backward from the list end when there is no active session", () => {
    expect(pickUnseenOffsetIndex(input(only(4), { offset: -1 }))).toBe(4)
    expect(pickUnseenOffsetIndex(input(only(2), { offset: -1 }))).toBe(2)
  })

  test("stops at the first unseen candidate", () => {
    expect(pickUnseenOffsetIndex(input(only(1, 3), { activeIndex: 0 }))).toBe(1)
    expect(pickUnseenOffsetIndex(input(only(2, 3), { offset: -1, activeIndex: 4 }))).toBe(3)
  })
})
