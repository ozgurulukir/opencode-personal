# Tool system

## Tool.Context.extra — typed boundary contract

`Tool.Context.extra` was an untyped `{ [key: string]: unknown }` bag. Now typed via `ToolContextExtra` interface in `tool/tool.ts`:

```ts
export interface ToolContextExtra {
  /** Skip task tool's per-call agent-type permission ask (used by /agent slash commands). */
  bypassAgentCheck?: boolean
  /** Skip read tool's reference/cwd containment check. */
  bypassCwdCheck?: boolean
  /** Model context forwarded from parent session to spawned subagents / tool execution. */
  model?: { id: string; providerID?: string; api?: { id?: string }; [key: string]: unknown }
  /** Prompt operations injected by session prompt service for the task tool. */
  promptOps?: TaskPromptOps
  /** Merged permission ruleset (agent + session) for deny evaluation without asking. */
  permissionRuleset?: Permission.Ruleset
  /** Tool-specific extensions. */
  [key: string]: unknown
}
```

**Producers** (`session/prompt.ts`): lines 454, 712, 1191 construct object literals matching this shape. **Consumers** (`tool/task.ts`, `tool/read.ts`, `tool/websearch.ts`) now access typed fields directly — no `as` casts or bracket notation needed.

The index signature preserves backward compatibility for any other tool reading `ctx.extra` via bracket access.

## `bypassAgentCheck` only skips the "ask" prompt, NOT deny evaluation

`bypassAgentCheck: true` (set when user types `/agent` slash command) skips the interactive `ctx.ask()` prompt in `task.ts`, but deny rules are still enforced via `Permission.evaluate()` before the guard. This means config deny rules (e.g., `task: { "dangerous-agent": "deny" }`) cannot be bypassed by slash commands. The deny check uses `permissionRuleset` from `ToolContextExtra` (merged agent + session permission) so it has the full ruleset available without calling `ctx.ask`.

## TaskPromptOps — type-only import to avoid circular deps

`TaskPromptOps` is defined in `tool/task.ts` but referenced in `tool/tool.ts` (for `ToolContextExtra.promptOps`). Use `import type { TaskPromptOps } from "./task"` in `tool/tool.ts` — type-only import is erased at runtime, so no circular dependency even though `task.ts` imports `Tool` from `tool.ts` at runtime.

## webSearchModelName — simplified by typed extra

`webSearchModelName(ctx.extra)` in `tool/websearch.ts` previously had defensive `typeof`/`in` guards. With `ToolContextExtra.model` typed, the body simplifies to `model.api?.id ?? model.id` — equivalent and type-safe.

## File-mutating tools — autoclose pattern

`apply_patch`, `write`, `edit` tools trigger todo autoclose after file changes. Pattern:
1. Compute diff via `createTwoFilesPatch` (already done for permission metadata)
2. Publish `FileWatcher.Event.Updated` / `File.Event.Edited`
3. Call `yield* todo.autoclose(ctx.sessionID, [{ filePath, diff }])`
4. Continue with LSP diagnostics

**Diff reuse**: existing diff variable is reused (no recalculation). `edit.ts` has two paths (create via `oldString === ""` and edit existing) — both call autoclose. Shell tool excluded (non-deterministic, diff unknown).

## Built-in tool output truncation is handled by `Tool.define`

`Tool.define` wraps built-in tool output with `truncate.output()` automatically. Do NOT yield `Truncate.Service` or `Agent.Service` explicitly in built-in tool implementations — it causes test timeouts without changing runtime behavior.

## Skill tool shows validation warnings inline

When the `skill` tool loads a skill that has `warnings` in its `Skill.Info`, the tool output prepends a warning block:
```
⚠️ Skill "name" has validation issues:
  - <warning text>
```
This gives the LLM immediate feedback about frontmatter problems. The skill is still loaded and its content is returned after the warning block.

## Ripgrep exit code 2 — regex errors are now surfaced

`Ripgrep.search` (`file/ripgrep.ts`) previously treated exit code 2 as `partial: true` (inaccessible paths) even for regex parse failures, discarding stderr. That's fixed: for code 2 the stderr is inspected for regex error markers (`regex parse error`, `invalid regex`, `error parsing regex`) and those are returned as a hard failure instead of `partial: true`. Exit code 2 without those markers still means inaccessible-some-paths → `partial: true`.

## `assertExternalDirectoryEffect` is the real permission gate

The `grep`/`glob`/`read` permission ask uses `always: ["*"]` which always allows — it's audit-only. The actual permission gate is `assertExternalDirectoryEffect`, which prompts the user when the target path is outside the project/reference boundaries. When debugging "why did this path trigger a permission prompt," look at `assertExternalDirectoryEffect` and `Reference.contains`, not the tool's own `ctx.ask`.

## Permission ask ordering — ask happens before path validation

All search tools (`grep.ts`, `glob.ts`) call `ctx.ask` (permission prompt) before resolving and validating `params.path`. This means the user sees a permission prompt even for non-existent or invalid paths. The permission is always-allowed (`always: ["*"]`), so the UX cost is minimal, but it means invalid paths still go through the permission flow before failing at ripgrep or stat.

## Path traversal: `path.resolve()` does NOT resolve symlinks

`path.resolve()` normalizes `..` segments but does not resolve symlinks. A directory inside the project that is a symlink to `/etc` allows paths like `linked-dir/passwd` to pass the `startsWith(instance.directory)` check and write outside the project. Use `fs.realpathSync()` on the resolved path to catch symlink escapes. This applies to `edit.ts`, `write.ts`, and `apply_patch.ts`.

## SSRF: pin resolved IP + Host header to prevent DNS rebinding

The SSRF guard in `webfetch.ts` resolves DNS before the HTTP request, but the HTTP client re-resolves DNS independently. An attacker's DNS server can return a public IP on the first lookup (passing the check) and a private IP on the second (DNS rebinding). Fix: set the request URL to the resolved IP and add the original hostname as the `Host` header. The retry path must use the same pinned URL.
