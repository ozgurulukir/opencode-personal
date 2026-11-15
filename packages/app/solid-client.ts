import { mock } from "bun:test"
import * as solid from "solid-js/dist/solid.js"

// Bun resolves `solid-js` to its SSR build (dist/server.js) by default, where
// createEffect is a no-op. Force the client build for tests. The store imports
// solid-js at load time, so mock solid-js first and load the store afterwards;
// Bun 1.4.2 does not override modules that were already loaded.
await mock.module("solid-js", () => solid)
const store = await import("solid-js/store/dist/store.js")
await mock.module("solid-js/store", () => store)
