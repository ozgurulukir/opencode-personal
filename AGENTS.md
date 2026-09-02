- **Origin:** `ozgurulukir/opencode-personal` — default branch `main`. Fork of `anomalyco/opencode`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.
- `.jules/bolt.md` is the canonical Bolt performance log. Read it BEFORE any perf refactor — documents "when to optimize" patterns and the "do not micro-optimize typical UI components" guardrail.

## About

Bun workspace monorepo: `packages/*`, `packages/sdk/js`. Catalog versioning via `catalog:` in bun.lock; workspace deps via `workspace:*`; patched deps in root `package.json`.

- Deleted packages (not imported by core targets `opencode`, `app`, `web`): `slack`, `enterprise`, `llm`, `function`, `http-recorder`, `console/*`, `extensions/zed`, `sdks/vscode`. The `github/` directory references `@opencode-ai/sdk` via `workspace:*` but is NOT in the workspace config — standalone GitHub Action.

## Setup

- `bun install` resolves catalog versions, workspace deps, and patches
- `bun.lock` stores catalog versions with `catalog:` prefix
- `package.json` `patchedDependencies` map to `patches/` directory

## Development

- `bun run dev` / `dev:web` / `dev:desktop` / `dev:storybook`
- `bun run lint` (oxlint)
- `bun run typecheck` (turbo typecheck)
- A **husky `pre-push` hook runs `bun turbo typecheck` across all packages** and blocks the push on any failure (`error: failed to push some refs`). Do your best typecheck in the changed package (`bun typecheck` from its dir) before pushing, and regenerate the SDK via `./packages/sdk/js/script/build.ts` first when a server-side schema/config change needs to flow into `@opencode-ai/sdk` — otherwise the SDK regen's downstream type effects only surface at push time.
- Regenerate JS SDK: `./packages/sdk/js/script/build.ts`
- There is a SINGLE generated SDK client at `packages/sdk/js/src/v2/gen/` (regenerated from `openapi.json`; fixes patched in `script/build.ts`). The legacy v1 generation (`src/gen/`, `src/client.ts`, `src/server.ts`) was removed during SDK consolidation — the root `@opencode-ai/sdk` export now re-exports v2 (`src/v2/index.ts`). All internal consumers (TUI, web/app, ACP, plugin host, github action) import from `@opencode-ai/sdk/v2` or the v2-backed root.
- SDK package (`@opencode-ai/sdk`) exports source `.ts` directly; `dist/` exists but isn't what consumers resolve in dev. `node_modules/@opencode-ai/sdk` symlinks to `packages/sdk/js/`, so `src/` edits are live without rebuilding.
- SDK tests live in `packages/opencode/test/server/`, not `packages/sdk/js/test/`. Add SDK behavior tests there.
- **SDK regeneration affects `packages/app` too, not just `opencode`.** Both packages import `@opencode-ai/sdk` and must be adapted to a changed client contract (e.g. `response`/`request` became optional, `Todo.status`/`priority` narrowed to literals). After regenerating, check BOTH `bun typecheck` from `packages/opencode` AND `packages/app`.
- **`packages/app` typecheck (`tsgo -b`) caches results in `packages/app/node_modules/.ts-dist/tsconfig.tsbuildinfo`, which can mask errors** (e.g. a stale build-info hid real SDK-contract errors while the `opencode` fix passed CI). turbo `--force` only re-runs turbo's own cached tasks and does NOT clear `tsgo -b`'s incremental build info, so errors can pass a local push and only surface on a clean box. To be sure after a regen, delete stale `*.tsbuildinfo` files (e.g. `packages/app/node_modules/.ts-dist/`, `packages/sdk/js/tsconfig.tsbuildinfo`) before typechecking.
- `bun run build -- --single` produces a self-contained compiled binary via `packages/opencode/script/build.ts`. Wasm files (web-tree-sitter.wasm, tree-sitter-markdown.wasm) and native libs (libopentui.so) are embedded.
- **`packages/diff-wasm` cannot typecheck until its WASM artifacts are built locally.** `src/index.ts` imports `from "../pkg/opencode_diff_rs.js"`, but `pkg/` is gitignored (`pkg/.gitignore` is `*`, itself untracked), so a fresh clone / new box has an empty `pkg/` → `opencode` typecheck fails with `TS2307: Cannot find module '../pkg/opencode_diff_rs.js'` (and the `pre-push` hook rejects the push). Fix: `cd packages/diff-wasm && bun run build:wasm` (wasm-pack `--target web --out-dir pkg`; requires rust toolchain + wasm-pack). This misleadingly resembles an SDK-regen break — if a clean box fails typecheck on `diff-wasm`, run the wasm build, not the SDK regen.
- `bun run turbo run typecheck --force` only re-runs cached tasks; it does **not** regenerate gitignored task inputs like `diff-wasm/pkg/`. turbo doesn't track `pkg/` as an input (gitignored), so `--force` on a box with an empty `pkg/` still fails — the WASM build must be run explicitly. A clean `--force` on one box does not prove another box has missing artifacts.

## Bulk Dependency Updates

