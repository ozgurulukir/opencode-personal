# V2 session service

## V2 prompt() must pass agent to V1

V2 `prompt()` delegates to V1 `SessionPrompt.prompt`. If `agent` is not passed, V1 `createUserMessage` (`session/prompt.ts:1011`) falls back to `agents.defaultAgent()`, detects `current.agent !== info.agent`, and emits `AgentSwitched.Sync` — silently overwriting the session's agent to the default. Always pass `agent` explicitly when the caller knows the intended agent (e.g., `subagent()` passes `input.agent`).

## V2 Info schema — commented-out V1 fields

The V2 `Info` schema (`v2/session.ts`) is a partial copy of V1 `Session.Info` with some fields commented out (e.g., `permission`, `revert`, `summary`, `share`). When adding support for a new field, uncomment it in the schema AND wire it in both `fromRow()` (DB row → V2 Info) and `toV2Info()` (V1 Info → V2 Info). Missing `toV2Info` causes the field to be lost when V1 `Session.create` returns data through the delegation bridge.

## V2 subagent() service dependencies

`subagent()` requires `Agent.Service` and `Config.Service` in addition to the V1 services already captured (`Session`, `SessionPrompt`, `SessionCompaction`, `SessionStatus`, `Bus`). They are captured via `Effect.serviceOption` at layer build time. Tests must include `Agent.defaultLayer` in the infra layers — otherwise `subagent()` dies with "V2Session.Agent requires the V1 Agent service to be provided".

## V1 PromptInput.model field names differ from V2 Modelv2.Ref

V1 `PromptInput.model` uses `{ modelID, providerID }` (no `id` or `variant`). V2 `Modelv2.Ref` uses `{ id, providerID, variant }`. When passing model from V2 to V1, map `model.id` → `modelID` and drop `variant`. See `v2/session.ts` `prompt()` implementation.

## V1 SessionPrompt.prompt blocks until loop finishes

V1 `SessionPrompt.prompt` runs the agent loop synchronously (unless `noReply: true`). It returns `MessageV2.WithParts` after the loop completes. Calling `forkChild()` + `wait()` after `prompt()` is redundant — the result is already available when `prompt()` returns.
