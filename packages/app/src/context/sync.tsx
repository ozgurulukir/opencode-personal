import { batch, createMemo } from "solid-js"
import { createStore, produce, reconcile } from "solid-js/store"
import { Binary } from "@opencode-ai/core/util/binary"
import { retry } from "@opencode-ai/core/util/retry"
import { createSimpleContext } from "@opencode-ai/ui/context"
import {
  clearSessionPrefetch,
  getSessionPrefetch,
  getSessionPrefetchPromise,
  setSessionPrefetch,
} from "./global-sync/session-prefetch"
import { useGlobalSync } from "./global-sync"
import { useSDK } from "./sdk"
import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { SESSION_CACHE_LIMIT, dropSessionCaches, pickSessionCacheEvictions } from "./global-sync/session-cache"
import { diffs as list } from "@/utils/diffs"
import { messageText, sessionMessagesToV1 } from "./global-sync/v2-adapter"

const SKIP_PARTS = new Set(["patch", "step-start", "step-finish"])

function sortParts(parts: Part[]) {
  return parts.filter((part) => !!part?.id).sort((a, b) => cmp(a.id, b.id))
}

function runInflight(map: Map<string, Promise<void>>, key: string, task: () => Promise<void>) {
  const pending = map.get(key)
  if (pending) return pending
  const promise = task().finally(() => {
    map.delete(key)
  })
  map.set(key, promise)
  return promise
}

const keyFor = (directory: string, id: string) => `${directory}\n${id}`

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function merge<T extends { id: string }>(a: readonly T[], b: readonly T[]) {
  const map = new Map(a.map((item) => [item.id, item] as const))
  for (const item of b) map.set(item.id, item)
  return [...map.values()].sort((x, y) => cmp(x.id, y.id))
}

type OptimisticStore = {
  message: Record<string, Message[] | undefined>
  part: Record<string, Part[] | undefined>
}

type OptimisticAddInput = {
  sessionID: string
  message: Message
  parts: Part[]
}

type OptimisticRemoveInput = {
  sessionID: string
  messageID: string
}

type OptimisticItem = {
  message: Message
  parts: Part[]
}

type MessagePage = {
  session: Message[]
  part: { id: string; part: Part[] }[]
  cursor?: string
  complete: boolean
}

export function mergeOptimisticPage(page: MessagePage, items: OptimisticItem[]) {
  if (items.length === 0) return { ...page, confirmed: [] as string[] }

  // One persisted user message confirms at most one optimistic entry, so
  // duplicate in-flight texts stay pending until their own message lands.
  // V2 message ids are event ids, not the client's messageID, so matching is
  // by prompt text (both sides build it identically via messageText).
  const unmatched = page.session
    .filter((message) => message.role === "user")
    .map((message) => ({
      id: message.id,
      text: messageText(page.part.find((entry) => entry.id === message.id)?.part ?? []),
    }))
  const confirmed: string[] = []
  const pending: OptimisticItem[] = []

  for (const item of items) {
    const index = unmatched.findIndex((entry) => entry.text === messageText(item.parts))
    if (index >= 0) {
      unmatched.splice(index, 1)
      confirmed.push(item.message.id)
      continue
    }
    pending.push(item)
  }

  const session = [...page.session]
  const part = new Map(page.part.map((entry) => [entry.id, sortParts(entry.part)]))
  for (const item of pending) {
    const result = Binary.search(session, item.message.id, (message) => message.id)
    session.splice(result.index, 0, item.message)
    part.set(item.message.id, sortParts(item.parts))
  }

  return {
    cursor: page.cursor,
    complete: page.complete,
    session,
    part: [...part.entries()].sort((a, b) => cmp(a[0], b[0])).map(([id, part]) => ({ id, part })),
    confirmed,
  }
}

export function applyOptimisticAdd(draft: OptimisticStore, input: OptimisticAddInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    messages.splice(result.index, 0, input.message)
  } else {
    draft.message[input.sessionID] = [input.message]
  }
  draft.part[input.message.id] = sortParts(input.parts)
}

