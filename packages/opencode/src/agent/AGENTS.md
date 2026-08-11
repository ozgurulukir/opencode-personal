# Agent system

## subagentToolRestrictions has() — only allow rules count as "having" permission

`subagentToolRestrictions` checks `subagent.permission.some((r) => r.permission === id && r.action === "allow")` to decide whether to add `{ tool: false }`. A deny rule (`action: "deny"`) does NOT count as "having" the permission — so `general` agent (which has `todowrite: "deny"`) DOES get `{ todowrite: false }` in its tools map. The tool is hidden from the LLM entirely, not just blocked at the permission layer. Only tools with an explicit `allow` rule avoid being `false`d.

## primary_tools — allow in permission, false in tools

`primary_tools` are simultaneously `allow`ed in the session permission (`subagentSessionPermission`) and `false`d in the tools list (`subagentToolRestrictions`). This is intentional: session permission `allow` means slash-command invocations don't block, but tools list `false` means the LLM can't call them directly. Primary tools are for the primary agent only; indirect access via slash commands is permitted.

## `deriveSubagentSessionPermission` — deny-only forwarding, dedupe first-wins

`deriveSubagentSessionPermission` forwards **only deny rules and external_directory rules** from the parent, NOT allow or ask rules. This is least-privilege by design — parent allows don't automatically grant subagent access. `dedupe()` collapses duplicate `(permission, pattern)` entries keeping the first occurrence, so parent agent denies (listed first) take priority over parent session denies for the same key.

## `prompt()` must merge, not overwrite, session permission

`session/loop/tools.ts:79,103` converts `input.tools` to permission rules and **must use `Permission.merge(session.permission ?? [], permissions)`**, not overwrite (`session.permission = permissions`). Overwriting destroys parent denies set by `subagentSessionPermission`, making Plan Mode's `edit: { "*": "deny" }` ineffective at runtime (the #26514 fix). Tests that stub `prompt()` (e.g., `v2/session.test.ts`) don't catch this — only a real `prompt()` call triggers the overwrite path.

## `prompt.ts` has two `ctx.ask` wiring points with different ruleset composition

**Normal tool execution** (`session/loop/tools.ts:79`): `ruleset: Permission.merge(input.agent.permission, input.session.permission ?? [])` — merges the CURRENT session's agent permission with the current session's permission.

**Subagent task execution** (`session/loop/subtask.ts:132`): `ruleset: Permission.merge(taskAgent.permission, session.permission ?? [])` — merges the SUBAGENT's agent permission with the **PARENT** session's permission, NOT the subagent session's permission. The subagent session's permission (from `subagentSessionPermission`) is already baked into `taskAgent.permission` via the permission derivation at session creation time, so re-merging it here would double-apply deny rules.

This distinction matters when debugging permission prompts inside subagents: the `ruleset` evaluated at `session/loop/subtask.ts:132` does not include the subagent session's `subagentSessionPermission` deny rules — those live on the agent's `permission` field already.

## Shared helpers between V1 and V2

`subagentSessionPermission()` and `subagentToolRestrictions()` in `agent/subagent-permissions.ts` are shared between V1 `tool/task.ts` (TaskTool) and V2 `v2/session.ts` (subagent method). Both must use these helpers to maintain parity — any change to subagent permission derivation or tool restriction logic must go through these functions, not be inlined.

## Subagent session cleanup — known limitation

Subagent sessions are **not** automatically cleaned up. They persist in the database indefinitely, accumulating over time. This is a known limitation (Option C from the subagent fixes plan). The database is SQLite with bounded size, and subagent sessions are small rows, so this is acceptable for typical usage. If cleanup becomes necessary, it can be addressed later with a simple TTL or parent-session-completion hook. Per the wabi-sabi philosophy, we avoid over-engineering a GC system until there is a demonstrated need.

## MAX_SUBAGENT_NESTING_LEVELS naming — depth check is inclusive

`MAX_SUBAGENT_NESTING_LEVELS = 3` with `depth >= MAX_SUBAGENT_NESTING_LEVELS` allows
exactly 2 levels of nesting (root → child → grandchild), not 3. The constant name
uses "levels" rather than "depth" to avoid the off-by-one implication. If the
intent is to allow 3 actual nesting levels, change the check to `depth > MAX_SUBAGENT_NESTING_LEVELS`.
