# LSP Module

## Per-client diagnostic maps grow unbounded without explicit cleanup

`lsp/client.ts` maintains `pushDiagnostics`, `pullDiagnostics`, `published`, `files`, `diagnosticRegistrations`, and `registrationListeners` — all Maps/Sets keyed by file path. Every unique file touched by the LSP server adds an entry. The `shutdown()` method must clear these explicitly; `connection.dispose()` does NOT clean them up. Without this, a long-lived LSP client leaks diagnostic data for every file opened during its lifetime.

## `broken` Set permanently blacklists server+root combinations

`lsp/lsp.ts:208` — once an LSP server fails to spawn for a given root, `root + server.id` is added to `s.broken` and never retried for the instance lifetime. This is intentional (avoid repeated spawn failures), but the Set must be cleared on instance finalizer or stale failures prevent future LSP features from working after a transient error resolves.

## LSP client `files` record is the SSOT for open document state

`lsp/client.ts:301` — `files: Record<string, { version: number; text: string }>` tracks every file opened via `notify.open()`. The `version` counter increments on each `didChange`. This is separate from the diagnostic maps and must also be cleaned on shutdown. Use `delete` on each key (not reassignment) since the record is a plain object, not a Map.
