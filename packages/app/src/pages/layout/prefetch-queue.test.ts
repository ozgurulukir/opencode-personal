import { describe, expect, test } from "bun:test"
import { createPrefetchQueues } from "./prefetch-queue"

describe("prefetch queue", () => {
  test("queueFor creates a fresh empty queue per directory", () => {
    const { queueFor } = createPrefetchQueues()
    const a = queueFor("/tmp/a")
    const b = queueFor("/tmp/b")
    expect(a).not.toBe(b)
    expect(a.running).toBe(0)
    expect(a.pending).toEqual([])
    expect(a.inflight.size).toBe(0)
    expect(a.pendingSet.size).toBe(0)
  })

  test("queueFor returns the same queue for the same directory", () => {
    const { queueFor } = createPrefetchQueues()
    expect(queueFor("/tmp/a")).toBe(queueFor("/tmp/a"))
  })

  test("clear drops all queues", () => {
    const { queueFor, clear } = createPrefetchQueues()
    queueFor("/tmp/a")
    queueFor("/tmp/b")
    clear()
    // queueFor re-creates fresh queues after clear.
    expect(queueFor("/tmp/a")).not.toBe(queueFor("/tmp/b"))
  })

  test("cleanupInvisible clears pending work for invisible directories", () => {
    const { queueFor, cleanupInvisible } = createPrefetchQueues()
    const q = queueFor("/tmp/a")
    q.pending.push("ses_1", "ses_2")
    q.pendingSet.add("ses_1")
    q.pendingSet.add("ses_2")

    cleanupInvisible(new Set(["/tmp/b"]))
    expect(q.pending).toEqual([])
    expect(q.pendingSet.size).toBe(0)
  })

  test("cleanupInvisible keeps visible directories untouched", () => {
    const { queueFor, cleanupInvisible } = createPrefetchQueues()
    const q = queueFor("/tmp/a")
    q.pending.push("ses_1")
    q.pendingSet.add("ses_1")

    cleanupInvisible(new Set(["/tmp/a"]))
    expect(q.pending).toEqual(["ses_1"])
    expect(q.pendingSet.size).toBe(1)
  })

  test("cleanupInvisible deletes empty invisible queues with nothing running", () => {
    const { queueFor, cleanupInvisible } = createPrefetchQueues()
    queueFor("/tmp/a")
    cleanupInvisible(new Set([]))
    // A fresh queueFor returns a different object, proving the old one was deleted.
    expect(queueFor("/tmp/a").pending).toEqual([])
  })

  test("cleanupInvisible keeps invisible queues that are still running", () => {
    const { queueFor, cleanupInvisible } = createPrefetchQueues()
    const q = queueFor("/tmp/a")
    q.running = 1
    cleanupInvisible(new Set([]))
    expect(queueFor("/tmp/a")).toBe(q)
  })

  test("completeInflight decrements running and clears inflight", () => {
    const { queueFor, completeInflight } = createPrefetchQueues()
    const q = queueFor("/tmp/a")
    q.running = 1
    q.inflight.add("ses_1")

    const done = completeInflight("/tmp/a", "ses_1", new Set(["/tmp/a"]))
    expect(done).toBe(false)
    expect(q.running).toBe(0)
    expect(q.inflight.size).toBe(0)
  })

  test("completeInflight deletes empty invisible queues and signals skip", () => {
    const { queueFor, completeInflight } = createPrefetchQueues()
    const q = queueFor("/tmp/a")
    q.running = 1
    q.inflight.add("ses_1")
    const done = completeInflight("/tmp/a", "ses_1", new Set([]))
    expect(done).toBe(true)
    expect(q.running).toBe(0)
    expect(q.inflight.size).toBe(0)
  })

  test("completeInflight keeps invisible queues with pending work", () => {
    const { queueFor, completeInflight } = createPrefetchQueues()
    const q = queueFor("/tmp/a")
    q.pending.push("ses_2")
    q.pendingSet.add("ses_2")
    const done = completeInflight("/tmp/a", "ses_1", new Set([]))
    expect(done).toBe(false)
    expect(queueFor("/tmp/a")).toBe(q)
  })

  test("completeInflight keeps visible empty queues", () => {
    const { queueFor, completeInflight } = createPrefetchQueues()
    const q = queueFor("/tmp/a")
    const done = completeInflight("/tmp/a", "ses_1", new Set(["/tmp/a"]))
    expect(done).toBe(false)
    expect(queueFor("/tmp/a")).toBe(q)
  })

  test("completeInflight is a no-op for unknown directories", () => {
    const { completeInflight } = createPrefetchQueues()
    expect(completeInflight("/tmp/a", "ses_1", new Set([]))).toBe(false)
  })
})
