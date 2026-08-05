# LSP Module

## Per-client diagnostic maps grow unbounded without explicit cleanup

`lsp/client.ts` maintains `pushDiagnostics`, `pullDiagnostics`, `published`, `files`, `diagnosticRegistrations`, and `registrationListeners` — all Maps/Sets keyed by file path. Every unique file touched by the LSP server adds an entry. The `shutdown()` method must clear these explicitly; `connection.dispose()` does NOT clean them up. Without this, a long-lived LSP client leaks diagnostic data for every file opened during its lifetime.

## `textDocument/didClose` is client→server only — `onNotification` never fires

`connection.onNotification("textDocument/didClose", ...)` is dead code: `didClose` is a client→server notification, not a server→client notification. The handler is never triggered. To clean up diagnostic state when a file is closed, call `notify.close({ path })` from the client side (which sends `didClose` to the server AND clears local maps).

## `touchFile` only opens, never closes — LRU cleanup lives in `notify.open`

`lsp.touchFile` calls `client.notify.open()` but never calls `notify.close()`. Over a long session this unbounds the diagnostic maps. The fix is an LRU guard inside `notify.open`: when `Object.keys(files).length >= MAX_OPEN_FILES` and the file isn't already open, close the oldest entry before opening the new one. This bounds memory growth without requiring callers to track close events.

## `typescript-language-server` memory cap via `maxTsServerMemory`

`typescript-language-server` reads `maxTsServerMemory` from LSP `initializationOptions` and passes it as `--max-old-space-size=<MB>` to the spawned `tsserver.js` process (`cli.mjs:18730`). opencode's builtin Typescript server sets this in `lsp/server.ts:119` — override with `OPENCODE_TSSERVER_MAX_MEMORY` env var. Without it, tsserver runs with Node's default (~4 GB on 64-bit), which can cause swap thrashing on large monorepos.

## `broken` Set permanently blacklists server+root combinations

`lsp/lsp.ts:208` — once an LSP server fails to spawn for a given root, `root + server.id` is added to `s.broken` and never retried for the instance lifetime. This is intentional (avoid repeated spawn failures), but the Set must be cleared on instance finalizer or stale failures prevent future LSP features from working after a transient error resolves.

## LSP client `files` record is the SSOT for open document state

`lsp/client.ts:301` — `files: Record<string, { version: number; text: string }>` tracks every file opened via `notify.open()`. The `version` counter increments on each `didChange`. This is separate from the diagnostic maps and must also be cleaned on shutdown. Use `delete` on each key (not reassignment) since the record is a plain object, not a Map.

## `notify.open` deletes the path from all diagnostic maps on open

`lsp/client.ts:689-691` — `notify.open` calls `pushDiagnostics.delete`/`pullDiagnostics.delete`/`published.delete` for the path being opened. So a file opened via `notify.open` is ABSENT from the diagnostic maps until the server pushes diagnostics for it afterward. Tests that assume an opened file is present in `pushDiagnostics`/`published` will fail — you must push diagnostics for it first.

## Bounding a Map in a handler that then adds an entry: use `>= MAX` and evict to `MAX-1`

When an LRU guard runs inside a handler that adds an entry to the same Map, `if (size > MAX) { evict to MAX }` oscillates at `MAX+1` (evict to 200, then add → 201), making bound tests flaky. Use `if (size >= MAX) { evict to MAX-1 }` so the in-flight entry keeps the map at exactly `MAX`. See the `MAX_DIAGNOSTICS` eviction in the `publishDiagnostics` handler.
