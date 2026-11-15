import { mock } from "bun:test"
import * as solid from "solid-js/dist/solid.js"
import * as store from "solid-js/store/dist/store.js"

// Bun resolves `solid-js` to its SSR build (dist/server.js) by default. App
// tests exercise client reactivity (createEffect, createStore), so force the
// client builds here. This mirrors `--conditions=browser`, which Bun cannot
// read from bunfig.toml, and keeps bare `bun test` working without flags.
await mock.module("solid-js", () => solid)
await mock.module("solid-js/store", () => store)