- `bun run script/check-updates.ts` scans pinned deps across the monorepo and checks npm for available minor/patch upgrades.
- `--apply` writes new versions to package.json; `--apply --install` also runs `bun install`.
- Skips `catalog:`, `workspace:*`, `npm:`, `github:`, `file:`, and `https:` references automatically.
- After applying, run `bun run --cwd packages/opencode typecheck` to catch breaking changes (some packages silently remove/rename exports in minor versions).

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Don't extract single-use helpers preemptively. Inline at the call site unless reused, hiding a complex boundary, or with a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid `any`
- Use Bun APIs when possible (e.g., `Bun.file()`)
- Rely on type inference; avoid explicit annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to preserve type inference downstream

### Selective JSDoc

Add JSDoc **only** to complex, non-obvious functions — not self-documenting code:

**Add JSDoc:**
- Complex algorithms (50+ lines, cognitive complexity > 20)
- Non-obvious behavior ("does X but in Y case does Z")
- Side effects not apparent from the name

**Skip JSDoc:**
- Simple data transformations (`themeIDs()`, `knownThemes()`)
- Self-documenting names (`handlePermissionAsked`)
- Internal helpers used in 1-2 places

**Example:**
```ts
/**
 * Flushes in-flight parts as interrupted commits.
 * Called when session transitions to idle with pending tool calls.
 * Marks all parts without `end_time` as interrupted.
 * @see {@link handleSessionStatus} - triggers flush on idle
 */
export function flushInterrupted(data: SessionData, commits: SessionCommit[]): void {
  // ...
}
```

### Variables & Control Flow

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment. Avoid `else`.

```ts
// Good
const foo = condition ? 1 : 2
function bar() {
  if (condition) return 1
  return 2
}

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

Reduce variable count by inlining values used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### In-Place Mutation for Performance

Reducers (e.g., `session-data.ts`) **mutate state in-place** for performance but have **no external side effects**:

```ts
export function reduceSessionData(input: SessionDataInput): SessionDataOutput {
  const data = input.data // mutated internally
  return out(data, commits, footer)
}
```

**When to use:** High-frequency event processing (100+ events/sec), state owned by caller, no IO/network/filesystem side effects.  
**When NOT to use:** State shared across modules, function performs IO, or immutability required for time-travel debugging.

### Pure State Machines (`.shared.ts` pattern)

Modules ending in `.shared.ts` (e.g., `prompt.shared.ts`, `permission.shared.ts`) export **pure functions** that take state as input and return new state as output — no side effects, no IO, no mutations. Tested via characterization tests.

```ts
export function movePromptHistory(
  state: PromptHistoryState,
  dir: -1 | 1,
  text: string,
  cursor: number,
): PromptMove // { state, text?, cursor?, apply: boolean }
```

This enables deterministic unit tests without mocks, safe extraction from reactive UI components, and clear separation between computation (`.shared.ts`) and rendering (`.tsx`).

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need redefining as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks; test actual implementation, don't duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`
- Package test directories follow `packages/<name>/test/` or `packages/<name>/test/<subpath>/`
- Exception: `packages/ui` co-locates tests in `src/components/` alongside source. See `packages/ui/AGENTS.md`.
- `mock.module()` in bun:test persists across test files — always use `afterAll(() => mock.restore())` to prevent leakage.
- Test failures may be order-dependent. Some pass in isolation but fail in the full suite due to shared state or global mock leakage. Always run the full test suite after changes.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.
- `packages/web` requires `--skipLibCheck` due to pre-existing astro/starlight lib errors
- **LSP diagnostics may show false positives for `@/` path aliases.** The language server often cannot resolve tsconfig path mappings, producing "Cannot find module" errors that `bun typecheck` (which uses `tsgo`) passes cleanly. Always trust `bun typecheck` over LSP diagnostics for `@/` imports.

## Technologies

- HTTP server is Effect `HttpApi` (`effect/unstable/httpapi`) + Effect `Schema` for request/response typing at the API boundary (51 unique files use `effect/unstable/httpapi`; Hono appears only in a node SSE shim at `server/httpapi-server.node.ts`, one session handler, and a command template). zod 4.1.8 (catalog) is used for config/skill frontmatter/SDK-client boundaries, not the HTTP API.
- Bun 1.3.14 with workspace support, catalog versions, and patches
- Drizzle ORM (beta) with snake_case field convention
- Effect 4.0.0-beta.65
- SolidJS + Astro/Starlight (web), OpenTUI (TUI)
- Turbo for monorepo orchestration

## Rules

