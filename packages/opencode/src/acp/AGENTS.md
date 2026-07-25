# ACP Agent Implementation Guide

## Module layout

The ACP module is decomposed into focused files:

- `agent.ts` — Thin orchestrator: Agent class with session lifecycle, event loop, prompt handling
- `tool-dispatch.ts` — Tool state machine: `handleToolPartUpdate`, `toolStart`, `shellOutput`, `toToolKind`, `toLocations`, `completedToolContent`, `completedToolRawOutput`
- `model-resolution.ts` — Model fallback chain: `defaultModel`, `lastUsedModel`, `getContextLimit`, `sendUsageUpdate`
- `session-config.ts` — Pure functions for mode/model selection: `sortProvidersByName`, `modelVariantsFromProviders`, `buildAvailableModels`, `formatModelIdWithVariant`, `buildVariantMeta`, `parseModelSelection`, `buildConfigOptions`, `formatVariantName`
- `message-replay.ts` — Session replay: `processMessage`, `parseUri`, `getNewContent`
- `session.ts` — `ACPSessionManager` (in-memory session store)
- `types.ts` — Shared types (`ACPConfig`, `ACPSessionState`)

## `McpServer` type narrowing

`McpServer` is a union of four variants: `McpServerHttp & { type: "http" }`, `McpServerSse & { type: "sse" }`, `McpServerAcp & { type: "acp" }`, and `McpServerStdio` (no `type` field).

- `McpServerAcp` has `name` and `id` only — no `url` or `headers`. The old `"type" in server` check is insufficient because `McpServerAcp` also has `type`. Check `server.type === "http" || server.type === "sse"` to narrow to variants with `url`/`headers`.
- `McpServerStdio` is the only variant without a `type` field. Use `"type" in server` to distinguish Stdio from the other three.

## `setSessionMode` vs `setSessionConfigOption`

The SDK renamed `unstable_setSessionModel` to `setSessionMode`, but the new method sets the **mode** (not the model). Setting the model is now done via `setSessionConfigOption` with `configId: "model"`. The old `unstable_setSessionModel` method should be removed entirely when upgrading — its functionality is fully covered by `setSessionConfigOption`.

## Session manager is in-memory only

`ACPSessionManager` stores sessions in a plain `Map<string, ACPSessionState>` with no persistence or serialization. When the ACP process restarts, the Map is empty. Clients like Zed store session IDs across restarts and will get "Session not found" errors on subsequent `prompt`/`setSessionMode` calls unless `getOrLoad()` auto-recovers from the server.

## `get()` (throws) vs `tryGet()` (silent drop) dual pattern

Agent API methods (`prompt`, `setSessionMode`, `cancel`) use `sessionManager.get()` which throws "Session not found" when the session isn't in the in-memory Map. `handleEvent` uses `sessionManager.tryGet()` which returns `undefined` — live events (tool results, text deltas, permissions) for unknown sessions are silently dropped. Both should use `getOrLoad()`/`tryGetOrLoad()` to auto-recover from the server.

## ACP protocol methods don't send `cwd` with every request

Only `newSession`, `loadSession`, `resumeSession`, and `forkSession` include `cwd`. Methods like `prompt`, `setSessionMode`, `setSessionConfigOption`, and `cancel` only send `sessionId`. The ACP agent must store `cwd` per-session in `ACPSessionState.cwd` and cannot rely on the client to provide it for subsequent calls.

## `pendingLoads` Map for concurrent request deduplication

`getOrLoad()` uses a `Map<string, Promise<ACPSessionState>>` with `finally` cleanup to deduplicate concurrent server calls for the same session ID. This is a simple alternative to `Effect.cached` for non-Effect code. The `finally` block is critical — without it, a failed promise stays in the map and blocks future recovery.

## `handleToolPartUpdate` deduplicates tool state logic

The tool state switch (pending/running/completed/error + todowrite plan) was duplicated verbatim between `handleEvent` (live events) and `processMessage` (session replay). Extracted into `handleToolPartUpdate()` — both callers now delegate to it. The shell snapshot dedup (hash-based output dedup for shell tools) was only in `handleEvent`; it's safe to apply to `processMessage` too since the snapshot map is empty during replay.

## ACP test pattern: `createTestAgent()` + standalone functions

ACP tests use a `createTestAgent()` helper that creates a real `ACP.Agent` with a minimal mock `AgentSideConnection` and captures `sessionUpdates`. The helper also returns `connection`, `shellSnapshots`, and `toolStarts` for calling standalone functions like `processMessage` directly. Private methods like `handleEvent` are still accessed via `(agent as any)`. The `sessionManager.sessions` Map is populated directly via `(agent as any).sessionManager.sessions.set(...)` for tests that need a pre-existing session. Tests use `mock.function()` (not `mock.module()`) for SDK stubs, with `afterAll(() => mock.restore())` cleanup.
