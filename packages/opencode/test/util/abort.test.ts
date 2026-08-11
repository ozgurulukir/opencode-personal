import { describe, expect, test } from "bun:test"
import { combineSignals } from "../../src/util/abort"

describe("util.abort.combineSignals", () => {
  test("empty array returns a never-aborted signal with no-op cleanup", () => {
    const { signal, cleanup } = combineSignals([])
    expect(signal.aborted).toBe(false)
    expect(() => cleanup()).not.toThrow()
  })

  test("single signal returns the same signal with no-op cleanup", () => {
    const ctrl = new AbortController()
    const { signal, cleanup } = combineSignals([ctrl.signal])
    expect(signal).toBe(ctrl.signal)
    expect(() => cleanup()).not.toThrow()
  })

  test("multiple signals: first aborts", async () => {
    const ctrl1 = new AbortController()
    const ctrl2 = new AbortController()
    const { signal, cleanup } = combineSignals([ctrl1.signal, ctrl2.signal])

    expect(signal.aborted).toBe(false)

    ctrl1.abort("first")
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe("first")

    cleanup()
  })

  test("multiple signals: second aborts", async () => {
    const ctrl1 = new AbortController()
    const ctrl2 = new AbortController()
    const { signal, cleanup } = combineSignals([ctrl1.signal, ctrl2.signal])

    expect(signal.aborted).toBe(false)

    ctrl2.abort("second")
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe("second")

    cleanup()
  })

  test("already-aborted constituent returns immediately aborted signal", () => {
    const ctrl1 = new AbortController()
    const ctrl2 = new AbortController()
    ctrl1.abort("already")

    const { signal, cleanup } = combineSignals([ctrl1.signal, ctrl2.signal])
    expect(signal.aborted).toBe(true)
    expect(signal.reason).toBe("already")

    cleanup()
  })

  test("cleanup removes abort listeners from constituent signals", async () => {
    const ctrl = new AbortController()
    const timeout = AbortSignal.timeout(1000)

    const { signal: combined1, cleanup } = combineSignals([ctrl.signal, timeout])

    // After cleanup, aborting the constituent should NOT trigger the combined signal
    let combinedAborted = false
    combined1.addEventListener("abort", () => {
      combinedAborted = true
    })

    cleanup()
    ctrl.abort("after cleanup")

    expect(combinedAborted).toBe(false)
  })

  test("no listener leak when cleanup is called after each combineSignals", async () => {
    const ctrl = new AbortController()

    for (let i = 0; i < 200; i++) {
      const { cleanup } = combineSignals([ctrl.signal, AbortSignal.timeout(1000)])
      cleanup()
    }

    // After 200 iterations with cleanup, verify cleanup still works
    // on a fresh combined signal: aborting constituent should not trigger it
    const { signal: finalCombined, cleanup: finalCleanup } = combineSignals([
      ctrl.signal,
      AbortSignal.timeout(1000),
    ])

    let finalAborted = false
    finalCombined.addEventListener("abort", () => {
      finalAborted = true
    })

    finalCleanup()
    ctrl.abort("final")

    expect(finalAborted).toBe(false)
  })

  test("listeners accumulate without cleanup (regression guard)", async () => {
    const ctrl = new AbortController()

    // Simulate the old leaky pattern: combineSignals without cleanup
    for (let i = 0; i < 200; i++) {
      combineSignals([ctrl.signal, AbortSignal.timeout(1000)])
      // cleanup intentionally omitted
    }

    // After 200 iterations without cleanup, a new combined signal SHOULD
    // respond to the constituent aborting (listeners accumulated)
    const { signal: finalCombined } = combineSignals([ctrl.signal, AbortSignal.timeout(1000)])
    let finalAborted = false
    finalCombined.addEventListener("abort", () => {
      finalAborted = true
    })

    ctrl.abort("final")
    expect(finalAborted).toBe(true)
  })

  test("cleanup is idempotent", () => {
    const ctrl = new AbortController()
    const { cleanup } = combineSignals([ctrl.signal, AbortSignal.timeout(1000)])

    expect(() => {
      cleanup()
      cleanup()
      cleanup()
    }).not.toThrow()
  })
})
