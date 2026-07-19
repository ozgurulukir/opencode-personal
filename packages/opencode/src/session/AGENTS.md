# Session

## `message.schema.ts` — `.zod` only needed on union schemas, not individual members

Individual variant schemas (TextPart, SnapshotPart, ToolStatePending, etc.) never have their `.zod` accessed directly. Only the union wrappers (Part, Info, Format, FilePartSource, ToolState) and top-level schemas (User, Assistant) need it — `safeParse` is always called on the union, not on individual variants. Adding `.pipe(withStatics((s) => ({ zod: zod(s) })))` to every variant is wasteful; only the 7 schemas that are actually referenced need it.

## Converting `withStatics` to `Object.assign` requires an intermediate const

When removing `withStatics` from a `Schema.Struct` that still needs `.zod`, you must split into `const _X = Schema.Struct(...)` + `export const X = Object.assign(_X, { zod: zod(_X) })`. The `export const X = Schema.Struct(...)` pattern doesn't allow referencing the schema in its own definition — `Object.assign` needs the schema object before adding `.zod`.

## `system.ts:matchDelta` — order-dependent regex matching

Delta selection uses anchored regex in a fixed order: `gpt-4`/`o1`/`o3` → beast, then `codex` → codex, then `gpt` → gpt, then `gemini-`, `claude`, `trinity`, `kimi`. Codex MUST be checked before generic gpt (otherwise "gpt-5.2-codex" matches gpt). The `(?:^|\/)` anchor lets "openai/gpt-4o" match. Tests in `test/session/match-delta.test.ts` lock this behavior.

## Two-phase system prompt prefix assembly

`system.prefix` is intentionally set to `""` in `prompt.ts:runLoop` and filled by `LLM.stream` from `agent.prompt ?? SystemPrompt.provider(model).prefix`. This keeps the model+delta selection co-located with LLM submission logic. The JSDoc on `SystemPrompt` type in `llm.ts` documents this — don't move prefix resolution to `prompt.ts` without updating both sides.

## `merge-options.ts` — hot LLM path, cast is intentional

The `as Record<string, any>` cast in `mergeOptions` is deliberate — remeda's `mergeDeep` type instantiation is expensive and this runs on every LLM call. The 3rd `layer?` parameter enables debug logging of which option layer (model/agent/variant) contributed which keys. Tests in `test/session/merge-options.test.ts`.

## TodoWrite tool — autoclose architecture

**Autoclose matching** (`session/todo-autoclose.ts`): pure function extraction for testability (AGENTS.md Rule 3). Algorithm: all >3-char words from todo content must appear in at least one diff (case-insensitive substring match). `applyAutoclose` returns same array reference if no changes (enables `nextTodos !== currentTodos` guard in caller).

**Backward compatibility**: `normalizeStatus`/`normalizePriority` in `session/todo.ts` fall back unknown values to `"pending"`/`"medium"` — old session data with invalid enum values loads safely.

**Autoclose scope**: triggered by `apply_patch`, `write`, `edit` tools (all produce diff via `createTwoFilesPatch`). Shell tool excluded (non-deterministic, diff unknown). Each tool calls `todo.autoclose(sessionID, [{ filePath, diff }])` after file write + bus events.

**Priority render**: `[H]`/`[M]`/`[L]` badge before status icon (e.g., `[H][✓] Done thing`). TUI uses `theme.error/warning/success`, Web uses `border-left` red/orange/green. Eski veriler `normalizePriority` ile `"medium"`'a düşer.
