export type PrefetchQueue = {
  inflight: Set<string>
  pending: string[]
  pendingSet: Set<string>
  running: number
}

/**
 * Owns the per-directory prefetch queue state for the Layout component.
 *
 * Extracted from layout.tsx so the queue lifecycle (enqueue, reactive cleanup,
 * and the finally-block cleanup for invisible directories) can be unit tested
 * in isolation. The queue is a plain state container — scheduling, concurrency
 * limits, and the actual prefetch work stay in the Layout component.
 */
export function createPrefetchQueues() {
  const queues = new Map<string, PrefetchQueue>()

  const queueFor = (directory: string) => {
    const existing = queues.get(directory)
    if (existing) return existing
    const created: PrefetchQueue = {
      inflight: new Set(),
      pending: [],
      pendingSet: new Set(),
      running: 0,
    }
    queues.set(directory, created)
    return created
  }

  const clear = () => {
    queues.clear()
  }

  // Reactive cleanup: runs when visibleSessionDirs() changes. Clears pending
  // work for invisible directories and deletes the queue if nothing is running.
  const cleanupInvisible = (visible: Set<string>) => {
    for (const [directory, q] of queues) {
      if (visible.has(directory)) continue
      q.pending.length = 0
      q.pendingSet.clear()
      if (q.running === 0) queues.delete(directory)
    }
  }

  // Called from a prefetch's finally block. Decrements running and clears the
  // in-flight session. If the directory is invisible and the queue is empty,
  // deletes it and returns true so the caller skips re-pumping (which would
  // re-create an empty queue via queueFor).
  const completeInflight = (directory: string, sessionID: string, visible: Set<string>) => {
    const q = queues.get(directory)
    if (!q) return false
    q.running -= 1
    q.inflight.delete(sessionID)
    if (!visible.has(directory) && q.running === 0 && q.pending.length === 0) {
      queues.delete(directory)
      return true
    }
    return false
  }

  return { queues, queueFor, clear, cleanupInvisible, completeInflight }
}
