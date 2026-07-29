# Session

## `message.schema.ts` — `.zod` only needed on union schemas, not individual members

Individual variant schemas (TextPart, SnapshotPart, ToolStatePending, etc.) never have their `.zod` accessed directly. Only the union wrappers (Part, Info, Format, FilePartSource, ToolState) and top-level schemas (User, Assistant) need it — `safeParse` is always called on the union, not on individual variants. Adding `.pipe(withStatics((s) => ({ zod: zod(s) })))` to every variant is wasteful; only the 7 schemas that are actually referenced need it.

## Converting `withStatics` to `Object.assign` requires an intermediate const

When removing `withStatics` from a `Schema.Struct` that still needs `.zod`, you must split into `const _X = Schema.Struct(...)` + `export const X = Object.assign(_X, { zod: zod(_X) })`. The `export const X = Schema.Struct(...)` pattern doesn't allow referencing the schema in its own definition — `Object.assign` needs the schema object before adding `.zod`.

## `system.ts:matchDelta` — order-dependent regex matching

Delta selection uses anchored regex in a fixed order: `gpt-4`/`o1`/`o3` → beast, then `codex` → codex, then `gpt` → gpt, then `gemini-`, `claude`, `trinity`, `kimi`. Codex MUST be checked before generic gpt (otherwise "gpt-5.2-codex" matches gpt). The `(?:^|\/)` anchor lets "openai/gpt-4o" match. Tests in `test/session/match-delta.test.ts` lock this behavior.

## Two-phase system prompt prefix assembly

`system.prefix` is intentionally set to `""` in `prompt.ts:runLoop` and filled by `LLM.stream` from `agent.prompt ?? SystemPrompt.provider(model).prefix`. This keeps the model+delta selection co-located with LLM submission logic. The JSDoc on `SystemPrompt` type in `llm.ts` documents this — don't move prefix resolution to `prompt.ts` without updating both sides.

## `system.ts:skills()` — auto-match via semantic search

`SystemPrompt.skills()` now accepts optional `userMessage` and `autoMatchOpts` parameters. When `skills.autoMatch` is enabled in config, `prompt.ts:runLoop` reads the config, extracts the last user message text, and passes both to `skills()`. The method then calls `skill.matchBySemantics()` instead of `skill.available()`, returning only the top-N matching skills. The config is read at the call site (`prompt.ts`), not inside `skills()`, to keep the `Interface` methods' Effect `R = never` (avoiding `Config.Service` requirement on the interface).

## `merge-options.ts` — hot LLM path, cast is intentional

The `as Record<string, any>` cast in `mergeOptions` is deliberate — remeda's `mergeDeep` type instantiation is expensive and this runs on every LLM call. The 3rd `layer?` parameter enables debug logging of which option layer (model/agent/variant) contributed which keys. Tests in `test/session/merge-options.test.ts`.

## `prompt()` tools-derived permissions must merge with existing session permission

`prompt.ts:1486-1493` converts `input.tools` (from `subagentToolRestrictions`) into permission rules. It **must** merge with existing `session.permission` using `Permission.merge(session.permission ?? [], permissions)`, not overwrite. Overwriting destroys parent denies (e.g., Plan Mode `edit: { "*": "deny" }`) set by `subagentSessionPermission` — the #26514 fix was ineffective at runtime because of this overwrite. The merge is safe: `Permission.merge` = `rulesets.flat()`, and `findLast` in `evaluate` means tools-derived rules (appended last) override earlier rules for the same `(permission, pattern)` key.

## TodoWrite tool — autoclose architecture

**Autoclose matching** (`session/todo-autoclose.ts`): pure function extraction for testability (AGENTS.md Rule 3). Algorithm: all >3-char words from todo content must appear in at least one diff (case-insensitive substring match). `applyAutoclose` returns same array reference if no changes (enables `nextTodos !== currentTodos` guard in caller).

**Backward compatibility**: `normalizeStatus`/`normalizePriority` in `session/todo.ts` fall back unknown values to `"pending"`/`"medium"` — old session data with invalid enum values loads safely.

