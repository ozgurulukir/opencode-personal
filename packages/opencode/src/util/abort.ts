/**
 * Combines multiple AbortSignals into one, with explicit cleanup.
 *
 * Unlike `AbortSignal.any()`, this returns a `cleanup()` function that the
 * caller MUST invoke when the combined signal is no longer needed. This
 * prevents memory leaks when signals are reused across many calls without
 * being aborted.
 *
 * Call `cleanup()` after the operation that uses the combined signal completes
 * (success or failure). Cleanup removes all event listeners from constituent
 * signals, preventing listener accumulation.
 */
export function combineSignals(signals: AbortSignal[]): {
  signal: AbortSignal
  cleanup: () => void
} {
  if (signals.length === 0) return { signal: new AbortController().signal, cleanup: () => {} }
  if (signals.length === 1) return { signal: signals[0], cleanup: () => {} }

  const controller = new AbortController()
  const onAbort = () => {
    controller.abort(signals.find((s) => s.aborted)?.reason)
    cleanup()
  }
  const cleanup = () => {
    for (const signal of signals) {
      signal.removeEventListener("abort", onAbort)
    }
  }

  if (signals.some((s) => s.aborted)) {
    controller.abort(signals.find((s) => s.aborted)?.reason)
    return { signal: controller.signal, cleanup }
  }

  for (const signal of signals) {
    signal.addEventListener("abort", onAbort, { once: true })
  }

  return { signal: controller.signal, cleanup }
}
