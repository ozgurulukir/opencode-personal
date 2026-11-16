import { batch, createEffect, untrack } from "solid-js"
import type { Accessor } from "solid-js"
import { produce, reconcile } from "solid-js/store"
import type { Message, Session } from "@opencode-ai/sdk/v2/client"
import { retry } from "@opencode-ai/core/util/retry"
import { pathKey } from "@/utils/path-key"
import { dropSessionCaches, pickSessionCacheEvictions } from "@/context/global-sync/session-cache"
import {
  clearSessionPrefetch,
  clearSessionPrefetchInflight,
  getSessionPrefetch,
  isSessionPrefetchCurrent,
  runSessionPrefetch,
  setSessionPrefetch,
  shouldSkipSessionPrefetch,
} from "@/context/global-sync/session-prefetch"
import { sessionMessagesToV1 } from "@/context/global-sync/v2-adapter"
import { createPrefetchQueues } from "./prefetch-queue"

const PREFETCH_CHUNK = 200
const PREFETCH_CONCURRENCY = 2
const PREFETCH_PENDING_LIMIT = 10
const WARM_SPAN = 4
const PREFETCH_MAX_SESSIONS_PER_DIR = 10

type PrefetchPriority = "high" | "low"

/** Merge two id-keyed lists, newest-incoming wins, sorted ascending by id. */
export function mergeByID<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  if (current.length === 0) {
    return incoming.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }
  const map = new Map<string, T>()
  for (const item of current) map.set(item.id, item)
  for (const item of incoming) map.set(item.id, item)
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Decide what to do with a prefetch request for one session.
 *
 * - `skip`: already in flight, or a low-priority request that would exceed the
 *   per-directory cap.
 * - `promote`: already pending; a high-priority request moves it to the front.
 * - `enqueue`: add to the queue (front for high priority, back for low).
 */
export function planPrefetchEnqueue(input: {
  inflight: boolean
  pending: boolean
  known: boolean
  lruSize: number
  maxPerDir: number
  priority: PrefetchPriority
}): "skip" | "promote" | "enqueue" {
  if (input.inflight) return "skip"
  if (input.pending) return input.priority === "high" ? "promote" : "skip"
  if (!input.known && input.lruSize >= input.maxPerDir && input.priority !== "high") return "skip"
  return "enqueue"
}

type GlobalSync = ReturnType<typeof import("@/context/global-sync").useGlobalSync>
type GlobalSDK = ReturnType<typeof import("@/context/global-sdk").useGlobalSDK>

/**
 * Owns the session message prefetch pump for the Layout page: per-directory
 * queues, concurrency limits, an LRU of prefetched sessions, and the reactive
 * warm-up effect that keeps neighbouring sessions ready for navigation.
 *
 * The queue lifecycle lives in `prefetch-queue.ts` and the enqueue/merge
 * decisions are pure (`planPrefetchEnqueue`, `mergeByID`) so they can be tested
 * without mounting the page.
 */