**Autoclose scope**: triggered by `apply_patch`, `write`, `edit` tools (all produce diff via `createTwoFilesPatch`). Shell tool excluded (non-deterministic, diff unknown). Each tool calls `todo.autoclose(sessionID, [{ filePath, diff }])` after file write + bus events.

**Priority render**: `[H]`/`[M]`/`[L]` badge before status icon (e.g., `[H][✓] Done thing`). TUI uses `theme.error/warning/success`, Web uses `border-left` red/orange/green. Eski veriler `normalizePriority` ile `"medium"`'a düşer.

## Batch updates — `updateParts` / `updateMessages`

When replacing per-item loops with batch writes, use the new `Session.updateParts(parts)` and `Session.updateMessages(infos)` methods. They emit a single `PartUpdatedBatch` / `MessageUpdatedBatch` event carrying the full array, and the projector in `projectors.ts` performs one multi-row `INSERT ... ON CONFLICT DO UPDATE` using `sql`excluded.data`` for SQLite upserts. Prefer batch over loops when updating >1 item in the same session.

**Adding new batch event types requires coordinated changes:**
1. Define the schema + event in `message-v2.ts`
2. Add the projector tuple to `session/projectors.ts` default export **before** `...nextProjectors`
3. `server/projectors.ts:initProjectors()` runs at module load and freezes the registry — import order matters

## Subagent permission wiring — two distinct `ctx.ask` merge strategies

Normal tools merge `agent.permission + session.permission`. But subagent task's own ask (`prompt.ts:727-734`) merges `taskAgent.permission + PARENT session.permission` (not subagent session). This means a subagent's "always allow" does NOT inherit from its own session — it inherits from the parent. Don't assume subagent permissions are self-contained.

## Effect Schema cross-file identity — keep schemas in the consuming module

`Schema.Struct` types are not stable across module boundaries under `verbatimModuleSyntax`. Moving schema definitions from `session.ts` to `session/schemas.ts` causes `Info` types from different modules to be treated as unrelated, breaking Interface definitions. Keep schemas in the module where they're consumed.

## `??` does not fall through for `0` or `""` — use `||` for falsy fallback

`??` only falls through for `null`/`undefined`. When the intention is to fall through for all falsy values (including `0`), use `||`. Discovered in `getUsage`: `inputTokenDetails.cacheWriteTokens: 0` stopped the chain instead of falling back to `metadata.anthropic.cacheCreationInputTokens`.

## `instruction.ts` fileCache grows unbounded without LRU eviction

`session/instruction.ts:91` — the `fileCache` Map caches AGENTS.md/CLAUDE.md file contents by path. Entries are only evicted when a file is deleted or empty. For long-running sessions touching many project directories, this grows without bound. Add LRU eviction (100 entries) and re-insert on cache hit to maintain recency ordering. The cache is per-instance, not per-session, so it survives across session switches within the same project.

## Compaction system

### `isOverflow` headroom bug when `limit.input` is set

`context-budget.ts:usableWith()` — when `model.limit.input` is set, the function previously used `limit.input - min(compactionBuffer, maxOutputTokens)`, which reserved only 20K headroom for output. For models with 32K+ output limits, compaction triggered too late. The fix: always subtract `maxOutputTokens` from `limit.input` (or `reserved` if user-configured). Regression tests at `compaction.test.ts:480-546` document the expected behavior. Related issues: #10634, #8089, #11086, #12621.

### `filterCompacted` has unreachable dead code

`message-v2.ts:651-652` — the condition `msg.info.role === "user" && completed.has(msg.info.id) && msg.parts.some(...)` is unreachable. Line 643 already handles the same condition with `continue`/`break` for all sub-cases. Remove it if found.

### `filterCompacted` reordering comparisons appear inverted

`message-v2.ts:676` — the condition `tailIndex < compactionIndex && summaryIndex > compactionIndex` in the reversed array appears inverted. The summary should have a lower index (newer) than the compaction marker (older) in the reversed array, and the tail should have a higher index (older). The reordering code at lines 676-682 may never execute as a result. The function still works because the reversed array (newest-first) is what the runLoop consumes.

### `compaction_continue` metadata guard scope

