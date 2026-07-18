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
  /** Tool-specific extensions. */
  [key: string]: unknown
}
```

**Producers** (`session/prompt.ts`): lines 454, 712, 1191 construct object literals matching this shape. **Consumers** (`tool/task.ts`, `tool/read.ts`, `tool/websearch.ts`) now access typed fields directly — no `as` casts or bracket notation needed.

The index signature preserves backward compatibility for any other tool reading `ctx.extra` via bracket access.

## TaskPromptOps — type-only import to avoid circular deps

`TaskPromptOps` is defined in `tool/task.ts` but referenced in `tool/tool.ts` (for `ToolContextExtra.promptOps`). Use `import type { TaskPromptOps } from "./task"` in `tool/tool.ts` — type-only import is erased at runtime, so no circular dependency even though `task.ts` imports `Tool` from `tool.ts` at runtime.

## webSearchModelName — simplified by typed extra

`webSearchModelName(ctx.extra)` in `tool/websearch.ts` previously had defensive `typeof`/`in` guards. With `ToolContextExtra.model` typed, the body simplifies to `model.api?.id ?? model.id` — equivalent and type-safe.