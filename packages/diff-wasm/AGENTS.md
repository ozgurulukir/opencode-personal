# diff-wasm package

## WASM fallback retry pattern

When the WASM import fails, do NOT reset `wasmReady = null` — this causes every
subsequent call to re-attempt the failed import, adding latency to every diff
operation. Use a separate `wasmFailed` boolean flag so failed calls skip directly
to the JS fallback.

```ts
let wasmReady: Promise<void> | null = null
let wasmFailed = false

function ensureWasm(): Promise<void> {
  if (wasmFailed) return wasmReady! // already failed, use the rejected promise
  if (wasmReady === null) {
    wasmReady = import(WASM_JS_PATH)
      .then(...)
      .catch((err) => {
        wasmFailed = true // permanent failure flag
        throw err
      })
  }
  return wasmReady!
}
```

## Type casts at library boundaries

`formatPatch` and `applyPatch` bridge between the custom `ParsedDiff` type and the
`diff` library's internal types. Prefer `as unknown as` with a comment explaining
structural compatibility over bare `as any`:

```ts
export function formatPatch(diff: ParsedDiff): string {
  // ParsedDiff is structurally compatible with diff's internal format
  return jsFormatPatch(diff as unknown as Parameters<typeof jsFormatPatch>[0])
}
```