`prompt.ts:1595-1598` — the double-compaction guard checks ALL visible messages for `compaction_continue` metadata, not just recent ones. This prevents infinite compaction loops but also means a `compaction_continue` marker from an old compaction blocks future auto-compaction. The guard is safe because `filterCompacted` removes old compaction markers from the visible window.

### `processCompaction` history computation is order-dependent

`compaction.ts:400` — `history` excludes the current compaction marker only when it is the last message (`messages.at(-1)?.info.id === input.parentID`). After `filterCompacted` reorder, the marker may not be last, but this is safe because the current compaction hasn't produced a summary yet so `completedCompactions` won't match it. The dependency on message ordering is undocumented — do not change the condition without understanding this invariant.

### `PRUNE_PROTECTED_TOOLS` is now configurable

`compaction.ts:335` — was hardcoded to `["skill"]`, now reads from `cc.pruneProtectedTools` (config key `compaction.prune_protected_tools`, default `["skill"]`). Add tools like `"task"` to protect subagent results from pruning.

### `reserved` default changed from `min(compactionBuffer, maxOutputTokens)` to `maxOutputTokens`

`context-budget.ts:43` — the old default `min(20000, maxOutputTokens)` was too small for models with 32K+ output limits. The new default is `maxOutputTokens` (or user-configured `reserved`). This ensures compaction reserves enough headroom for the model's full output capacity.

### `summary_max_tokens` config — summary budget is now configurable

`compaction.ts:summaryBudget()` — the compaction summary length was previously unbounded (model decided). Now: `cc.summaryMaxTokens ?? min(maxOutputTokens, maxSummaryTokens)`. Config key `compaction.summary_max_tokens` overrides; default caps at `min(model output limit, 8000)`. The `buildPrompt` function appends `Target length: under N tokens.` to the template when a budget is set.

### `autocontinue` only fires on auto compaction

`compaction.ts:554` — the synthetic "Continue" message after compaction is gated by `input.auto`. Manual `/compact` does NOT inject a continue message. The config key `compaction.autocontinue` (default `true`) and the plugin hook `experimental.compaction.autocontinue` both control this — config must be `true` AND plugin must return `{ enabled: true }` for the continue message to appear.

### Continue message includes pending todos

`compaction.ts:585-602` — when `Todo.Service` is available (via `Effect.serviceOption`), the continue message appends a "Pending todos:" block with `[H]`/`[M]`/`[L]` badges. The service is optional — if not provided, the continue message omits the todo block silently. This is a non-breaking enhancement: existing consumers that don't provide `Todo.Service` continue to work.

### `summaryBudget` uses model output limit, not a hardcoded ratio

`compaction.ts:summaryBudget()` — unlike `preserveRecentBudget` which uses `usable * 0.25`, the summary budget is `cc.summaryMaxTokens ?? min(maxOutputTokens, maxSummaryTokens)`. No hardcoded ratio: the model's `maxOutputTokens` is the natural cap (the compaction agent can't output more than that anyway), and `maxSummaryTokens` (8000) is a practical ceiling.

### `SUMMARY_TEMPLATE` — tool call shorthand and file roles

`compaction.ts:44-78` — the template now guides the model to use `tool_name(key_arg)` shorthand (e.g., `read(src/auth.ts)`, `bash(npm test)`) and annotate file paths with roles (`read | written | created | deleted`). These patterns improve summary quality by preserving tool call history and file operation context that would otherwise be lost in natural-language rephrasing.

### `buildPrompt` token budget hint

`compaction.ts:buildPrompt()` — when `maxTokens` is provided, the function appends `Target length: under N tokens.` to the template. This gives the model a concrete output length target, preventing overly long or short summaries. The budget is calculated by `summaryBudget()` and passed from the call site at `compaction.ts:445`.

## Pre-existing flaky tests in this module

- `session.system > skills output is sorted by name and stable across calls` — fails intermittently (Expected: >489, Received: 188)
- Permission tests have pre-existing `ScopedCache` state leakage between `withDir` tests — `disposeAllInstances()` invalidates async, so "always" replies leak into subsequent tests. 2 flaky tests remain.
