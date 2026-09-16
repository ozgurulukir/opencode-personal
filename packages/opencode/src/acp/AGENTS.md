# ACP Agent Implementation Guide

## Module layout

## ACP test pattern: V2 SDK surface

ACP tests must stub the **V2** SDK surface: session auto-recovery and creation go through `sdk.v2.session.get/create`, the replay path reads `sdk.v2.session.messages` returning `{ data: { items } }` (V1 shape was `{ data: [...] }` via `sdk.session.messages`), and permission replies go through `sdk.permission.reply` (not `respond`). V2 projected messages use `type: "user"|"assistant"` with `content[]` items (not `role`/`parts`); user/assistant messages need a `model: { providerID, id }` field for `restoreSessionStateFromMessages`. V2 replay tool items key the ACP `toolCallId` off the item `id` — live stream progress events are keyed by `callID`, so fixtures set `id === callID` for pending-after-replay continuity. V2 `session.next.*` event properties require a `timestamp` field (also on the wire from `EventV2.define` schemas).

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

## Live event wire is V2-only (`session.next.*`)

Since the V1/V2 consumer migration, `handleEvent` handles **only** V2 `session.next.*` events: `session.next.text.delta`, `session.next.reasoning.delta`, `session.next.tool.called|progress|success|failed`, and `session.next.permission.asked` (the V1 permission request is nested under `properties.request`). V1 `message.part.*` events still flow on the global stream (SyncEvent dual delivery) but are **intentionally ignored** by the live loop — historical content reaches ACP clients only through the replay path (`loadSession` → `sdk.v2.session.messages` → `processMessage`).

V2 tool events carry only `callID` (+ `structured`/`content`), no tool name or input — the name/input recorded at `tool.called` is reused for later updates (`ToolCallInfo` registry), so `tool.called` must arrive before any progress/success/failed event is reflected. `session.next.permission.asked` wraps the whole V1 request under `properties.request`; read `permission.tool?.callID ?? permission.id` for the ACP `toolCallId`.

## ACP test pattern: `createTestAgent()` + standalone functions

ACP tests use a `createTestAgent()` helper that creates a real `ACP.Agent` with a minimal mock `AgentSideConnection` and captures `sessionUpdates`. The helper also returns `connection`, `shellSnapshots`, and `toolStarts` for calling standalone functions like `processMessage` directly. Private methods like `handleEvent` are still accessed via `(agent as any)`. The `sessionManager.sessions` Map is populated directly via `(agent as any).sessionManager.sessions.set(...)` for tests that need a pre-existing session. Tests use `mock.function()` (not `mock.module()`) for SDK stubs, with `afterAll(() => mock.restore())` cleanup.

## ACP terminal backend lifecycle

`terminal-backend.ts` selects the backend per ACP session. The default is
`auto`: `clientCapabilities.terminal === true` selects the client terminal;
otherwise shell execution stays local. `OPENCODE_ACP_TERMINAL_BACKEND=client`
requires the client capability and fails before execution when it is absent;
`local` disables ACP terminals. Never fall back to local execution after
`terminal/create` has been attempted, because that can execute a command twice.

Client terminal handles are registered by `sessionID:callID`. Normal completion
uses `releaseClientTerminal`; interruption, timeout, session close, or event
stream shutdown uses `terminateClientTerminal` (`kill` then `release`). Both
paths are idempotent. When changing this lifecycle, update
`test/acp/terminal-backend.test.ts` and cover capability fallback, one-time
cleanup, and session isolation.

ACP shell text content is sent as a fenced code block so clients that render
`ToolCallContent` text as Markdown cannot reinterpret command output. The
unformatted value must remain in `rawOutput`. `handleShellStarted` sends the
command tool call but must not emit an empty synthetic `in_progress` update;
that update appears as a repetitive `working...` card in clients such as Zed.
