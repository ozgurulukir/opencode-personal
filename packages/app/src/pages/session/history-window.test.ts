import { describe, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSessionHistoryWindow, type SessionHistoryWindowInput } from "./history-window"
import type { UserMessage } from "@opencode-ai/sdk/v2"

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function msg(id: string): UserMessage {
  return {
    id,
    sessionID: "s",
    role: "user",
    time: { created: 0 },
    agent: "build",
    model: { providerID: "p", modelID: "m" },
  } as UserMessage
}

function msgs(count: number) {
  return Array.from({ length: count }, (_, i) => msg(`m${i}`))
}

function setup(overrides?: Partial<SessionHistoryWindowInput>) {
  const sessionID = createSignal<string | undefined>("s1")
  const visible = createSignal<UserMessage[]>(msgs(30))
  const calls: string[] = []
  let stored: UserMessage[] = visible[0]()

  const input: SessionHistoryWindowInput = {
    sessionID: () => sessionID[0](),
    messagesReady: () => true,
    loaded: () => stored.length,
    visibleUserMessages: () => stored,
    historyMore: () => false,
    historyLoading: () => false,
    loadMore: async () => {
      calls.push("load")
    },
    userScrolled: () => false,
    scroller: () => undefined,
    ...overrides,
  }
  const setVisible = (next: UserMessage[]) => {
    stored = next
    visible[1](stored)
  }
  return { input, calls, sessionID, setVisible }
}

describe("session history window", () => {
  test("keeps the last 10 turns for long histories", async () => {
    await createRoot(async (dispose) => {
      const { input } = setup()
      const win = createSessionHistoryWindow(input)
      expect(win.turnStart()).toBe(20)
      expect(win.renderedUserMessages()).toHaveLength(10)
      expect(win.renderedUserMessages()[0]?.id).toBe("m20")
      dispose()
    })
  })

  test("renders everything for short histories", async () => {
    await createRoot(async (dispose) => {
      const { input } = setup()
      input.visibleUserMessages = () => msgs(8)
      const win = createSessionHistoryWindow(input)
      expect(win.turnStart()).toBe(0)
      expect(win.renderedUserMessages()).toHaveLength(8)
      dispose()
    })
  })

  test("setTurnStart clamps negatives to zero", async () => {
    await createRoot(async (dispose) => {
      const { input } = setup()
      const win = createSessionHistoryWindow(input)
      win.setTurnStart(-5)
      expect(win.turnStart()).toBe(0)
      dispose()
    })
  })

  test("switching sessions re-initializes the window for the new length", async () => {
    await createRoot(async (dispose) => {
      const { input, sessionID, setVisible } = setup()
      const win = createSessionHistoryWindow(input)
      expect(win.turnStart()).toBe(20)

      setVisible(msgs(25))
      sessionID[1]("s2")
      await tick()

      expect(win.turnStart()).toBe(15)
      dispose()
    })
  })

  test("loadAndReveal reveals all cached turns without fetching when history is exhausted", async () => {
    await createRoot(async (dispose) => {
      const { input, calls } = setup()
      const win = createSessionHistoryWindow(input)
      expect(win.turnStart()).toBe(20)

      await win.loadAndReveal()

      expect(win.turnStart()).toBe(0)
      expect(win.renderedUserMessages()).toHaveLength(30)
      expect(calls).toEqual([])
      dispose()
    })
  })

  test("loadAndReveal fetches older turns until visible grows", async () => {
    await createRoot(async (dispose) => {
      const [list, setList] = createSignal<UserMessage[]>(msgs(5))
      const [ready, setReady] = createSignal(false)
      const { input, calls } = setup({
        visibleUserMessages: () => list(),
        messagesReady: () => ready(),
        loaded: () => list().length,
        historyMore: () => true,
        loadMore: async () => {
          calls.push("load")
          setList([...msgs(5), ...msgs(8).map((m) => ({ ...m, id: "old-" + m.id }))])
        },
      })
      const win = createSessionHistoryWindow(input)
      expect(win.turnStart()).toBe(0)

      // let the deferred effect finish its initial pass, mirroring production
      // timing where history arrives well after component setup
      await tick()
      setReady(true)
      await tick()
      expect(win.turnStart()).toBe(0)

      await win.loadAndReveal()

      expect(calls).toEqual(["load"])
      expect(win.renderedUserMessages()).toHaveLength(13)
      dispose()
    })
  })

  test("scrolling near the top backfills a batch of turns", async () => {
    await createRoot(async (dispose) => {
      const scroller = { scrollTop: 100 } as HTMLDivElement
      const { input, calls } = setup({ userScrolled: () => true, scroller: () => scroller })
      const win = createSessionHistoryWindow(input)
      expect(win.turnStart()).toBe(20)

      win.onScrollerScroll()
      await tick()

      expect(win.turnStart()).toBe(12)
      expect(calls).toEqual([])
      dispose()
    })
  })

  test("scrolling far from the top does nothing", async () => {
    await createRoot(async (dispose) => {
      const scroller = { scrollTop: 500 } as HTMLDivElement
      const { input, calls } = setup({ userScrolled: () => true, scroller: () => scroller })
      const win = createSessionHistoryWindow(input)

      win.onScrollerScroll()
      await tick()

      expect(win.turnStart()).toBe(20)
      expect(calls).toEqual([])
      dispose()
    })
  })

  test("small windows prefetch older messages on scroll and respect the cooldown", async () => {
    await createRoot(async (dispose) => {
      const scroller = { scrollTop: 100 } as HTMLDivElement
      let list = msgs(14)
      let loads = 0
      const { input } = setup({
        visibleUserMessages: () => list,
        loaded: () => list.length,
        historyMore: () => true,
        scroller: () => scroller,
        userScrolled: () => true,
        loadMore: async () => {
          loads++
          list = [...msgs(14), ...msgs(4).map((m) => ({ ...m, id: "old-" + m.id }))]
        },
      })
      const win = createSessionHistoryWindow(input)
      expect(win.turnStart()).toBe(4)

      win.onScrollerScroll()
      await tick()
      await tick()

      // prefetch fetched one batch; backfill revealed 4 -> 0; prefetch completion pinned the
      // window back above the boundary at 0 + growth(4)
      expect(loads).toBe(1)
      expect(win.turnStart()).toBe(4)

      // second scroll within the prefetch cooldown: no new fetch, but backfill still applies
      win.onScrollerScroll()
      await tick()
      await tick()
      expect(loads).toBe(1)
      expect(win.turnStart()).toBe(0)
      dispose()
    })
  })
})
