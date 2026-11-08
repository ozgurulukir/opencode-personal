# Agent system

## subagentToolRestrictions has() — only allow rules count as "having" permission

`subagentToolRestrictions` checks `subagent.permission.some((r) => r.permission === id && r.action === "allow")` to decide whether to add `{ tool: false }`. A deny rule (`action: "deny"`) does NOT count as "having" the permission — so `general` agent (which has `todowrite: "deny"`) DOES get `{ todowrite: false }` in its tools map. The tool is hidden from the LLM entirely, not just blocked at the permission layer. Only tools with an explicit `allow` rule avoid being `false`d.

## primary_tools — allow in permission, false in tools

`primary_tools` are simultaneously `allow`ed in the session permission (`subagentSessionPermission`) and `false`d in the tools list (`subagentToolRestrictions`). This is intentional: session permission `allow` means slash-command invocations don't block, but tools list `false` means the LLM can't call them directly. Primary tools are for the primary agent only; indirect access via slash commands is permitted. This intent now holds at runtime: `prompt()` excludes `primary_tools` keys from the tools→permission merge (`session/prompt.ts:216-218`, dedupe at `:222`) so these allows are not killed after the first prompt.

## `deriveSubagentSessionPermission` — full parent-session spread, parent-agent deny-filtered, dedupe last-wins

`deriveSubagentSessionPermission` spreads the **FULL** `parentSessionPermission` (`agent/subagent-permissions.ts:94`) — parent session allows/asks/directory rules are forwarded as-is. Only the parent-**agent** contribution is deny-filtered (`subagent-permissions.ts:92`: `parentAgent.permission.filter(rule => rule.action === "deny")`); parent agent allows/asks do not automatically grant subagent access, while agent-level denies (e.g. Plan Mode) ride along last. Default `task`/`todowrite` denies are appended when the subagent's own ruleset lacks them. `Permission.dedupe()` collapses duplicate `(permission, pattern)` entries keeping the last occurrence (last match wins in `evaluate`), so parent agent denies (listed last) take priority over parent session denies for the same key.

## `prompt()` must merge, not overwrite, session permission

`prompt()` converts `input.tools` to permission rules via `toolsToPermissions` at `session/prompt.ts:215-223` (primary_tools keys stripped at `:216-218`, `Permission.dedupe(Permission.merge(...))` at `:222`) and **must use `Permission.merge(session.permission ?? [], permissions)`**, not overwrite (`session.permission = permissions`). Overwriting destroys parent denies set by `subagentSessionPermission`, making Plan Mode's `edit: { "*": "deny" }` ineffective at runtime (the #26514 fix). Tests that stub `prompt()` (e.g., `v2/session.test.ts`) don't catch this — only a real `prompt()` call triggers the overwrite path.

## `prompt.ts` has two `ctx.ask` wiring points with different ruleset composition

**Normal tool execution** (`session/loop/tools.ts:118`): `ruleset: Permission.merge(input.agent.permission, input.session.permission ?? [])` — merges the CURRENT session's agent permission with the current session's permission.

**Subagent task execution** (`session/loop/subtask.ts:148`): `ruleset: Permission.merge(parentAgent?.permission ?? [], session.permission ?? [])` — merges the **parent's** agent permission (resolved at `subtask.ts:138`) with the **PARENT** session's permission, NOT the subagent session's permission. `taskAgent` at `subtask.ts:139-146` is an existence-check only (it throws `Unknown` when the named agent is missing) — agents are never mutated, and the child's derived permission lives on the session row via `subagentSessionPermission`, not on any agent object. Command subtasks set `bypassAgentCheck: true` (`subtask.ts:159`), bypassing the spawn ask while deny evaluation still applies.

This distinction matters when debugging permission prompts inside subagents: the `ruleset` evaluated at `session/loop/subtask.ts:148` does not include the subagent session's `subagentSessionPermission` deny rules — those live on the child session row (via `subagentSessionPermission`), not on any agent's `permission` field.

