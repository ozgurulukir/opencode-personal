import { describe, expect, test } from "bun:test"
import { mergeByID, planPrefetchEnqueue } from "./prefetch-pump"

describe("mergeByID", () => {
  test("sorts incoming ascending by id when current is empty", () => {
    expect(mergeByID([], [{ id: "c" }, { id: "a" }, { id: "b" }])).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ])
  })

  test("incoming entries win over current entries with the same id", () => {
    expect(mergeByID([{ id: "a", v: 1 }], [{ id: "a", v: 2 }])).toEqual([{ id: "a", v: 2 }])
  })

  test("dedupes and keeps ascending order", () => {
    expect(mergeByID([{ id: "b" }, { id: "a" }], [{ id: "c" }, { id: "b" }])).toEqual([
      { id: "a" },
      { id: "b" },
      { id: "c" },
    ])
  })

  test("does not mutate the inputs", () => {
    const current = [{ id: "b" }, { id: "a" }]
    const incoming = [{ id: "c" }]
    mergeByID(current, incoming)
    expect(current).toEqual([{ id: "b" }, { id: "a" }])
    expect(incoming).toEqual([{ id: "c" }])
  })
})

describe("planPrefetchEnqueue", () => {
  const base = { inflight: false, pending: false, known: false, lruSize: 0, maxPerDir: 10, priority: "low" as const }

  test("skips in-flight sessions", () => {
    expect(planPrefetchEnqueue({ ...base, inflight: true })).toBe("skip")
  })

  test("skips low-priority requests that are already pending", () => {
    expect(planPrefetchEnqueue({ ...base, pending: true })).toBe("skip")
  })

  test("promotes high-priority requests that are already pending", () => {
    expect(planPrefetchEnqueue({ ...base, pending: true, priority: "high" })).toBe("promote")
  })

  test("skips low-priority requests when the LRU is full and the session is unknown", () => {
    expect(planPrefetchEnqueue({ ...base, lruSize: 10 })).toBe("skip")
  })

  test("enqueues high-priority requests even when the LRU is full", () => {
    expect(planPrefetchEnqueue({ ...base, lruSize: 10, priority: "high" })).toBe("enqueue")
  })

  test("enqueues known sessions even when the LRU is full", () => {
    expect(planPrefetchEnqueue({ ...base, lruSize: 10, known: true })).toBe("enqueue")
  })

  test("enqueues a fresh request", () => {
    expect(planPrefetchEnqueue(base)).toBe("enqueue")
  })
})