- **Characterization tests are mandatory before any file split or refactoring (Rule 3).** Write tests that lock existing behavior BEFORE extraction. Precedents: `cli/cmd/run/tool.ts` → 6 modules (26 display-function tests); `provider/transform.ts` `normalizeMessages` (41-line orchestrator at `transform.ts:97-137` over 7 sibling modules under `provider/transform/`: `sanitize`, `anthropic`, `bedrock`, `claude-ids`, `mistral`, `deepseek`, `interleaved`); 96 characterization tests for `session-data.ts` (88) and `footer.prompt.tsx` (8) before the 6-phase refactor. See `packages/opencode/src/provider/AGENTS.md` for the orchestrator pattern and early-return constraints.
- **Storybook expansion is optional post-refactoring.** Add stories only if: (1) 3+ visual states, (2) designer/PM review needed, or (3) edge cases need documentation. Skip for internal components (header, thinking) covered by parent stories. See `packages/ui/AGENTS.md`.
- Avoid `as any` casts. Verified counts (2026-08): 67 `as any` occurrences across `packages/opencode/src` (30), `packages/ui/src` (32), `packages/core/src` (5). Counted via `rg -o "as any"` (occurrence count; some lines carry more than one cast, so this exceeds the 62 line-count figure from earlier audits). The provider layer is clean (1 cast in `provider/provider.ts:1272`, an auth-bridge return type). `CommonRequest`/`CommonResponse` index signatures referenced in older notes do NOT exist in this tree. Top `as any` files are SolidJS event-handler casts (`ui/src/components/line-comment.tsx`, `scroll-view.tsx`) and bus-event dispatch (`cli/cmd/run/session-data.ts:9`). `packages/desktop` was deleted; its casts are gone. When adding new casts, prefer narrowing (`as typeof x`), index signatures, or `@ts-expect-error` with an explanatory comment for genuine library type bugs.
- Split large icon component files (>300 lines) by Heroicons prefix category (arrows, coding, communication, data, file, general, layout, media, social). See `packages/web/src/components/icons/`.
- Before splitting a god function, extract small single-responsibility modules first (cost, billing, auth, model validation). `packages/console/app/src/routes/zen/util/handler.ts`: 1132 → 468 → 154 lines via two phases. Phase 1 (9 modules): cost.ts, billing.ts, usage.ts, auth.ts, provider-selector.ts, model.ts, reload.ts, validation.ts, http.ts. Phase 2 (6 modules): request.ts, setup.ts, retry.ts, response.ts, error-mapping.ts, plus HandlerDeps injection. Now a thin orchestrator: `parseRequest → setupRequest → executeRetriableRequest → handleResponse → mapErrorToResponse`.
- Drizzle ORM schema is clean snake_case with zero `as any` casts in any `*.sql.ts` file (verified 2026-08). The older `UserTable.userID`/`WorkspaceTable.workspaceID` mismatch note is obsolete: `UserTable` does not exist, and `WorkspaceTable` uses `project_id`/`time_used`. When adding new tables, follow the snake_case convention in `session/session.sql.ts` so column names don't need string overrides.
- Avoid sed for code extraction; prefer manual refactor or ast-grep to prevent stray syntax artifacts.
- System prompts use a shared core (`session/prompt/core.txt`) plus provider-specific deltas (`session/prompt/delta-*.txt`). Universal rules go in core.txt only; deltas contain provider-specific guidance (TodoWrite for Claude, apply_patch for GPT, autonomous mode for GPT-4/o1/o3). Matching in `system.ts:matchDelta()`.
- AGENTS.md is injected as a **user message** (not system prompt) per the Instruction Hierarchy pattern (Claude Code / Codex CLI), re-read from disk on every LLM API call inside `runLoop` (no caching — edits apply immediately). Discovery + `<instructions source="...">` wrapping in `session/instruction.ts:184-204` (`Instruction.system()`); joined into the user message at `session/prompt.ts:1707` (`instructions.join("\n\n")`).
- System prompt assembly: `session/llm.ts` uses a two-field `SystemPrompt = { prefix, suffix }` type (`llm.ts:47-52`). The cacheable prefix (core + provider delta) is resolved in `LLM.stream` at `llm.ts:123` (`input.agent.prompt ?? SystemPrompt.provider(input.model).prefix`); the dynamic suffix (environment + skills + structured-output hint + user system) is built by the caller in `prompt.ts` and passed in via `system.suffix`. `ProviderTransform.systemPromptDelivery` is called at `llm.ts:118`. Plugin transform hook at `llm.ts:128-136` can mutate `{system}`; the guard at `llm.ts:134` restores the prefix if a plugin drops it. The `[prefix, suffix]` structure is preserved at `llm.ts:139-140` for prompt caching.
- XML section markers are consistent: `<environment>`, `<skills>` (system prompt); `<instructions source="...">` (AGENTS.md/CLAUDE.md); `<system-reminder>` (transient status: plan mode, build switch, max steps). Don't mix tag semantics.
- Skill frontmatter spec (agentskills.io): enforce stricter zod schema in `packages/opencode/src/skill/index.ts`. `description` is required; name/folder mismatch and duplicate names emit `skill.warning` instead of rejecting registration. Store `license`, `compatibility`, `metadata`, `allowedTools`, `warnings` on `Skill.Info`. Invalid skills are either registered with `warnings` (if partial valid structure) or dropped entirely (if completely invalid).
- Wildcard ReDoS protection: `packages/opencode/src/util/wildcard.ts` caps `MAX_WILDCARDS = 10` with a non-throwing fallback to prevent regex backtracking attacks.
- Skill name collision handling: duplicate non-builtin skill names emit `skill.warning` and are not registered. Built-in skills can be overridden by user disk skills. Emit `skill.loaded` / `skill.unloaded` bus events on registration/unregistration.
- `skill.warning` bus event: emitted for non-critical skill frontmatter issues. Fields: `name`, `location`, `message`. Not shown as TUI toasts. Used for logging and `debug skill validate`.
- `debug skill validate` CLI subcommand: validates all skills (including invalid ones) against the agentskills.io spec. Uses `Skill.allIncludingInvalid()` to see the full registry. Located at `packages/opencode/src/cli/cmd/debug/skill.ts`.
- Permission `disabled()` override: `evaluate()` checks both `pattern` and `permission` dimensions when overriding `disabled()`. Invariant comment in `permission/index.ts:reply()` documents shared mutable `approved` array.
- Built-in skill tool truncation: framework-level `truncate.output()` in `Tool.define` already wraps built-in tool output. Explicit `Truncate.Service` / `Agent.Service` yield in `skill.ts` caused test timeouts and was reverted.
- SDK regeneration: after adding new bus events (e.g., `skill.warning`), regenerate SDK via `cd packages/sdk/js && bun script/build.ts` to update generated `Event` union types. Until then, use `event.subscribe()` + `any` casts in TUI.
- Plugin tool descriptions are sanitized via `sanitizeDescription()` in `packages/opencode/src/tool/registry.ts` to prevent malformed output.
- **Documentation integrity:** claims in this file that cite `file:line` anchors, symbol names, or version counts must be re-verified against the tree before being relied upon (and re-verified before editing this file). This file is re-read from disk on every LLM API call, so stale references propagate directly into agent behavior. Known drift sources: deleted packages (`slack`, `enterprise`, `llm`, `function`, `http-recorder`, `console`, `desktop`, `extensions/zed`, `sdks/vscode`), refactors that move line numbers (`runLoop` moved 1480→1513), and renamed/removed abstractions (`CommonRequest`/`CommonResponse`, `constantTimeEqual`). When a claim here contradicts the code, the code wins — fix the doc.

