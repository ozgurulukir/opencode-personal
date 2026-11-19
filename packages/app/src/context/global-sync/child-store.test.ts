import { describe, expect, test } from "bun:test"
import { createRoot, getOwner } from "solid-js"
import { createStore } from "solid-js/store"
import type { State } from "./types"
import { createChildStoreManager } from "./child-store"

const child = () => createStore({} as State)

describe("createChildStoreManager", () => {
  test("does not evict the active directory during mark", () => {
    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      translate: (key) => key,
      getSdk: () => null!,
      global: { provider: () => null! },
    })

    Array.from({ length: 30 }, (_, index) => `/pinned-${index}`).forEach((directory) => {
      manager.children[directory] = child()
      manager.pin(directory)
    })

    const directory = "/active"
    manager.children[directory] = child()
    manager.mark(directory)

    expect(manager.children[directory]).toBeDefined()
  })

  test("ensureChild ignores empty directory without registering an empty key", () => {
    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    const manager = createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      translate: (key) => key,
      getSdk: () => null!,
      global: { provider: () => null! },
    })

    const origError = console.error
    console.error = () => {}
    try {
      const [store] = manager.ensureChild("")
      expect(store.status).toBe("loading")
      expect(manager.children[""]).toBeUndefined()
    } finally {
      console.error = origError
    }
  })

  test("reads the global provider through an accessor, not at construction", () => {
    const owner = createRoot((dispose) => {
      const current = getOwner()
      dispose()
      return current
    })
    if (!owner) throw new Error("owner required")

    let reads = 0
    createChildStoreManager({
      owner,
      isBooting: () => false,
      isLoadingSessions: () => false,
      onBootstrap() {},
      onDispose() {},
      translate: (key) => key,
      getSdk: () => null!,
      global: {
        provider: () => {
          reads++
          return null!
        },
      },
    })

    // Construction must not snapshot the provider (it was empty while loading);
    // the child store getter calls the accessor on each read instead.
    expect(reads).toBe(0)
  })
})
