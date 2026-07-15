# Agent system

## subagentToolRestrictions has() — only allow rules count as "having" permission

`subagentToolRestrictions` checks `subagent.permission.some((r) => r.permission === id && r.action === "allow")` to decide whether to add `{ tool: false }`. A deny rule (`action: "deny"`) does NOT count as "having" the permission — so `general` agent (which has `todowrite: "deny"`) DOES get `{ todowrite: false }` in its tools map. The tool is hidden from the LLM entirely, not just blocked at the permission layer. Only tools with an explicit `allow` rule avoid being `false`d.

## primary_tools — allow in permission, false in tools

`primary_tools` are simultaneously `allow`ed in the session permission (`subagentSessionPermission`) and `false`d in the tools list (`subagentToolRestrictions`). This is intentional: session permission `allow` means slash-command invocations don't block, but tools list `false` means the LLM can't call them directly. Primary tools are for the primary agent only; indirect access via slash commands is permitted.

## Shared helpers between V1 and V2

`subagentSessionPermission()` and `subagentToolRestrictions()` in `agent/subagent-permissions.ts` are shared between V1 `tool/task.ts` (TaskTool) and V2 `v2/session.ts` (subagent method). Both must use these helpers to maintain parity — any change to subagent permission derivation or tool restriction logic must go through these functions, not be inlined.