## Known Issues

- Root `test` script always fails: `echo 'do not run tests from root' && exit 1`
 - `packages/opencode/src/session/loop/run-loop.ts:73` — `runLoop` is a ~279-line `Effect.fn("SessionPrompt.run")` infinite loop (`run-loop.ts:73-351`); the enclosing `SessionPrompt` layer generator spans `session/prompt.ts:122-2040`. Future extraction target — the blueprint in `_plan/` decomposes it into `ToolExecutor` + `CompactionPolicy` + `PromptAssembler` + `SubtaskRouter` + an `AgentLoop` orchestrator.
- `as any` casts (verified 2026-08): 62 total — `packages/opencode/src` (26), `packages/ui/src` (31), `packages/core/src` (5). The provider layer is clean (1 cast, `provider/provider.ts:1272`). Known library-internal casts: `packages/core/src/effect-zod.ts` (3, Effect Schema annotations), `packages/opencode/src/plugin/index.ts` (1, `(hook as any).config?.(cfg)`, reflective hook invocation), `packages/opencode/src/mcp/index.ts` (1, `TolerantListToolsResultSchema`, SDK zod version boundary). `packages/desktop` was deleted; its Electron-HTTP-proxy cast is gone.
- `useFilteredList` (`packages/ui/src/hooks/use-filtered-list.tsx`) must use `createResource` (not `createMemo`) for grouped data when `items` can be async. Commit `016a457` replaced `createResource` with `createMemo` + `asyncItems` resource + `Object.assign` to mock the `Resource` shape — silently broke reactivity: API calls succeeded (200 OK) but `List`-based dialogs (`dialog-select-directory`, `dialog-select-model`) rendered empty. Reverted; the `keys` memo optimization (`6541fdf`) is safe and preserved.
- TypeScript conditional types in parameter positions can cause the compiler to skip parameters (both `tsc` and `tsgo`). Example: `[Extract<T, ...>["properties"]] extends [never] ? ...` caused `id: string` to be skipped in `@openauthjs/openauth`'s `OnSuccessResponder.subject()`.
- Permission evaluation: `evaluate(permission, pattern, ...rulesets)` flattens then uses `findLast` — last match wins. A bug previously passed `(approved, ruleset)` in wrong order, making config always override DB-persisted "always allow". Fixed by checking deny from config first, then allow from approved, then allow from config. Pre-existing `ScopedCache` state leakage between `withDir` tests masks this — `disposeAllInstances()` invalidates async, so "always" replies leak. 2 flaky tests remain.
 - Subagent permission wiring: normal tools merge `agent.permission + session.permission` (`session/loop/tools.ts:79,103`), but subagent task's own ask merges `taskAgent.permission + PARENT session.permission` (not subagent session) at `session/loop/subtask.ts:132`.
