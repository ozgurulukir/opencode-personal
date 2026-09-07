# V2 session service — delegation architecture

## Architecture: V2 is a read model + V1-delegating write facade (by design)

The V2 session service (`v2/session.ts`) is **not** an in-progress migration target.
It is a stable two-layer design:

- **Reads** (`get`, `list`, `messages`, `context`) query the `SessionTable` /
  `SessionMessageTable` directly via Drizzle — they do **not** call V1 services and
  work without any V1 service provided.
- **Writes** (`create`, `prompt`, `shell`, `skill`, `subagent`, `compact`) delegate
  to the V1 services (`Session`, `SessionPrompt`, `SessionCompaction`). V1 owns the
  agent loop and all persistence. The V1 write path emits `SessionEvent.*.Sync`
  unconditionally; the V2 projectors
  (`session/projectors-next.ts`) consume those events to populate
  `SessionMessageTable`, which is what the V2 read methods query.

In short: **V1 is the writer and source of truth; V2 is a read projection plus a
thin API facade that delegates writes back through V1.** This is the intended
architecture, not a transitional state. The earlier `TODO(v2-native)` markers have
been removed; each delegation site now carries a comment explaining *why* it
delegates (the V1 service already handles the concern correctly).

If a future feature genuinely requires events to be the source of truth (e.g.
multi-session replay, real-time collaboration), that is a separate architectural
inversion — see the `_plan/` blueprint Step 4. Do not assume the current code is
"halfway there"; it is a complete delegation bridge.

## Shared model-ID brands (unified 2026-09)

V1 and V2 share the `ModelID`/`ProviderID` brands — single authority in
`provider/schema.ts`; `v2/model.ts` re-exports them as `Modelv2.ID`/`Modelv2.ProviderID`.
No brand casts are needed at the delegation boundary. `VariantID` remains V2-local
(no V1 counterpart). The only remaining reshape is field naming: V1 `PromptInput.model`
uses `{ modelID, providerID }` while V2 `Modelv2.Ref` uses `{ id, providerID, variant }` —
handled by the small `toPromptModel` helper in `v2/session.ts`.

## V2 prompt() must pass agent to V1

V2 `prompt()` delegates to V1 `SessionPrompt.prompt`. If `agent` is not passed, V1
`createUserMessage` falls back to `agents.defaultAgent()`, detects
`current.agent !== info.agent`, and emits `AgentSwitched.Sync` — silently
overwriting the session's agent to the default. Always pass `agent` explicitly
when the caller knows the intended agent (e.g., `subagent()` passes `input.agent`).

## V2 Info schema — wiring new fields

The V2 `Info` schema (`v2/session.ts`) is a partial projection of V1 `Session.Info`
(some V1 fields are intentionally not surfaced: `permission`, `revert`, `summary`,
`share`, `version`). When adding support for a new field, add it to the schema AND
wire it in both `fromRow()` (DB row → V2 Info) and `toV2Info()` (V1 Info → V2 Info).
Missing `toV2Info` causes the field to be lost when V1 `Session.create` returns data
through the delegation bridge.

## V2 subagent() service dependencies

`subagent()` requires `Agent.Service` and `Config.Service` in addition to the V1
services already captured (`Session`, `SessionPrompt`, `SessionCompaction`,
`SessionStatus`, `Bus`). They are captured via `Effect.serviceOption` at layer build
time. Tests must include `Agent.defaultLayer` in the infra layers — otherwise
`subagent()` dies with "V2Session.Agent requires the V1 Agent service to be provided".

## V1 PromptInput.model field names differ from V2 Modelv2.Ref

V1 `PromptInput.model` uses `{ modelID, providerID }` (no `id` or `variant`). V2
`Modelv2.Ref` uses `{ id, providerID, variant }`. When passing model from V2 to V1,
map `model.id` → `modelID` and drop `variant`. See `v2/session.ts` `prompt()`
implementation (uses the `toPromptModel` helper).

## V1 SessionPrompt.prompt blocks until loop finishes

V1 `SessionPrompt.prompt` runs the agent loop synchronously (unless `noReply: true`).
It returns `MessageV2.WithParts` after the loop completes. Calling `forkChild()` +
`wait()` after `prompt()` is redundant — the result is already available when
`prompt()` returns.

## V2 subagent() posts results synthetically

`subagent()` posts the child's final assistant text back to the parent session as a
`SessionEvent.Synthetic.Sync` message (so callers observing the parent can see the
result). The `subagent()` interface returns `void`. This is the delegation design —
the child loop is driven via V1, and the result is surfaced through the event
projection. If a caller needs the structured return value, it should read the
synthetic message from the parent's `messages()`.

## V2 subagent() fallback deny rules when parent agent is not found

When the parent session's agent is not found (e.g., deleted or renamed), `subagent()`
applies a conservative fallback deny ruleset (`edit`, `write`, `bash` denied) instead
of silently skipping all parent agent deny rules. This closes a security hole where
Plan Mode's `edit: { "*": "deny" }` would be bypassed if the parent agent was missing.
The fallback is applied via `Effect.catchCause` in `v2/session.ts` and matches V1
`tool/task.ts` behavior.

## V2 subagent() max nesting depth

`subagent()` enforces a maximum nesting levels of `MAX_SUBAGENT_NESTING_LEVELS = 3` (defined in
`agent/subagent-permissions.ts`). The depth check walks the `parentID` chain
iteratively before creating the child session. If the chain length is already 3 or
more, the subagent creation is rejected with an error. This prevents deeply nested
recursive subagents from causing resource exhaustion.

## V2 subagent() error handling — use `Effect.fail`, not `Effect.die`

V2 `subagent()` uses `Effect.fail` for max nesting depth exceeded (recoverable typed
error), matching V1 `tool/task.ts`. Do NOT use `Effect.die` here — the caller may want
to catch and surface the error gracefully. Tests should use `Effect.catch`, not
`Effect.catchDefect`, for this path.

## V2 subagent() empty output detection

When the subagent's final assistant message has zero content parts, post a distinct
synthetic message ("Subagent produced no output parts.") instead of falling back to
the generic "completed without producing a text response." This helps the parent LLM
distinguish between "had parts but none were text" and "completely empty output."

## V2 subagent() release handler must catch `cancelChild` errors

`Effect.acquireUseRelease`'s release handler runs during cleanup. If `cancelChild`
fails there, the defect propagates uncaught. Wrap `yield* cancelChild` in
`Effect.catch` to log and suppress cleanup errors, matching the V1 TaskTool pattern
(`tool/task.ts:173`).

## V2 subagent() accepts `description` for child session titles

The V2 `subagent()` interface now includes `description?: string`. The child session
title is `${input.description ?? "Subagent"} @${input.agent}`, matching the V1
TaskTool's title format (`tool/task.ts:138`). This makes subagent sessions identifiable
in the session list.

## V2 `messages()` order is safe for `find()` — no compaction reordering

V2 `messages()` queries `SessionMessageTable` directly via Drizzle with `ORDER BY
time_created DESC, id DESC`. Unlike V1's in-memory `filterCompacted()`, the V2 read
path does **not** reorder messages. So `messages.find(m => m.type === "assistant")`
reliably returns the most recent assistant message. Reserve `MessageV2.latest()` for
V1 paths where compaction reordering is possible.

## V2 subagent() error handler — use `Cause.squash(cause)` for context

When posting synthetic error messages to the parent, use `Cause.squash(cause)` instead
of manual `cause instanceof Error` checks. `Cause.squash` flattens composite causes
(`parallel`, `sequential`, `nested`) into a single error with full context, producing
more actionable error messages for the parent LLM.