export function createSessionPrefetchPump(input: {
  globalSync: GlobalSync
  globalSDK: GlobalSDK
  sessions: Accessor<Session[]>
  visibleDirs: Accessor<string[]>
  activeSessionID: Accessor<string | undefined>
  currentDir: Accessor<string>
  /** Reactive read of the route + server URL; changing it invalidates in-flight work. */
  invalidation: Accessor<unknown>
}) {
  const queues = createPrefetchQueues()
  const token = { value: 0 }
  const prefetchedByDir = new Map<string, Set<string>>()

  const lruFor = (directory: string) => {
    const existing = prefetchedByDir.get(directory)
    if (existing) return existing
    const created = new Set<string>()
    prefetchedByDir.set(directory, created)
    return created
  }

  const markPrefetched = (directory: string, sessionID: string) => {
    const preserve =
      input.activeSessionID() && pathKey(directory) === pathKey(input.currentDir())
        ? [input.activeSessionID()!]
        : undefined
    return pickSessionCacheEvictions({
      seen: lruFor(directory),
      keep: sessionID,
      limit: PREFETCH_MAX_SESSIONS_PER_DIR,
      preserve,
    })
  }

  createEffect(() => {
    const active = new Set(input.visibleDirs())
    for (const directory of prefetchedByDir.keys()) {
      if (active.has(directory)) continue
      prefetchedByDir.delete(directory)
    }
    queues.cleanupInvisible(active)
  })

  createEffect(() => {
    input.invalidation()
    token.value += 1
    clearSessionPrefetchInflight()
    queues.clear()
  })

  const prefetchMessages = async (directory: string, sessionID: string, version: number) => {
    const [store, setStore] = input.globalSync.child(directory, { bootstrap: false })

    return runSessionPrefetch({
      directory,
      sessionID,
      task: (rev) =>
        retry(() =>
          input.globalSDK.client.v2.session.messages({ directory, sessionID, limit: PREFETCH_CHUNK, order: "desc" }),
        )
          .then((messages) => {
            if (token.value !== version) return
            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            const items = (messages.data?.items ?? []).filter((x) => !!x?.id)
            // Pages are newest-first; the store slices are ascending (oldest
            // first). Convert through the V2→V1 adapter so prefetched data
            // matches what the event stream writes.
            const converted = sessionMessagesToV1(items.toReversed(), sessionID)
            const sorted = mergeByID([], converted.session)
            const stale = markPrefetched(directory, sessionID)
            const cursor = messages.data?.cursor.next
            const meta = {
              limit: sorted.length,
              cursor,
              complete: sorted.length < PREFETCH_CHUNK,
              at: Date.now(),
            }

            if (stale.length > 0) {
              clearSessionPrefetch(directory, stale)
              for (const id of stale) input.globalSync.todo.set(id, undefined)
            }

            const current = store.message[sessionID] ?? []
            const merged = mergeByID(
              current.filter((item): item is Message => !!item?.id),
              sorted,
            )

            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            batch(() => {
              if (stale.length > 0) {
                setStore(
                  produce((draft) => {
                    dropSessionCaches(draft, stale)
                  }),
                )
              }

              setStore("message", sessionID, reconcile(merged, { key: "id" }))
              setSessionPrefetch({ directory, sessionID, ...meta })

              for (const [messageID, parts] of Object.entries(converted.part)) {
                const currentParts = store.part[messageID] ?? []
                const mergedParts = mergeByID(
                  currentParts.filter((item): item is (typeof currentParts)[number] & { id: string } => !!item?.id),
                  parts.filter((item): item is (typeof parts)[number] & { id: string } => !!item?.id),
                )
                setStore("part", messageID, reconcile(mergedParts, { key: "id" }))
              }
            })

            return meta
          })
          .catch(() => undefined),
    })
  }

  const pump = (directory: string) => {
    const q = queues.queueFor(directory)
    if (q.running >= PREFETCH_CONCURRENCY) return

    const sessionID = q.pending.shift()
    if (!sessionID) return

    q.pendingSet.delete(sessionID)
    q.inflight.add(sessionID)
    q.running += 1

    const version = token.value

    void prefetchMessages(directory, sessionID, version).finally(() => {
      // Clean up empty queues for invisible directories. The reactive cleanup
      // effect only runs when visibleDirs() changes, so we must also clean up
      // here when a prefetch completes and the directory is no longer visible.
      // Skip re-pumping when the queue was deleted — pump()'s queueFor() would
      // re-create an empty queue.
      const done = queues.completeInflight(directory, sessionID, new Set(input.visibleDirs()))
      if (done) return
      pump(directory)
    })
  }

  const prefetchSession = (session: Session, priority: PrefetchPriority = "low") => {
    const directory = session.directory
    if (!directory) return

    const [store] = input.globalSync.child(directory, { bootstrap: false })
    const cached = untrack(() => {
      const info = getSessionPrefetch(directory, session.id)
      return shouldSkipSessionPrefetch({
        message: store.message[session.id] !== undefined,
        info,
        chunk: PREFETCH_CHUNK,
      })
    })
    if (cached) return

    const q = queues.queueFor(directory)
    const lru = lruFor(directory)
    const action = planPrefetchEnqueue({
      inflight: q.inflight.has(session.id),
      pending: q.pendingSet.has(session.id),
      known: lru.has(session.id),
      lruSize: lru.size,
      maxPerDir: PREFETCH_MAX_SESSIONS_PER_DIR,
      priority,
    })

    if (action === "skip") return
    if (action === "promote") {
      const index = q.pending.indexOf(session.id)
      if (index > 0) {
        q.pending.splice(index, 1)
        q.pending.unshift(session.id)
      }
      return
    }

    if (priority === "high") q.pending.unshift(session.id)
    if (priority !== "high") q.pending.push(session.id)
    q.pendingSet.add(session.id)

    while (q.pending.length > PREFETCH_PENDING_LIMIT) {
      const dropped = q.pending.pop()
      if (!dropped) continue
      q.pendingSet.delete(dropped)
    }

    pump(directory)
  }

  const warm = (sessions: Session[], index: number) => {
    for (let offset = 1; offset <= WARM_SPAN; offset++) {
      const next = sessions[index + offset]
      if (next) prefetchSession(next, offset === 1 ? "high" : "low")

      const prev = sessions[index - offset]
      if (prev) prefetchSession(prev, offset === 1 ? "high" : "low")
    }
  }

  createEffect(() => {
    const sessions = input.sessions()
    if (sessions.length === 0) return

    const activeID = input.activeSessionID()
    const index = activeID ? sessions.findIndex((s) => s.id === activeID) : 0
    if (index === -1) return

    if (!activeID) {
      const first = sessions[index]
      if (first) prefetchSession(first, "high")
    }

    warm(sessions, index)
  })

  return { prefetchSession, warm }
}