- Effect Schema cross-file identity: Moving `Schema.Struct` definitions to separate files breaks type identity under `verbatimModuleSyntax`. Schema.Struct types are not stable across module boundaries. Keep schema definitions in the module where they're consumed.
- `session.system > skills output is sorted by name and stable across calls` — fails intermittently (Expected: >489, Received: 188). Root cause: commit `f3045ece6` changed `Skill.fmt()` to not sort and changed output format for descriptionless skills.
- `usage.characterization.test.ts:76` — `getUsage` returns `tokens.cache.write: 0` when `inputTokenDetails.cacheWriteTokens: 0` and `metadata.anthropic.cacheCreationInputTokens: 75`. See `??` vs `||` note below.
- `ModelsDev Service > get() returns {} when disk empty and fetch disabled` fails even in isolation with massive output mismatch. `models-snapshot.js` (3,609,014 bytes ≈ 3.44 MiB, 180 providers / 6,225 models) at `packages/opencode/src/provider/models-snapshot.js` is gitignored (built by `script/build.ts`, consumed via dynamic import at `provider/models.ts:138`) and may be related.
- Order-dependent test failures are widespread: many tests pass in isolation but fail in the full suite, indicating shared state or global mock leakage beyond the documented `mock.module()` issue. Project/worktree/vcs tests are affected. Skill tests may timeout after permission tests (same root cause).
- `Bun.build --compile` cannot resolve dynamic `import(..., { with: { type: "wasm" } })` — fails with `Cannot find module`. Plugin `onResolve` is NOT invoked for dynamic imports in compile mode (only static imports resolve at build time); `onLoad` on the containing file fails because Bun resolves the dynamic import BEFORE `onLoad` fires. `@opentui/core`'s `parser.worker.js:307` uses this pattern to load `web-tree-sitter/tree-sitter.wasm`, causing markdown rendering to fall back to raw text in the compiled binary (`CodeRenderable.startHighlight()` catch → `textBuffer.setText(content)`). Workaround: patch `parser.worker.js` content BEFORE `Bun.build()` (not via plugin `onLoad`), replacing the dynamic `type: "wasm"` import with a static `import ... with { type: "file" }` (works in compile mode, returns `/$bunfs/root/<hash>.wasm`).
- `Bun.build --compile` worker context does NOT provide WASI imports. After resolving the wasm import (entry above), `web-tree-sitter@0.25.10`'s `tree-sitter.wasm` previously failed with `Aborted(LinkError: import function wasi_snapshot_preview1:clock_time_get must be callable)`. Fixed in `packages/opencode/script/build.ts` by monkey-patching `WebAssembly.instantiate` in `parser.worker.js` to inject a WASI shim (`wasi_snapshot_preview1` with `clock_time_get`, `fd_close`, `fd_seek`, `fd_write`, `proc_exit`, `environ_sizes_get`, `environ_get`).
- Pre-existing flaky permission test: `reply - reject cancels all pending for same session` fails intermittently in the full suite but passes in isolation. Not caused by recent changes.
- Compiled binary TUI "immediately returns to terminal" after a `git reset`/branch switch (verified 2026-09): the compiled binary **embeds the `node_modules` state at build time**, and `bun install` after a source rollback is *incremental* - it adds missing packages but does not prune stale content left by a prior dependency era (e.g. an `@opentui` 0.5.9 upgrade later reverted to 0.2.16 in both `package.json` and `bun.lock`). The stale/duplicate module graph (double `@opentui/core` or `solid-js` instances) makes the SolidJS TUI render then quit **silently**: exit code 0, no stack trace, server log ends with `worker shutting down` (`cli/cmd/tui/worker.ts:111`) after the TUI client connects successfully. Diagnosis signals: server + `/agent` + `/config` requests all succeed, then instant clean exit; a worktree with a fresh `bun install` of the SAME commit builds a working binary (isolates `node_modules`, not source, as the variable). Fix: delete ALL `node_modules` (root + every `packages/*`, incl. `packages/sdk/js`) then `bun install` + rebuild. Check the binary version stamp (`opencode --version` -> `0.0.0-main-<UTC yyyymmddhhmm>`) to confirm which build you are running; the PATH `opencode` (`~/.local/bin/opencode.exe`) is a symlink into `packages/opencode/dist/.../bin/opencode.exe`, so it always reflects the latest local build.

## Notes

- `new Array<T>()` in `.tsx` parses as JSX. Use `Array<T>()` (no `new`) or `[] as T[]`.
- Squash-merged PR branches (`gh pr merge --squash`) stay "unmerged" in git — `git branch -d` refuses them and `--no-merged` lists them. Use `git branch -D` or `git push origin --delete`.
- `gh pr merge --squash --delete-branch` produces no output on success. Verify via `gh pr view <number>` for `state: MERGED`.
- Sequential squash merges: the first merge updates `main`, so later PRs fail with "Base branch was modified". Rebase remaining branches onto updated `main` before retrying.
- PR branches from a stale base (not current `main` tip) carry unrelated changes in `gh pr diff` — a 2-line fix can appear to touch 100+ files. Fix by branching clean from `main` and applying only intended changes.
- `bun install` can silently modify `bun.lock` (configVersion removal, integrity stripping, formatting churn) without dependency changes. Revert lockfile to match the base branch unless intentionally updating deps.
- Stale `node_modules/.bun/` causes phantom type errors when `bun install` doesn't replace a cached package after a version bump. If `tsgo` reports missing members that should exist, verify the installed version (`node -e "require('<pkg>/package.json').version"`) against `package.json`/`bun.lock`; if mismatched, remove `node_modules/.bun/<pkg>@<old>/` + the workspace symlink, then re-run `bun install`. Example: `@clack/prompts` was `1.7.0` in package.json but `1.0.0-alpha.1` lingered — `SpinnerResult.error()` appeared missing.
- Prettier config: no semicolons, 120 char printWidth (root `package.json`)
- ast-grep (`/home/aristo/.npm-global/bin/ast-grep`) is effective for bulk AST-level refactoring (e.g., removing redundant `(x as any)` casts when the variable is already `any`)
- Error handling: use `safeCatch` (`packages/opencode/src/util/error.ts`) for promise error wrapping instead of manual try/catch — logs context automatically
- Message continuation: `wrapMessageContinuation` (`packages/opencode/src/session/message-continuation.ts`) — pure function that returns new message arrays without mutation; operate on a message-array copy before calling
- Provider usage: `packages/opencode/src/provider/usage/` — types.ts (interfaces), claude.ts (Anthropic OAuth fetcher), zai.ts (ZAI API key fetcher), registry.ts (auth.json reader + dispatcher). `/usage` TUI dialog: `cli/cmd/tui/component/dialog-usage.tsx`
 - Double compaction fix: overflow guard checks `compaction_continue` metadata to prevent `Event.Compacted` double-fire (`session/loop/run-loop.ts:171-182`). The guard checks all visible user messages for a text part carrying `metadata.compaction_continue`; `MessageV2.latest()` (not array position) must be used to find the latest assistant or the `summary !== true` guard is bypassed.