## Shared helpers between V1 and V2

Two shared modules hold the V1/V2 subagent parity surface — both must be used by V1 `tool/task.ts` (TaskTool) and V2 `v2/session.ts` (subagent method); do not inline their logic at a call site.

`agent/subagent-permissions.ts` — permission derivation and spawn gating:

- `subagentSessionPermission()` / `subagentToolRestrictions()`: child ruleset derivation and tools-map restrictions.
- `resolveParentAgent()`: parent-agent resolution with `FALLBACK_DENY` on null/not-found/defect. Returns only `{ permission }` (a structural supertype of `Agent.Info`) — consumers read nothing else. Its output feeds CHILD permission derivation only.
- `checkNesting()`: depth walk before spawn.
- `taskDenyGate()` / `taskDenyGateFromRuleset()`: the pre-spawn deny check (deny rule on `task` × subagent type blocks the spawn, exact shared "Permission denied: task tool cannot spawn subagent ..." message). CRITICAL: `gateAgentPermission` must be the gate agent's RAW live permission (V1: the loop's agent permission from `session/loop/tools.ts`; V2: the parent's live agent permission re-resolved for the gate) — NEVER `resolveParentAgent`'s output. `FALLBACK_DENY` carries `task:*`, which would refuse every spawn from an agent-less parent; the fallback applies to child permission only. V1's `ctx.extra.permissionRuleset` is pre-merged (loop agent + session rules), so TaskTool goes through `taskDenyGateFromRuleset`; V2 uses the raw-input `taskDenyGate`.

`agent/subagent-spawn.ts` — spawn choreography:

- `subagentAbortGuard()`: bridge + idempotent `onAbort` cancel + release handler (listener removal, interrupt-cancel with log-and-suppress `Effect.catch`). The `acquireUseRelease` USE-block is NOT shared — V1 propagates prompt errors while V2 posts `SessionEvent.Synthetic`, and that error-policy difference is deliberate.
- `subagentResultText()`: final-text extraction with the two pinned fallbacks ("Subagent produced no output parts." for empty parts, "Subagent completed without producing a text response." for no text part).
- `subagentTitle()`: `` `${description} (@${agent} subagent)` `` — format pinned by consumer regex (`message-timeline.tsx`) and parsed by `parseSubagentTitle()` (`subagent-footer.tsx`). Description defaulting is NOT unified: V1 `params.description || params.prompt.slice(0, 50)`, V2 `input.description ?? "Subagent"`.

## Permission requests from nested subagents

Permission asks are keyed by the session that owns the blocked tool, not by the
parent session. The TUI deliberately aggregates pending asks across the full
descendant session subtree and sends the reply back with that child `sessionID`.
Keep this routing intact when changing subagent creation, permission merging, or
session-tree navigation; limiting aggregation to the parent or direct children
leaves deeper subagents waiting indefinitely.

## Subagent session cleanup — known limitation

Subagent sessions are **not** automatically cleaned up. They persist in the database indefinitely, accumulating over time. This is a known limitation (Option C from the subagent fixes plan). The database is SQLite with bounded size, and subagent sessions are small rows, so this is acceptable for typical usage. If cleanup becomes necessary, it can be addressed later with a simple TTL or parent-session-completion hook. Per the wabi-sabi philosophy, we avoid over-engineering a GC system until there is a demonstrated need.

## MAX_SUBAGENT_NESTING_LEVELS naming — depth check is inclusive

`MAX_SUBAGENT_NESTING_LEVELS = 3` with `depth >= MAX_SUBAGENT_NESTING_LEVELS` allows
exactly 2 levels of nesting (root → child → grandchild), not 3. The constant name
uses "levels" rather than "depth" to avoid the off-by-one implication. If the
intent is to allow 3 actual nesting levels, change the check to `depth > MAX_SUBAGENT_NESTING_LEVELS`.
