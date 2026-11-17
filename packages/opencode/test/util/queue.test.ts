import { describe, expect, test } from "bun:test"
import { AsyncQueue } from "../../src/util/queue"

describe("AsyncQueue", () => {
  test("removes aborted waiter so subsequent push delivers to live waiter", async () => {
    const queue = new AsyncQueue<string>()
    const ac = new AbortController()

    const aborted = queue.next(ac.signal)
    const live = queue.next()

    ac.abort(new Error("cancelled"))
    await expect(aborted).rejects.toThrow("cancelled")

    queue.push("hello")
    await expect(live).resolves.toBe("hello")
  })
})