- Security (secret comparisons): a `constantTimeEqual()` helper wrapping `node:crypto` `timingSafeEqual` is referenced in older notes but **does NOT exist in this fork** (verified 2026-08: zero matches in `packages/`). For secret comparisons (API keys, tokens), prefer defining a local `constantTimeEqual(a, b)` that handles length mismatch before `timingSafeEqual`, rather than `!==`. This is aspirational guidance, not a built-in helper.
- Provider system prompt: `ProviderTransform.systemPromptDelivery(providerID, authInfo)` (`packages/opencode/src/provider/transform.ts:36-39`) returns `{ type: "instructions" }` for OpenAI OAuth (no `system` role support — passed via `instructions` field). Used in `session/llm.ts:118` and `agent/agent.ts:458`.
- WSL path resolution (historical pattern, `packages/desktop` is now deleted): the `wslPath()` pattern resolved `$HOME` separately (no user input) then passed the path as an `execFileSync` array argument to prevent shell injection. Never interpolate user-controlled paths into `sh -lc` strings — always use the array-argument form of `execFileSync`.
- Fiber error handling in FiberMap: use `Effect.tapError` (observe + propagate) not `Effect.catch` (swallow) for sync loop errors — the error propagates, the fiber fails, FiberMap auto-removes it. See `packages/opencode/src/control-plane/workspace.ts:515`.
- V2 session delegation architecture: `packages/opencode/src/v2/session.ts` is a stable two-layer design — read methods (`get`/`list`/`messages`/`context`) query `SessionTable`/`SessionMessageTable` directly; write methods (`create`/`prompt`/`shell`/`skill`/`subagent`/`compact`) delegate to V1 services, which own the agent loop and persistence. V1 dual-writes `SessionEvent.*` behind `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM`; V2 projectors (`session/projectors-next.ts`) populate `SessionMessageTable` from those events. This is the intended architecture, not a migration-in-progress — the earlier `TODO(v2-native)` markers were removed (Option C simplification). The V1/V2 brand mismatch (`ModelID` vs `Modelv2.ID`) is centralized in `v2ModelToV1Session`/`v2ModelToV1Prompt` helpers. See `packages/opencode/src/v2/AGENTS.md`.
- `@ts-expect-error` is acceptable for genuine library type-definition bugs that can't be patched. Always include an explanatory comment.
- Permission system: `packages/opencode/src/permission/AGENTS.md` (`disabled()` semantics, `Wildcard.match`, `fromConfig`); `packages/opencode/src/agent/AGENTS.md` (subagent inheritance, tool restrictions); `packages/opencode/src/mcp/AGENTS.md` (MCP tool permission keys, pattern derivation).
- V1/V2 subagent parity: `tool/task.ts` (V1 TaskTool) and `v2/session.ts` (V2 subagent) share `subagentSessionPermission()` and `subagentToolRestrictions()` from `agent/subagent-permissions.ts`. Any change to permission derivation or tool restrictions must go through these helpers. V2 `subagent()` requires `Agent.Service` + `Config.Service` in test layers.
 - V2 `subagent()` abort: `Effect.runPromise(cancelChild)` returns a floating promise — always attach `.catch()`. V1 `tool/task.ts` now matches this pattern: `Effect.runPromise(cancel).catch(...)` instead of `runCancel.fork(cancel)`.
 - V2 `subagent()` parent agent lookup: when a configured parent isn't found, log a warning and apply fallback deny rules (`edit`, `write`, `bash` denied) — silent failure weakens deny-rule inheritance. V1 `tool/task.ts` applies the same fallback. Use `Effect.catchCause` with `Cause.squash(cause)`.
