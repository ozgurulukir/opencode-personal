# V2 session service — delegation architecture

## Architecture: V2 is a read model + V1-delegating write facade (by design)

The V2 session service (`v2/session.ts`) is **not** an in-progress migration target.
It is a stable two-layer design:

- **Reads** (`get`, `list`, `messages`, `context`) query the `SessionTable` /
  `SessionMessageTable` directly via Drizzle — they do **not** call V1 services and
  work without any V1 service provided.
- **Writes** (`create`, `prompt`, `shell`, `skill`, `subagent`, `compact`) delegate
  to the V1 services (`Session`, `SessionPrompt`, `SessionCompaction`). V1 owns the
  agent loop and all persistence. The V1 write path dual-writes `SessionEvent.*.Sync`
  events (gated by `Flag.OPENCODE_EXPERIMENTAL_EVENT_SYSTEM`); the V2 projectors
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

## V1/V2 model-ID brand mismatch — use the cast helpers

V1 `ModelID` is `Schema.String.pipe(Schema.brand("ProviderID"))`-adjacent (defined
in `provider/schema.ts`); V2 `Modelv2.ID` is `Schema.brand("Model.ID")`. They are
structurally identical strings but nominally distinct branded types, so passing a
V2 model ref into a V1 call requires a brand cast. Rather than scattering
`as unknown as ModelID` across the file, use the centralized helpers in
`v2/session.ts`: `v2ModelToV1Session(ref)` (for `Session.create`, which expects
`{id, providerID, variant?}`) and `v2ModelToV1Prompt(ref)` (for `PromptInput.model`
/ `SessionCompaction.create`, which expect `{modelID, providerID}`). The cast is
unavoidable without unifying the two brand systems, which is out of scope for the
delegation design.

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
implementation (uses the `v2ModelToV1Prompt` helper).

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
