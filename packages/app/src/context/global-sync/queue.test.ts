import { describe, expect, spyOn, test } from "bun:test"
import { createRefreshQueue } from "./queue"
import { directoryKey } from "./utils"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("createRefreshQueue", () => {
  test("clears queued directories by normalized key", async () => {
    const calls: string[] = []
    const queue = createRefreshQueue({
      paused: () => false,
      key: directoryKey,
      bootstrap: async () => {},
      bootstrapInstance: (directory) => {
        calls.push(directory)
      },
    })

    queue.push("C:\\tmp\\demo")
    queue.clear("C:/tmp/demo")

    await wait(10)

    expect(calls).toEqual([])
    queue.dispose()
  })

  test("passes the original directory to bootstrapInstance", async () => {
    const calls: string[] = []
    const queue = createRefreshQueue({
      paused: () => false,
      key: directoryKey,
      bootstrap: async () => {},
      bootstrapInstance: (directory) => {
        calls.push(directory)
      },
    })

    queue.push("C:\\tmp\\demo")

    await wait(10)

    expect(calls).toEqual(["C:\\tmp\\demo"])
    queue.dispose()
  })

  test("retries a rejected root refresh instead of dropping it", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {})
    let attempts = 0
    const queue = createRefreshQueue({
      paused: () => false,
      bootstrap: () => {
        attempts++
        if (attempts === 1) return Promise.reject(new Error("boom"))
        return Promise.resolve()
      },
      bootstrapInstance: () => {},
      retryBaseMs: 5,
    })

    queue.refresh()
    await wait(80)

    expect(attempts).toBeGreaterThanOrEqual(2)
    expect(errors).toHaveBeenCalled()
    queue.dispose()
    errors.mockRestore()
  })

  test("re-queues only the directory that failed a bootstrapInstance", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {})
    let failed = false
    const calls: string[] = []
    const queue = createRefreshQueue({
      paused: () => false,
      bootstrap: async () => {},
      bootstrapInstance: (directory) => {
        calls.push(directory)
        if (!failed && directory === "/b") {
          failed = true
          throw new Error("boom")
        }
      },
      retryBaseMs: 5,
    })

    queue.push("/a")
    queue.push("/b")
    await wait(80)

    // "/a" succeeded and must not be bootstrapped again; only "/b" is retried.
    expect(calls).toEqual(["/a", "/b", "/b"])
    expect(errors).toHaveBeenCalled()
    queue.dispose()
    errors.mockRestore()
  })

  test("a fresh push after a failure is not delayed by the backoff", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {})
    const calls: string[] = []
    let paused = false
    let failed = false
    const queue = createRefreshQueue({
      paused: () => paused,
      bootstrap: async () => {},
      bootstrapInstance: (directory) => {
        calls.push(directory)
        if (!failed && directory === "/fail") {
          failed = true
          // Pause inside the failing call so the failure path skips scheduling
          // its backoff timer, leaving a raised backoff with no pending timer.
          paused = true
          throw new Error("boom")
        }
      },
      retryBaseMs: 200,
    })

    queue.push("/fail")
    await wait(20)
    expect(calls).toEqual(["/fail"])

    paused = false
    queue.push("/fresh")
    await wait(20)

    // "/fresh" must run promptly rather than waiting out the stale 200ms backoff.
    expect(calls).toContain("/fresh")
    queue.dispose()
    errors.mockRestore()
  })
})