- Three distinct spinner systems coexist: TUI unified spinner (`component/spinner.tsx` via `ui/spinner-config.ts`), web/desktop SVG spinner (`packages/ui/src/components/spinner.tsx`), and `@clack/prompts` CLI spinner. They share no code and have different APIs. The TUI `Spinner` component wraps the native `<spinner>` element with an `animations_enabled` KV check and supports variants (`dots`, `knight-rider`, `blocks`). All TUI views use `<Spinner>` instead of native `<spinner>` directly.
- Nullish coalescing `??` does not fall through for `0` or `""` (only `null`/`undefined`). Use `||` when the intention is to fall through for all falsy values. Discovered in `getUsage`: `inputTokenDetails.cacheWriteTokens: 0` returned `0` instead of falling back to `metadata.anthropic.cacheCreationInputTokens`.
- SSRF DNS rebinding: DNS checks before HTTP requests are bypassed if the HTTP client re-resolves DNS independently. Pin the resolved IP in the request URL and set the `Host` header to the original hostname. See `tool/webfetch.ts` for the pattern.
- Type casts at library boundaries: prefer `as unknown as TargetType` over `as any` when bridging structurally compatible types. Add a comment explaining the compatibility. See `diff-wasm/src/index.ts` for examples.
- codebase-memory-mcp graph does NOT index external packages (`@opentui/core`, `effect`, etc.) or dynamic-dispatch calls (interface methods like `surface.render()`, `surface.commitRows()`, `surface.destroy()`). When tracing bugs through external renderable/surface/service APIs, read the source + external `.d.ts` directly — the graph's CALLS edges only capture static callees within indexed files.
- `@opentui/core` package structure: `index.js` (main entry), `index-hzcw4q21.js` (renderables incl. `MarkdownRenderable`), `index-qfwqv8y3.js` (core incl. `TreeSitterClient`, `FFIRenderLib`, `CodeRenderable`), `parser.worker.js` (tree-sitter worker). Markdown rendering chain: `MarkdownRenderable.updateBlocks()` → `parseMarkdownIncremental()` (uses `marked.lexer`) → `CodeRenderable` (`filetype: "markdown"`) → `startHighlight()` → `treeSitterClient.highlightOnce()` → on failure: `catch { textBuffer.setText(content) }` shows raw text.
- `OTUI_TREE_SITTER_WORKER_PATH` define in `packages/opencode/script/build.ts`: flat bunfs paths to injected virtual files work (`/$bunfs/root/<basename>`); bunfs paths with `../../` escape the virtual FS root → `ModuleNotFound`. `TreeSitterClient.resolveWorkerPath()` checks `env.OTUI_TREE_SITTER_WORKER_PATH` → `define` → `options.workerPath` → `new URL("./parser.worker.js", import.meta.url)`.
- `src/util/opentui-lib.ts` handles native library (`libopentui.so`) path resolution for compile vs dev mode. `@opentui/core-linux-x64/index.bun.js` uses `import("./libopentui.so", { with: { type: "file" } })` — static `type: "file"` import works in compile mode.
- `Bun.build --compile` plugin limitations: `onResolve`/`onLoad` only intercept STATIC imports at build time. Dynamic `import()` calls (especially with `with: { type: "wasm" }` or `type: "file"`) are resolved at runtime or fail before `onLoad` fires. To patch a dependency's dynamic import for compile mode, modify the file content BEFORE `Bun.build()` (write a patched copy, use as entrypoint), not via plugin `onLoad`. (See Known Issues for the `@opentui/core` wasm case.)
- Virtual file injection for compile mode (upstream `@opentui/core@0.4.5` pattern, adopted in `packages/opencode/script/build.ts`): read `parser.worker.js` as string, patch dynamic `import(..., { with: { type: "wasm" } })` → static `import ... with { type: "file" }`, inject via `Bun.build` `files` map as `opentui-tree-sitter-worker.js`. `OTUI_TREE_SITTER_WORKER_PATH` define points to `/$bunfs/root/opentui-tree-sitter-worker.js`. Use `conditions: ["bun", "node"]` (not `["browser"]`) so Bun resolves the `bun` export condition in `@opentui/core`'s `package.json`.
- TUI markdown render paths: v1 `Session()` → `AssistantMessage` → `TextPart` → `<markdown>` (when `OPENCODE_EXPERIMENTAL_MARKDOWN=true`, the default from `packages/core/src/flag/flag.ts`) or `<code filetype="markdown">`; v2 `session-v2.tsx` → `AssistantText` → `<code filetype="markdown">` (no `<markdown>` element). `scrollback.surface.ts` is NOT used by TUI.
- `@opentui/core` `highlightOnce` (index-qfwqv8y3.js:9183) silently swallows `Parser.init` errors: `catch { return { error: "Could not highlight because of initialization error" } }`. `startHighlight` (index-qfwqv8y3.js:18742) does NOT check `result.error` — `result.highlights ?? []` yields empty → plain text. The `CodeRenderable` catch block (index-qfwqv8y3.js:18800) is NOT reached because the error is swallowed upstream. When debugging "markdown shows raw text", inspect `highlightOnce` return value, not the catch block.
- Two `web-tree-sitter` versions coexist: root `0.26.11` (`web-tree-sitter.wasm`) and `@opentui/core` nested `0.25.10` (`tree-sitter.wasm`). `parser.worker.js` imports `tree-sitter.wasm` from nested `0.25.10`. The `wasmResolver` plugin in `build.ts` must resolve to `@opentui/core`'s nested `0.25.10` `tree-sitter.wasm` (not root `0.26.11`'s `web-tree-sitter.wasm` — wrong file).
- `web-tree-sitter` Emscripten module API (`node_modules/@opentui/core/node_modules/web-tree-sitter/tree-sitter.js`): `Module["wasmBinary"]` (line 2186) accepts `Uint8Array` of wasm bytes — bypasses file loading; `locateFile` (line 2092) resolves wasm path; `loadWebAssemblyModule` (line 2049) instantiates with imports; `instantiateAsync` (line 2335) handles `WebAssembly.instantiate`. `Parser.init({ wasmBinary })` may bypass WASI file loading issues (under investigation).
- Debug logging in compiled ESM binary: `Bun.write({append:true})`, `require("fs")`, and `globalThis.require` all fail. Use `import { appendFileSync } from "fs"` at module level (top of file) — works in compiled ESM context.
- Upstream fixes may not be ported to this fork. Before debugging a bug that seems like it should already be fixed, search upstream (`anomalyco/opencode`) for the issue — the fix may exist in a commit that was never merged into this branch. Example: `94564f358` fixed double auto-compaction from `filterCompacted` reorder, but was missing from this fork's history.
- `Agent.Service.get()` is a method on the service interface, not a separate Context tag. Yielding `Agent.Service` gives the service instance directly.
- `effectCmd` expects CLI handlers to return `Effect<void, CliError, ...>`. Use `fail()` from `effect-cmd` for errors, not `Effect.fail(new Error(...))`.
- `Skill.Info` requires `description` (enforced by zod) and optionally carries `warnings: string[]` for frontmatter issues. Test fixtures and manual `Info` construction must include `description` or typecheck fails. Use `Skill.allIncludingInvalid()` to see all skills including those with warnings.
- TUI event loop starvation: `queueMicrotask` in `footer.ts` was replaced with `setTimeout(0)` because microtasks run before I/O events — a burst of microtasks from streaming delays keypress/ESC handling. `setTimeout(0)` lets I/O events drain between flush cycles. This is the general pattern for any TUI callback that coalesces high-frequency events.
- `runtime.runSync` must NOT be used for TUI transport callbacks (`stream.transport.ts`). Even when the Effect is `Effect.sync()` (truly synchronous), `runSync` blocks the event loop. Use `void runtime.runPromise(...).catch(() => {})` to preserve the `void` return type. The only safe `runSync` calls are in `bus/index.ts` (subscribe chain is entirely synchronous) and `sync/index.ts` (export functions not called in production code paths).
- `surface.settle()` in `scrollback.surface.ts` triggers tree-sitter re-parse of the **full accumulated content**. Called per-delta, it starves the event loop. Three optimizations: (1) 16ms throttle in `writeStreaming`, (2) content-change check (`lastSettledContent`) in `flushActive`, (3) streaming fallback (row-level commit when `commitMarkdownBlocks` fails). See `packages/opencode/src/cli/cmd/run/AGENTS.md`.
- Snapshot `track()` is called on every LLM step (`processor.ts:122,500`). Each call spawns 5+ git processes. `lastHash` cache skips `write-tree` when nothing changed. `restore()`/`revert()` invalidate `lastHash`. See `packages/opencode/src/snapshot/AGENTS.md`.

