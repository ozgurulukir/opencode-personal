# LSP Module

## Per-client diagnostic maps grow unbounded without explicit cleanup

`lsp/client.ts` maintains `pushDiagnostics`, `pullDiagnostics`, `published`, `files`, `diagnosticRegistrations`, and `registrationListeners` — all Maps/Sets keyed by file path. Every unique file touched by the LSP server adds an entry. The `shutdown()` method must clear these explicitly; `connection.dispose()` does NOT clean them up. Without this, a long-lived LSP client leaks diagnostic data for every file opened during its lifetime.

## `textDocument/didClose` is client→server only — `onNotification` never fires

`connection.onNotification("textDocument/didClose", ...)` is dead code: `didClose` is a client→server notification, not a server→client notification. The handler is never triggered. To clean up diagnostic state when a file is closed, call `notify.close({ path })` from the client side (which sends `didClose` to the server AND clears local maps).

## `touchFile` only opens, never closes — LRU cleanup lives in `notify.open`

`lsp.touchFile` calls `client.notify.open()` but never calls `notify.close()`. Over a long session this unbounds the diagnostic maps. The fix is an LRU guard inside `notify.open`: when `Object.keys(files).length >= MAX_OPEN_FILES` and the file isn't already open, close the oldest entry before opening the new one. This bounds memory growth without requiring callers to track close events.

## No `typescript-language-server` memory cap is configured

opencode's builtin Typescript server does not set a `maxTsServerMemory` initialization option, and there is no `OPENCODE_TSSERVER_MAX_MEMORY` env var. `typescript-language-server` runs `tsserver.js` with Node's default heap limit. Do not assume a memory cap is applied here.

## `broken` Map uses TTL + exponential backoff, not a permanent blacklist

`lsp/lsp.ts:21-33,145` — `s.broken` is a `Map<string, { attempts, lastAttempt }>`, not a Set. A failed server+root is recorded with an attempt count and a retry backoff (`1s * 2^(attempts-1)`, capped at 30s via `brokenConfig.maxBackoff`). After a 5-minute TTL (`brokenConfig.ttl`) the entry is deleted and the server is retried; a successful spawn also deletes the entry (`lsp/lsp.ts:290`). The map is cleared on instance disposal (`lsp/lsp.ts:234`). A transient failure therefore does not permanently disable LSP for that root.

## LSP client `files` record is the SSOT for open document state

`lsp/client.ts:340` — `files: Record<string, { version: number; text: string; lastUsed: number }>` tracks every file opened via `notify.open()`. The `version` counter increments on each `didChange`. This is separate from the diagnostic maps and must also be cleaned on shutdown. Use `delete` on each key (not reassignment) since the record is a plain object, not a Map.

## `notify.open` deletes the path from all diagnostic maps on open

`lsp/client.ts:704-706` — `notify.open` calls `pushDiagnostics.delete`/`pullDiagnostics.delete`/`published.delete` for the path being opened. So a file opened via `notify.open` is ABSENT from the diagnostic maps until the server pushes diagnostics for it afterward. Tests that assume an opened file is present in `pushDiagnostics`/`published` will fail — you must push diagnostics for it first.

## Bounding a Map in a handler that then adds an entry: use `>= MAX` and evict to `MAX-1`

When an LRU guard runs inside a handler that adds an entry to the same Map, `if (size > MAX) { evict to MAX }` oscillates at `MAX+1` (evict to 200, then add → 201), making bound tests flaky. Use `if (size >= MAX) { evict to MAX-1 }` so the in-flight entry keeps the map at exactly `MAX`. See the `MAX_DIAGNOSTICS` eviction in the `publishDiagnostics` handler.

## GitHub release auto-download validation (clangd, lua-language-server, kotlin-lsp)

Automated LSP server downloads validate external GitHub release metadata (`tag_name`, asset `name`, `version`) using strict semver and allowlist regexes (`/^v?[0-9]+(\.[0-9]+)*(-[a-zA-Z0-9.]+)?$/`, `/^[a-zA-Z0-9_.-]+$/`) before constructing download URLs or binary paths, preventing command-line and path injection from untrusted remote payloads.
