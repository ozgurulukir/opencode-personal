import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { useFilteredList } from "./use-filtered-list"

type Item = { id: string; name: string }

const items: Item[] = [
  { id: "1", name: "Apple" },
  { id: "2", name: "Banana" },
  { id: "3", name: "Cherry" },
]

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * useFilteredList uses createResource internally, which requires a reactive
 * owner and resolves asynchronously (microtask). Each test wraps the hook in
 * createRoot and disposes after assertions. Because createResource resolves in
 * a microtask, tests must await tick() before checking resolved state.
 *
 * Tests must be run with --conditions=browser so that solid-js loads its
 * client build (solid.cjs) instead of the server build (server.cjs), which
 * throws "getNextContextId cannot be used under non-hydrating context".
 */

describe("useFilteredList", () => {
  test("resolves async items (Promise) into grouped.latest", async () => {
    await createRoot(async (dispose) => {
      const fetcher = () => Promise.resolve(items)
      const hook = useFilteredList<Item>({
        items: fetcher,
        key: (x) => x.id,
      })

      expect(hook.grouped.loading).toBe(true)
      expect(hook.flat()).toHaveLength(0)

      await tick()

      expect(hook.grouped.loading).toBe(false)
      expect(hook.grouped.latest).toHaveLength(1)
      expect(hook.grouped.latest[0].items).toHaveLength(3)
      expect(hook.flat()).toHaveLength(3)

      dispose()
    })
  })

  test("refetches async items when filter changes", async () => {
    await createRoot(async (dispose) => {
      let lastFilter = ""
      const fetcher = (filter: string) => {
        lastFilter = filter
        return Promise.resolve(
          filter ? items.filter((x) => x.name.toLowerCase().includes(filter.toLowerCase())) : items,
        )
      }
      const hook = useFilteredList<Item>({
        items: fetcher,
        key: (x) => x.id,
        filterKeys: ["name"],
      })

      await tick()
      expect(hook.flat()).toHaveLength(3)

      hook.onInput("cher")
      await tick()

      expect(lastFilter).toBe("cher")
      expect(hook.flat()).toHaveLength(1)
      expect(hook.flat()[0].name).toBe("Cherry")

      dispose()
    })
  })

  test("groups items by category", async () => {
    await createRoot(async (dispose) => {
      const groupedItems: (Item & { group: string })[] = [
        { id: "1", name: "Alpha", group: "A" },
        { id: "2", name: "Bravo", group: "A" },
        { id: "3", name: "Delta", group: "B" },
      ]
      const hook = useFilteredList<Item & { group: string }>({
        items: groupedItems,
        key: (x) => x.id,
        groupBy: (x) => x.group,
      })

      await tick()

      expect(hook.grouped.latest).toHaveLength(2)
      const groupA = hook.grouped.latest.find((g) => g.category === "A")
      expect(groupA?.items).toHaveLength(2)

      dispose()
    })
  })

  test("loading state transitions from true to false", async () => {
    await createRoot(async (dispose) => {
      const fetcher = () => Promise.resolve(items)
      const hook = useFilteredList<Item>({
        items: fetcher,
        key: (x) => x.id,
      })

      expect(hook.grouped.loading).toBe(true)

      await tick()

      expect(hook.grouped.loading).toBe(false)
      expect(hook.grouped.latest).toHaveLength(1)

      dispose()
    })
  })

  test("handles async items that return empty array", async () => {
    await createRoot(async (dispose) => {
      const fetcher = () => Promise.resolve([] as Item[])
      const hook = useFilteredList<Item>({
        items: fetcher,
        key: (x) => x.id,
      })

      await tick()

      expect(hook.grouped.loading).toBe(false)
      expect(hook.flat()).toHaveLength(0)

      dispose()
    })
  })

  test("filters async items by filterKeys after resolve", async () => {
    await createRoot(async (dispose) => {
      const fetcher = () => Promise.resolve(items)
      const hook = useFilteredList<Item>({
        items: fetcher,
        key: (x) => x.id,
        filterKeys: ["name"],
      })

      await tick()
      expect(hook.flat()).toHaveLength(3)

      hook.onInput("ban")
      await tick()

      expect(hook.flat()).toHaveLength(1)
      expect(hook.flat()[0].name).toBe("Banana")

      dispose()
    })
  })

  test("keys match flat items after async resolve", async () => {
    await createRoot(async (dispose) => {
      const fetcher = () => Promise.resolve(items)
      const hook = useFilteredList<Item>({
        items: fetcher,
        key: (x) => x.id,
      })

      await tick()

      expect(hook.flat().map((x) => x.id)).toEqual(["1", "2", "3"])

      dispose()
    })
  })

  test("initialValue is empty before first resolve", async () => {
    await createRoot(async (dispose) => {
      const fetcher = () => Promise.resolve(items)
      const hook = useFilteredList<Item>({
        items: fetcher,
        key: (x) => x.id,
      })

      expect(hook.grouped.latest).toEqual([])

      await tick()

      expect(hook.grouped.latest).not.toEqual([])

      dispose()
    })
  })
})