export function applyOptimisticRemove(draft: OptimisticStore, input: OptimisticRemoveInput) {
  const messages = draft.message[input.sessionID]
  if (messages) {
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (result.found) messages.splice(result.index, 1)
  }
  delete draft.part[input.messageID]
}

function setOptimisticAdd(setStore: (...args: unknown[]) => void, input: OptimisticAddInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    if (!messages) return [input.message]
    const result = Binary.search(messages, input.message.id, (m) => m.id)
    const next = [...messages]
    next.splice(result.index, 0, input.message)
    return next
  })
  setStore("part", input.message.id, sortParts(input.parts))
}

function setOptimisticRemove(setStore: (...args: unknown[]) => void, input: OptimisticRemoveInput) {
  setStore("message", input.sessionID, (messages: Message[] | undefined) => {
    if (!messages) return messages
    const result = Binary.search(messages, input.messageID, (m) => m.id)
    if (!result.found) return messages
    const next = [...messages]
    next.splice(result.index, 1)
    return next
  })
  setStore("part", (part: Record<string, Part[] | undefined>) => {
    if (!(input.messageID in part)) return part
    const next = { ...part }
    delete next[input.messageID]
    return next
  })
}

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const globalSync = useGlobalSync()
    const sdk = useSDK()

    type Child = ReturnType<(typeof globalSync)["child"]>
    type Setter = Child[1]

    const current = createMemo(() => globalSync.child(sdk.directory))
    const target = (directory?: string) => {
      if (!directory || directory === sdk.directory) return current()
      return globalSync.child(directory)
    }
    const absolute = (path: string) => (current()[0].path.directory + "/" + path).replace("//", "/")
    const initialMessagePageSize = 80
    const historyMessagePageSize = 200
    const inflight = new Map<string, Promise<void>>()
    const inflightDiff = new Map<string, Promise<void>>()
    const inflightTodo = new Map<string, Promise<void>>()
    const optimistic = new Map<string, Map<string, OptimisticItem>>()
    const maxDirs = 30
    const seen = new Map<string, Set<string>>()
    const [meta, setMeta] = createStore({
      limit: {} as Record<string, number>,
      cursor: {} as Record<string, string | undefined>,
      complete: {} as Record<string, boolean>,
      loading: {} as Record<string, boolean>,
    })

    const getSession = (sessionID: string) => {
      const store = current()[0]
      const match = Binary.search(store.session, sessionID, (s) => s.id)
      if (match.found) return store.session[match.index]
      return undefined
    }

    const setOptimistic = (directory: string, sessionID: string, item: OptimisticItem) => {
      const key = keyFor(directory, sessionID)
      const list = optimistic.get(key)
      if (list) {
        list.set(item.message.id, { message: item.message, parts: sortParts(item.parts) })
        return
      }
      optimistic.set(key, new Map([[item.message.id, { message: item.message, parts: sortParts(item.parts) }]]))
    }

    const clearOptimistic = (directory: string, sessionID: string, messageID?: string) => {
      const key = keyFor(directory, sessionID)
      if (!messageID) {
        optimistic.delete(key)
        return
      }

      const list = optimistic.get(key)
      if (!list) return
      list.delete(messageID)
      if (list.size === 0) optimistic.delete(key)
    }

    const getOptimistic = (directory: string, sessionID: string) => [
      ...(optimistic.get(keyFor(directory, sessionID))?.values() ?? []),
    ]

    // Called by the event reducer when a real projected user message arrives:
    // evicts the optimistic entry (and its store copy) whose prompt text
    // matches, so the timeline never shows both. One real message consumes
    // one entry.
    const resolveOptimistic = (directory: string, sessionID: string, text: string) => {
      const list = optimistic.get(keyFor(directory, sessionID))
      if (!list) return
      for (const [messageID, item] of list) {
        if (messageText(item.parts) !== text) continue
        clearOptimistic(directory, sessionID, messageID)
        const [, setStore] = target(directory)
        setOptimisticRemove(setStore as (...args: unknown[]) => void, { sessionID, messageID })
        return
      }
    }

    globalSync.setOptimisticResolver(resolveOptimistic)

    const seenFor = (directory: string) => {
      const existing = seen.get(directory)
      if (existing) {
        seen.delete(directory)
        seen.set(directory, existing)
        return existing
      }
      const created = new Set<string>()
      seen.set(directory, created)
      while (seen.size > maxDirs) {
        const first = seen.keys().next().value
        if (!first) break
        const stale = [...(seen.get(first) ?? [])]
        seen.delete(first)
        const [, setStore] = globalSync.child(first, { bootstrap: false })
        evict(first, setStore, stale)
      }
      return created
    }

    const clearMeta = (directory: string, sessionIDs: string[]) => {
      if (sessionIDs.length === 0) return
      for (const sessionID of sessionIDs) {
        clearOptimistic(directory, sessionID)
      }
      setMeta(
        produce((draft) => {
          for (const sessionID of sessionIDs) {
            const key = keyFor(directory, sessionID)
            delete draft.limit[key]
            delete draft.cursor[key]
            delete draft.complete[key]
            delete draft.loading[key]
          }
        }),
      )
    }

    const evict = (directory: string, setStore: Setter, sessionIDs: string[]) => {
      if (sessionIDs.length === 0) return
      clearSessionPrefetch(directory, sessionIDs)
      for (const sessionID of sessionIDs) {
        globalSync.todo.set(sessionID, undefined)
      }
      setStore(
        produce((draft) => {
          dropSessionCaches(draft, sessionIDs)
        }),
      )
      clearMeta(directory, sessionIDs)
    }

    const touch = (directory: string, setStore: Setter, sessionID: string) => {
      const stale = pickSessionCacheEvictions({
        seen: seenFor(directory),
        keep: sessionID,
        limit: SESSION_CACHE_LIMIT,
      })
      evict(directory, setStore, stale)
    }

    const fetchMessages = async (input: {
      client: typeof sdk.client
      sessionID: string
      limit: number
      cursor?: string
    }) => {
      const messages = await retry(() =>
        input.client.v2.session.messages({
          sessionID: input.sessionID,
          limit: input.limit,
          order: "desc",
          cursor: input.cursor,
        }),
      )
      const items = (messages.data?.items ?? []).filter((x) => !!x?.id)
      // The v2 endpoint always encodes cursor.next for a non-empty page, so
      // completeness is derived from the page size instead (a short page means
      // the older boundary was exhausted).
      const cursor = messages.data?.cursor.next
      // Pages are newest-first; the store slices are ascending (oldest first).
      const converted = sessionMessagesToV1(items.toReversed(), input.sessionID)
      return {
        session: converted.session,
        part: Object.entries(converted.part).map(([id, part]) => ({ id, part })),
        cursor,
        complete: items.length < input.limit,
      }
    }

    const tracked = (directory: string, sessionID: string) => seen.get(directory)?.has(sessionID) ?? false

    const loadMessages = async (input: {
      directory: string
      client: typeof sdk.client
      setStore: Setter
      sessionID: string
      limit: number
      cursor?: string
      mode?: "replace" | "prepend"
    }) => {
      const key = keyFor(input.directory, input.sessionID)
      if (meta.loading[key]) return

      setMeta("loading", key, true)
      await fetchMessages(input)
        .then((page) => {
          if (!tracked(input.directory, input.sessionID)) return
          const next = mergeOptimisticPage(page, getOptimistic(input.directory, input.sessionID))
          for (const messageID of next.confirmed) {
            clearOptimistic(input.directory, input.sessionID, messageID)
          }
          const [store] = globalSync.child(input.directory, { bootstrap: false })
          const cached = input.mode === "prepend" ? (store.message[input.sessionID] ?? []) : []
          const message = input.mode === "prepend" ? merge(cached, next.session) : next.session
          batch(() => {
            input.setStore("message", input.sessionID, reconcile(message, { key: "id" }))
            for (const p of next.part) {
              const filtered = p.part.filter((x) => !SKIP_PARTS.has(x.type))
              if (filtered.length) input.setStore("part", p.id, filtered)
            }
            setMeta("limit", key, message.length)
            setMeta("cursor", key, next.cursor)
            setMeta("complete", key, next.complete)
            setSessionPrefetch({
              directory: input.directory,
              sessionID: input.sessionID,
              limit: message.length,
              cursor: next.cursor,
              complete: next.complete,
            })
          })
        })
        .finally(() => {
          setMeta(
            produce((draft) => {
              if (!tracked(input.directory, input.sessionID)) {
                delete draft.loading[key]
                return
              }
              draft.loading[key] = false
            }),
          )
        })
    }

    return {
      get data() {
        return current()[0]
      },
      get set(): Setter {
        return current()[1]
      },
      get status() {
        return current()[0].status
      },
      get ready() {
        return current()[0].status !== "loading"
      },
      get project() {
        const store = current()[0]
        const match = Binary.search(globalSync.data.project, store.project, (p) => p.id)
        if (match.found) return globalSync.data.project[match.index]
        return undefined
      },
      session: {
        get: getSession,
        optimistic: {
          add(input: { directory?: string; sessionID: string; message: Message; parts: Part[] }) {
            const directory = input.directory ?? sdk.directory
            const [, setStore] = target(input.directory)
            setOptimistic(directory, input.sessionID, { message: input.message, parts: input.parts })
            setOptimisticAdd(setStore as (...args: unknown[]) => void, input)
          },
          remove(input: { directory?: string; sessionID: string; messageID: string }) {
            const directory = input.directory ?? sdk.directory
            const [, setStore] = target(input.directory)
            clearOptimistic(directory, input.sessionID, input.messageID)
            setOptimisticRemove(setStore as (...args: unknown[]) => void, input)
          },
        },
        async sync(sessionID: string, opts?: { force?: boolean }) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          const key = keyFor(directory, sessionID)

          touch(directory, setStore, sessionID)

          const seeded = getSessionPrefetch(directory, sessionID)
          if (seeded && store.message[sessionID] !== undefined && meta.limit[key] === undefined) {
            batch(() => {
              setMeta("limit", key, seeded.limit)
              setMeta("cursor", key, seeded.cursor)
              setMeta("complete", key, seeded.complete)
              setMeta("loading", key, false)
            })
          }

          return runInflight(inflight, key, async () => {
            const pending = getSessionPrefetchPromise(directory, sessionID)
            if (pending) {
              await pending
              const seeded = getSessionPrefetch(directory, sessionID)
              if (seeded && store.message[sessionID] !== undefined && meta.limit[key] === undefined) {
                batch(() => {
                  setMeta("limit", key, seeded.limit)
                  setMeta("cursor", key, seeded.cursor)
                  setMeta("complete", key, seeded.complete)
                  setMeta("loading", key, false)
                })
              }
            }

            const hasSession = Binary.search(store.session, sessionID, (s) => s.id).found
            const cached = store.message[sessionID] !== undefined && meta.limit[key] !== undefined
            if (cached && hasSession && !opts?.force) return

            const limit = meta.limit[key] ?? initialMessagePageSize
            const sessionReq =
              hasSession && !opts?.force
                ? Promise.resolve()
                : retry(() => client.v2.session.get({ sessionID })).then((session) => {
                    if (!tracked(directory, sessionID)) return
                    const data = session.data
                    if (!data) return
                    setStore(
                      "session",
                      produce((draft) => {
                        const match = Binary.search(draft, sessionID, (s) => s.id)
                        if (match.found) {
                          draft[match.index] = data
                          return
                        }
                        draft.splice(match.index, 0, data)
                      }),
                    )
                  })

            const messagesReq =
              cached && !opts?.force
                ? Promise.resolve()
                : loadMessages({
                    directory,
                    client,
                    setStore,
                    sessionID,
                    limit,
                  })

            await Promise.all([sessionReq, messagesReq])
          })
        },
        async diff(sessionID: string, opts?: { force?: boolean }) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          touch(directory, setStore, sessionID)
          if (store.session_diff[sessionID] !== undefined && !opts?.force) return

          const key = keyFor(directory, sessionID)
          return runInflight(inflightDiff, key, () =>
            retry(() => client.v2.session.diff({ sessionID })).then((diff) => {
              if (!tracked(directory, sessionID)) return
              setStore("session_diff", sessionID, reconcile(list(diff.data), { key: "file" }))
            }),
          )
        },
        async todo(sessionID: string, opts?: { force?: boolean }) {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          touch(directory, setStore, sessionID)
          const existing = store.todo[sessionID]
          const cached = globalSync.data.session_todo[sessionID]
          if (existing !== undefined) {
            if (cached === undefined) {
              globalSync.todo.set(sessionID, existing)
            }
            if (!opts?.force) return
          }

          if (cached !== undefined) {
            setStore("todo", sessionID, reconcile(cached, { key: "id" }))
          }

          const key = keyFor(directory, sessionID)
          return runInflight(inflightTodo, key, () =>
            retry(() => client.v2.session.todo({ sessionID })).then((todo) => {
              if (!tracked(directory, sessionID)) return
              const list = todo.data ?? []
              setStore("todo", sessionID, reconcile(list, { key: "id" }))
              globalSync.todo.set(sessionID, list)
            }),
          )
        },
        history: {
          more(sessionID: string) {
            const store = current()[0]
            const key = keyFor(sdk.directory, sessionID)
            if (store.message[sessionID] === undefined) return false
            if (meta.limit[key] === undefined) return false
            if (meta.complete[key]) return false
            return !!meta.cursor[key]
          },
          loading(sessionID: string) {
            const key = keyFor(sdk.directory, sessionID)
            return meta.loading[key] ?? false
          },
          async loadMore(sessionID: string, count?: number) {
            const directory = sdk.directory
            const client = sdk.client
            const [, setStore] = globalSync.child(directory)
            touch(directory, setStore, sessionID)
            const key = keyFor(directory, sessionID)
            const step = count ?? historyMessagePageSize
            if (meta.loading[key]) return
            if (meta.complete[key]) return
            const cursor = meta.cursor[key]
            if (!cursor) return

            await loadMessages({
              directory,
              client,
              setStore,
              sessionID,
              limit: step,
              cursor,
              mode: "prepend",
            })
          },
        },
        evict(sessionID: string, directory = sdk.directory) {
          const [, setStore] = globalSync.child(directory)
          seenFor(directory).delete(sessionID)
          evict(directory, setStore, [sessionID])
        },
        fetch: async (count = 10) => {
          const directory = sdk.directory
          const client = sdk.client
          const [store, setStore] = globalSync.child(directory)
          setStore("limit", (x) => x + count)
          // limit 100 preserves the V1 list default (the v2 route caps at 50)
          await client.v2.session.list({ limit: 100 }).then((x) => {
            const sessions = (x.data?.items ?? [])
              .filter((s) => !!s?.id)
              .sort((a, b) => cmp(a.id, b.id))
              .slice(0, store.limit)
            setStore("session", reconcile(sessions, { key: "id" }))
          })
        },
        more: createMemo(() => current()[0].session.length >= current()[0].limit),
        archive: async (sessionID: string) => {
          const directory = sdk.directory
          const client = sdk.client
          const [, setStore] = globalSync.child(directory)
          await client.v2.session.update({ sessionID, time: { archived: Date.now() } })
          setStore(
            produce((draft) => {
              const match = Binary.search(draft.session, sessionID, (s) => s.id)
              if (match.found) draft.session.splice(match.index, 1)
            }),
          )
        },
      },
      absolute,
      get directory() {
        return current()[0].path.directory
      },
    }
  },
})
