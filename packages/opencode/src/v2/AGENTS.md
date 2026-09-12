# V2 session service — projection and shared-engine architecture

## Architecture: V2 is a read model backed by a shared prompt engine

The V2 session service (`v2/session.ts`) is **not** an in-progress migration target.
It is a stable two-layer design:

- **Reads** (`get`, `list`, `messages`, `context`) query the `SessionTable` /
  `SessionMessageTable` directly via Drizzle — they do **not** call V1 services and
  work without any V1 service provided.
- **Writes** (`create`, `prompt`, `shell`, `skill`, `subagent`, `compact`) use the
  existing session services. Prompt/loop operations use `SessionPrompt.Engine`,
  while session and compaction persistence still use the corresponding V1
  services. The shared engine emits `SessionEvent.*.Sync` unconditionally; the V2 projectors
  (`session/projectors-next.ts`) consume those events to populate
  `SessionMessageTable`, which is what the V2 read methods query.

In short: **V2 is the read projection and API facade; the shared prompt engine is
the writer for prompt/loop activity, with V1 persistence services retained at the
storage boundary.** `SessionPrompt.Service` remains a compatibility facade over
that engine for legacy callers (including the GitHub/workspace integrations and
the V1 prediction route).

If a future feature genuinely requires events to be the source of truth (e.g.
multi-session replay, real-time collaboration), that is a separate architectural
inversion — see the `_plan/` blueprint Step 4.

## Shared model-ID brands (unified 2026-09)

V1 and V2 share the `ModelID`/`ProviderID` brands — single authority in
`provider/schema.ts`; `v2/model.ts` re-exports them as `Modelv2.ID`/`Modelv2.ProviderID`.
No brand casts are needed at the delegation boundary. `VariantID` remains V2-local
(no V1 counterpart). The remaining reshape is field naming: V2 `Modelv2.Ref` uses
`{ id, providerID, variant }` while V1 callers (`SessionCompaction.create`, subagent
prompt) need `{ modelID, providerID }` — handled by the small `toPromptModel` helper
in `v2/session.ts`. The V2 service `prompt()` input takes the V1 model shape directly
(`{ providerID, modelID }` + separate `variant`), so no conversion happens on the
prompt path.

## V2 prompt() must pass agent to the shared engine

V2 `prompt()` delegates to `SessionPrompt.Engine.prompt`. If `agent` is not passed,
`createUserMessage` falls back to `agents.defaultAgent()`, detects
`current.agent !== info.agent`, and emits `AgentSwitched.Sync` — silently
overwriting the session's agent to the default. Always pass `agent` explicitly
when the caller knows the intended agent (e.g., `subagent()` passes `input.agent`).

## V2 Info schema — wiring new fields

The V2 `Info` schema (`v2/session.ts`) is a near-complete projection of V1 `Session.Info`.
The only intentionally omitted field is `summary.diffs` (lives in session_diff storage,
assembled by V1 separately). `revert` IS projected — it is a SessionTable JSON column and
its field schema is reused from `Session.Info.fields.revert` so both projections stay in
sync. When adding support for a new field, add it to the schema AND wire it in both
`fromRow()` (DB row → V2 Info) and `toV2Info()` (V1 Info → V2 Info). Missing `toV2Info`
causes the field to be lost when V1 `Session.create` returns data through the V2 write facade.

## V2 message reads normalize legacy persisted rows

`V2Session.messages()` and `session/projectors-next.ts` decode through
`SessionMessage.normalizeForDecode()` before applying the V2 schema. This keeps
old rows readable when a user message lacks `agent`/`model` (defaults come from
the session row, with a safe fallback) and when a provider persisted tool input
with one or more extra JSON-encoding layers. Running/completed/error tool input
must reach the V2 schema as a record; malformed input degrades to `{}` so one
bad historical tool call does not break the session history endpoint. Keep this
bounded compatibility pass until the deferred storage/backfill cleanup is
complete, and add regression coverage for any new legacy shape.

## V2 subagent() service dependencies

`subagent()` requires `Agent.Service` and `Config.Service` in addition to the V1
services already captured (`Session`, `SessionPrompt`, `SessionCompaction`,
`SessionStatus`, `Bus`, `SessionRevert`). They are captured via `Effect.serviceOption`
at layer build time. Tests must include `Agent.defaultLayer` in the infra layers —
otherwise `subagent()` dies with "V2Session.Agent requires the V1 Agent service to be provided".

`summarize()` uses the captured `SessionRevert.Service` for revert cleanup before
compaction (V1 HTTP handler parity). `fork()`/`summarize()` fail with the V2
`NotFoundError` when the session is missing; `init()` has no typed error channel
(`SessionPrompt.command` is infallible — V1's `mapError(BadRequest)` was dead code).

## PromptInput.model field names differ from V2 Modelv2.Ref

V1 `PromptInput.model` uses `{ modelID, providerID }` (no `id` or `variant`). V2
`Modelv2.Ref` uses `{ id, providerID, variant }`. When passing a `Modelv2.Ref` to a V1
caller (compaction, subagent's inner prompt), map `model.id` → `modelID` and drop
`variant` via the `toPromptModel` helper. The V2 service `prompt()` input already uses
the V1 shape, so its delegation passes `model`/`variant`/`messageID` straight through.

## SessionPrompt prompt blocks until loop finishes

`SessionPrompt.Engine.prompt` runs the agent loop synchronously (unless `noReply: true`);
the V1 `SessionPrompt.Service` facade has the same behavior. It returns
`MessageV2.WithParts` after the loop completes. Calling `forkChild()` +
`wait()` after `prompt()` is redundant — the result is already available when
`prompt()` returns.

## V2 subagent() posts results synthetically

`subagent()` posts the child's final assistant text back to the parent session as a
`SessionEvent.Synthetic.Sync` message (so callers observing the parent can see the
result). The `subagent()` interface returns `void`. This is the delegation design —
the child loop is driven via the shared engine, and the result is surfaced through
the event projection. If a caller needs the structured return value, it should read the
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

## Three session.next.* message reducers are intentionally separate

Message-state logic for `session.next.*` events exists in three places and is
NOT unified into one module: (1) the server projector
(`v2/session-message-updater.ts` + `Adapter` seam) persists via SQL and uses
internal Effect Schema types; (2) the TUI client reducer
(`cli/cmd/tui/context/sync-messages.shared.ts`) operates on the V2
`SessionMessage` model, newest-first; (3) the app reducer
(`packages/app/src/context/global-sync/event-reducer.ts`) maintains V1-shaped
`message`/`part` maps with load-bearing app semantics (optimistic eviction,
comment-note synthetics, shell two-message expansion, deterministic part-ID
contract shared with the load path). An architecture review (2026-09-12)
evaluated full unification and rejected it: the app reducer is a different
module, not a copy — forcing one reducer would require an adapter whose
complexity exceeds the duplication (deletion test fails). Shared pieces DO
live in the SDK: `eventTime` at `@opencode-ai/sdk/v2/event-time` (single copy;
previously duplicated in TUI and app). Revisit only if app migrates its render
pipeline to the V2 message model.
