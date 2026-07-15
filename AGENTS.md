- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## About

Bun workspace monorepo: `packages/*`, `packages/console/*`, `packages/sdk/js`, `packages/slack`. Catalog versioning via `catalog:` in bun.lock; workspace deps via `workspace:*`; patched deps in root `package.json`.

## Setup

- `bun install` resolves catalog versions, workspace deps, and patches
- `bun.lock` stores catalog versions with `catalog:` prefix
- `package.json` `patchedDependencies` map to `patches/` directory

## Development

- `bun run dev` / `dev:web` / `dev:console` / `dev:desktop` / `dev:storybook`
- `bun run lint` (oxlint)
- `bun run typecheck` (turbo typecheck)
- Regenerate JS SDK: `./packages/sdk/js/script/build.ts`

## Bulk Dependency Updates

- Use `bun run script/check-updates.ts` to scan all pinned deps across the monorepo and check npm registry for available minor/patch upgrades.
- `--apply` writes new versions to package.json files; `--apply --install` also runs `bun install`.
- The script skips `catalog:`, `workspace:*`, `npm:`, `github:`, `file:`, and `https://` references automatically.
- After applying, always run `bun run --cwd packages/opencode typecheck` to catch breaking changes in minor/patch bumps (some packages silently remove or rename exports in minor versions).

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

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

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`
- Package test directories follow `packages/<name>/test/` or `packages/<name>/test/<subpath>/`
- `mock.module()` in bun:test persists across test files — always use `afterAll(() => mock.restore())` to prevent leakage. Without cleanup, mocks applied in one test file affect imports in other test files that import the same module.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.
- `packages/web` requires `--skipLibCheck` due to pre-existing astro/starlight lib errors

## Technologies

- zod 4.1.8 (catalog) + @hono/zod-validator 0.4.2 — use for HTTP boundary typing to eliminate `as any` casts
- Bun 1.3.13 with workspace support, catalog versions, and patches
- Drizzle ORM (beta) with snake_case field convention
- Effect 4.0.0-beta.59
- SolidJS + Astro/Starlight (web), OpenTUI (TUI)
- Turbo for monorepo orchestration

## Rules

- Do not split files without tests first (Rule 3). `packages/opencode/src/cli/cmd/run/tool.ts` was split into 6 modules (tool.types.ts, tool.helpers.ts, tool.path.ts, tool.rules.ts, tool.display.ts, barrel) only after 26 display function tests were written (26/26 pass). The original 213-line `TOOL_RULES` dict and 1464-line file are now properly decomposed.
- Type HTTP boundaries with zod before eliminating `as any` casts. Provider files (openai.ts, anthropic.ts, openai-compatible.ts) had 213+ instances — resolved in d82e6af by removing redundant casts (all `body: any` property accesses). Remaining `as any` casts are limited to library internals (effect-zod: 3, slack: 1, plugin: 1, desktop: 1) and test assertions accessing Effect Schema internals.
- Large icon component files (>300 lines) should be split by Heroicons prefix category (arrows, coding, communication, data, file, general, layout, media, social). See `packages/web/src/components/icons/` for the pattern.
- Before splitting a god function, extract small single-responsibility modules first (e.g., cost, billing, auth, model validation) to reduce risk. `packages/console/app/src/routes/zen/util/handler.ts` went from 1132 → 468 → 154 lines via two phases of extraction. Phase 1 (9 modules): cost.ts, billing.ts, usage.ts, auth.ts, provider-selector.ts, model.ts, reload.ts, validation.ts, http.ts. Phase 2 (6 modules): request.ts, setup.ts, retry.ts, response.ts, error-mapping.ts, plus HandlerDeps injection. handler.ts is now a thin orchestrator: `parseRequest → setupRequest → executeRetriableRequest → handleResponse → mapErrorToResponse`.
- Drizzle ORM type mismatches (e.g., `UserTable.userID`, `WorkspaceTable.workspaceID`) often require runtime `any` casts during extraction. Accept them as necessary boundary violations, not technical debt to immediately resolve.
- Avoid sed for code extraction; prefer manual refactor or structural search tools (ast-grep) to prevent stray syntax artifacts.
- System prompts use a shared core (`session/prompt/core.txt`) plus provider-specific deltas (`session/prompt/delta-*.txt`). Do not duplicate universal rules across deltas — put them in core.txt. Provider deltas contain only provider-specific guidance (TodoWrite emphasis for Claude, apply_patch for GPT, autonomous mode for GPT-4/o1/o3, etc.). Provider matching is in `system.ts:matchDelta()`.
- AGENTS.md is injected as a **user message** (not system prompt) per the Instruction Hierarchy pattern (Claude Code / Codex CLI). It is re-read from disk on every LLM API call inside `runLoop` — no caching, so edits take effect immediately. See `session/prompt.ts:1638-1644` for the injection point.
- System prompt assembly: `llm.ts:102-114` splits into cacheable prefix (`system[0]` = core + delta) and dynamic suffix (`system[1]` = environment + skills). The plugin transform hook and rejoin logic at `llm.ts:116-121` maintain the 2-part structure for prompt caching.
- XML section markers are used consistently: `<environment>`, `<skills>` in system prompt; `<instructions source="...">` for AGENTS.md/CLAUDE.md; `<system-reminder>` for transient status (plan mode, build switch, max steps). Do not mix these tag semantics.

## Known Issues

- `packages/console/app/src/routes/zen/util/handler.ts` is now a 154-line thin orchestrator (was 468, originally 1132). Fully decomposed into 15 modules in `zen/util/`: cost.ts, billing.ts, usage.ts, auth.ts, provider-selector.ts, model.ts, reload.ts, validation.ts, http.ts, request.ts, setup.ts, retry.ts, response.ts, error-mapping.ts, plus HandlerDeps injection. 93 tests across 14 files.
- `packages/console/app/src/routes/zen/util/billing.ts`, `reload.ts`, `usage.ts` require SST cloud resources at module load time (`@opencode-ai/console-core/lite.js`). Tests use `mock.module()` to mock these 3 modules with `afterAll(() => mock.restore())` cleanup. See `packages/console/app/src/routes/zen/util/AGENTS.md` for details.
- Typecheck in `packages/web` requires `--skipLibCheck` due to astro/starlight type errors
- Root `test` script always fails: `echo 'do not run tests from root' && exit 1`
- `packages/opencode/src/session/prompt.ts:1480` — `runLoop` is a ~230-line Effect-based infinite loop; future extraction target
- Remaining `as any` casts (6 total) are in library internals: `packages/core/src/effect-zod.ts` (3, accessing Effect Schema annotations), `packages/slack/src/index.ts` (1, Slack message shape), `packages/opencode/src/plugin/index.ts` (1, plugin hook typing via `(hook as any).config?.(cfg)`), `packages/desktop/src/main/index.ts` (1, Electron HTTP proxy), plus test files accessing Effect internals
 - `useFilteredList` (`packages/ui/src/hooks/use-filtered-list.tsx`) must use `createResource` (not `createMemo`) for grouped data when `items` can be async. Commit `016a457` replaced `createResource` with `createMemo` + separate `asyncItems` resource and `Object.assign` to mock the `Resource` shape — this silently broke reactivity: API calls succeeded (200 OK) but `List`-based dialogs (`dialog-select-directory`, `dialog-select-model`) rendered empty. Reverted in working tree; the `keys` memo optimization (`6541fdf`) is safe and preserved.
 - TypeScript conditional types in function parameter positions can cause the compiler to skip parameters. Both `tsc` and `tsgo` are affected. Example: `[Extract<T, ...>["properties"]] extends [never] ? ...` in a parameter type caused `id: string` to be skipped in `@openauthjs/openauth`'s `OnSuccessResponder.subject()`.

## Notes

- bun.lock stores catalog versions with `catalog:` prefix
- `new Array<T>()` in `.tsx` files is parsed as JSX (angle brackets). Use `Array<T>()` (without `new`) or `[] as T[]` instead.
- Squash-merged PR branches (`gh pr merge --squash`) remain "unmerged" from git's perspective — `git branch -d` refuses them, `git branch --no-merged` shows them. Use `git branch -D` or `git push origin --delete` to clean up.
- Sequential squash merges: the first merge updates `main`, so subsequent PRs fail with "Base branch was modified". Rebase the remaining PR branches onto the updated `main` before retrying.
- PR branches created from a stale base (not the current `main` tip) carry unrelated changes in `gh pr diff`. A 2-line PR fix can appear to touch 100+ files. Fix by creating a clean branch from `main` and applying only the intended changes.
- `bun install` can silently modify `bun.lock` (configVersion removal, integrity hash stripping, formatting churn) even without dependency changes. Revert lockfile to match the base branch unless intentionally updating dependencies.
- Prettier config: no semicolons, 120 char printWidth (in root `package.json`)
- `do-not-run-tests-from-root` guard prevents running tests from repo root
- ast-grep is installed at `/home/aristo/.npm-global/bin/ast-grep` and is effective for bulk AST-level refactoring (e.g., removing redundant `(x as any)` casts when the variable is already typed `any`)
- Provider files had 213 redundant `as any` casts removed in commit d82e6af by adding index signatures to `CommonRequest`/`CommonResponse` interfaces
- Error handling: use `safeCatch` from `packages/opencode/src/util/error.ts` for promise error wrapping instead of manual try/catch; it logs context automatically
- Message continuation: extracted 16-line `wrapMessageContinuation` to `packages/opencode/src/session/message-continuation.ts` — pure function mutating message parts in-place; operate on message array copy before calling
- Provider usage feature: `packages/opencode/src/provider/usage/` contains types.ts (interfaces), claude.ts (Anthropic OAuth fetcher), zai.ts (ZAI API key fetcher), registry.ts (auth.json reader + dispatcher). `/usage` TUI dialog at `cli/cmd/tui/component/dialog-usage.tsx`.
- Double compaction fix: overflow guard now checks `compaction_continue` metadata to prevent `Event.Compacted` double-fire (`session/prompt.ts:1564`)
- Security: use `constantTimeEqual()` (wrapper around `node:crypto`'s `timingSafeEqual`) for secret comparisons, not `!==`. Pattern in `packages/function/src/api.ts` and `packages/enterprise/src/core/share.ts`. Both define a local `constantTimeEqual(a, b)` that handles length mismatch before calling `timingSafeEqual`.
- Provider system prompt: `ProviderTransform.systemPromptDelivery(providerID, authInfo)` in `packages/opencode/src/provider/transform.ts` — returns `{ type: "instructions" }` for OpenAI OAuth, which doesn't support `system` role messages (system prompt passed via `instructions` field instead). Used in `session/llm.ts:108` and `agent/agent.ts:456`.
- WSL path resolution: `wslPath()` in `packages/desktop/src/main/apps.ts` resolves `$HOME` separately (no user input) then passes the path as an `execFileSync` array argument to prevent shell injection. Never interpolate user-controlled paths into `sh -lc` strings.
- Fiber error handling in FiberMap: use `Effect.tapError` (observe + propagate) instead of `Effect.catch` (swallow) for sync loop errors. The error propagates, the fiber fails, and FiberMap auto-removes it. See `packages/opencode/src/control-plane/workspace.ts:512`.
- SolidJS `createResource` reactivity: never mock a `Resource` return type with `Object.assign(() => memo(), { get latest() {...}, get loading() {...} })`. SolidJS tracks resource state internally and consumers like `<For each={grouped.latest}>` and `grouped.loading` checks rely on native `Resource` reactivity. Replacing `createResource` with `createMemo` + `Object.assign` breaks async item rendering in `List` components — API calls succeed but items never appear. See `packages/ui/src/hooks/use-filtered-list.tsx`.
 - V2 session delegation bridge: `packages/opencode/src/v2/session.ts` delegates its write methods (create/prompt/compact/wait/shell/skill/subagent) to V1 services rather than reimplementing the agent loop. This works because V1 already dual-writes every `SessionEvent.*` behind `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM`, and the V2 projectors (`session/projectors-next.ts`) are wired globally. V1 services are captured via `Effect.serviceOption` so read methods work without them; in production they come from `instanceContextLayer`. V1/V2 brand mismatch (`ModelID` vs `Modelv2.ID`) requires `as unknown as` casts at the boundary. All methods have `TODO(v2-native)` markers for a future native-loop swap. See `packages/opencode/AGENTS.md` for details.
 - `@ts-expect-error` is an acceptable workaround for genuine library type definition bugs that can't be easily patched. Always include an explanatory comment.
 - Permission system: `packages/opencode/src/permission/AGENTS.md` covers `disabled()` semantics, `Wildcard.match` behavior, and `fromConfig` rules. `packages/opencode/src/agent/AGENTS.md` covers subagent permission inheritance and tool restrictions. `packages/opencode/src/mcp/AGENTS.md` covers MCP tool permission keys and pattern derivation.
