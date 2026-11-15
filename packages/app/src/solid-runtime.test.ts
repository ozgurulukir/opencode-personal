import { describe, expect, test } from "bun:test"
import { createEffect, createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"

// Canary for the test runtime. `bunfig.toml` preloads `solid-client.ts`, which
// forces solid-js' client build. Without it Bun resolves the SSR build, where
// createEffect is a no-op and the app's effect-driven tests fail silently.
// This fails loudly if that preload is removed or solid-js' export map changes.
describe("test runtime", () => {
  test("solid-js effects run from the client build", async () => {
    const [read, write] = createSignal(0)
    const seen: number[] = []
    let dispose!: () => void

    createRoot((d) => {
      dispose = d
      createEffect(() => {
        seen.push(read())
        if (seen.length === 1) write(1)
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    dispose()

    expect(seen).toEqual([0, 1])
  })

  test("solid-js/store notifies effects from the client build", async () => {
    const [state, setState] = createStore({ count: 0 })
    const seen: number[] = []
    let dispose!: () => void

    createRoot((d) => {
      dispose = d
      createEffect(() => {
        seen.push(state.count)
        if (seen.length === 1) setState("count", 1)
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    dispose()

    expect(seen).toEqual([0, 1])
  })
})