## Code review: stale "BUG" comments in tests

Comments like `"BUG: on current code..."` or `"Phase 2 fix..."` in test files describe historical bugs that are already fixed. The test assertions verify the fix. When evaluating such reviews, check the implementation first — the bug is often already resolved and the comment is stale. Update the comment to describe the verified behavior, not the historical bug.

## TypeScript Navigation (typegraph-mcp)

Use the `ts_*` MCP tools instead of grep/glob for navigating TypeScript code where suitable. They resolve through barrel files, re-exports, and project references and return semantic results instead of string matches.

- Point queries: `ts_find_symbol`, `ts_definition`, `ts_references`, `ts_type_info`, `ts_navigate_to`, `ts_trace_chain`, `ts_blast_radius`, `ts_module_exports`
- Graph queries: `ts_dependency_tree`, `ts_dependents`, `ts_import_cycles`, `ts_shortest_path`, `ts_subgraph`, `ts_module_boundary`

Start with navigation tools before reading entire files. Use direct file reads only after the MCP tools identify the exact symbols or lines that matter.

For quick architectural insight, prefer composition modules and entrypoints over top-level barrel files. If `ts_module_exports` on an `index.ts` or other barrel looks empty or uninformative, pivot to the app entrypoint, router, handler, service composition root, or API module that wires real behavior together.

Use `rg` or `grep` when semantic symbol navigation is not the right tool, especially for:

- docs, config, SQL, migrations, JSON, env vars, route strings, and other non-TypeScript assets
- broad text discovery when you do not yet know the symbol name
- exact string matching across the repo
- validating wording or finding repeated plan/document references

Practical rule:

- use `ts_*` first for TypeScript symbol definition, references, types, and dependency analysis
- use `rg`/`grep` for text search and non-TypeScript exploration
- combine both when a task spans TypeScript code and surrounding docs/config

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **opencode-personal** (40559 symbols, 74779 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/opencode-personal/context` | Codebase overview, check index freshness |
| `gitnexus://repo/opencode-personal/clusters` | All functional areas |
| `gitnexus://repo/opencode-personal/processes` | All execution flows |
| `gitnexus://repo/opencode-personal/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
