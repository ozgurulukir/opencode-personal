# Issue #380 Phase 1 — Characterization tests for message-part pure seams

- **Repo:** `ozgurulukir/opencode-personal` · **Branch:** `issue-380-app-godfile-phase1`
- **Issue:** [#380 — [app] God-file decomposition roadmap (layout/session/message-part-prompt-input)](https://github.com/ozgurulukir/opencode-personal/issues/380)
- **Scope:** Phase 1 ONLY (characterization tests). Phase 2+ extractions are separate follow-up PRs (see §Follow-ups).

## 1. Goal

Lock the existing behavior of the pure seams inside the `message-part` god-file **before** any decomposition, per root AGENTS.md Rule 3 ("characterization tests are mandatory before any file split or refactoring"). This PR delivers:

1. **Primary:** characterization tests for the `ToolRegistry` pure seam (the issue's stated starting point — pure module-level map, easiest to lock).
2. **Secondary (cheap, already exposed, no extraction needed):** the two other context-free exported seams in the same file — `PART_MAPPING`/`registerPartComponent` and `getToolInfo`.

No behavior change, no source edits, no feature work. Tests only.

### Path correction (verified against the tree)

The issue text says `packages/app/src/ui/message-part.tsx` — **that path does not exist.** The file (2368 lines, matching the issue's evidence) is at:

| Issue claim | Actual location (verified) |
| --- | --- |
| `packages/app/src/ui/message-part.tsx` (2368) | `packages/ui/src/components/message-part.tsx` (2368 ✓) |
| `message-part-utils.test.ts` | `packages/ui/src/components/message-part-utils.test.ts` ✓ |

The other three god-files ARE in `packages/app` (`pages/layout.tsx` 2438, `pages/session.tsx` 1979, `components/prompt-input.tsx` 1623 — all verified). This PR therefore touches **`packages/ui` only**; Phase 2+ PRs for the app god-files stay in `packages/app`.

Note: `_plan/webui-review-findings-2026-11-08.md` was requested as supplementary context but **does not exist on disk** — skipped.

## 2. Steps

### Step 1 — Create `packages/ui/src/components/message-part.test.ts`

**Why:** Colocated next to source, matching the repo convention (`message-part-utils.test.ts` sits beside `message-part-utils.ts`; `packages/ui/AGENTS.md`: tests live in `src/components/`, run via `bun test <filename>` from `packages/ui`).

**File preamble (verified empirically — all three smoke-tested green):**

```ts
import { afterAll, describe, expect, mock, test } from "bun:test"

// message-part.tsx imports @solidjs/router, which reads window.history at module
// load (node_modules/@solidjs/router/dist/index.js:43) — bun test has no DOM.
// Stub only what the module graph needs; no other ui test imports the router.
mock.module("@solidjs/router", () => ({
  useLocation: () => ({ pathname: "/" }),
  useNavigate: () => () => {},
}))
afterAll(() => mock.restore())

// Static import would run before mock.module (imports are hoisted) — dynamic import
// after the mock is required. Top-level await is supported in bun test files.
const { ToolRegistry, registerTool, getTool, getToolInfo, PART_MAPPING, registerPartComponent } = await import(
  "./message-part"
)
```

**No `as any` anywhere in this file** (A-13 spirit). The seams' signatures make casts unnecessary: `getToolInfo(tool, input: any = {}, metadata = {})` takes plain objects; registry `render` components can be typed `const Comp: ToolComponent = () => null` / `const Comp: PartComponent = () => null` if inference needs the annotation. Any fixture that genuinely needs a downcast uses `as unknown as T` (existing convention in `message-part-utils.test.ts:14,31`), never `as any`.

**Isolation rules:** every registration in tests uses a unique name/type (`__mp_test_*`) — never overwrite a built-in (`read`, `text`, …) so tests stay order-independent within the file and the shared bun module registry isn't polluted for future test files.

#### 1a. `describe("ToolRegistry")` — 9 tests (primary target)

Source: `message-part.tsx:1302-1322` (`state` map, `registerTool`, `getTool`, `ToolRegistry` alias), 14 module-load registrations at `:1586,1626,1646,1670,1697,1743,1769,1855,1921,1993,2052,2251,2302,2347` (all `ToolRegistry.register({` lines — re-verified against the tree; the previous list's last seven pointed at the `name:` lines instead), consumer fallback `ToolRegistry.render(...) ?? GenericTool` at `:1392`.

| Test name (behavioral) | Behavior locked |
| --- | --- |
| `registerTool stores the renderer under the given name and returns the input` | `state[name] = input`; return value is the input object (identity `toBe`) |
| `getTool returns the registered renderer for a known tool` | lookup hit returns the exact function registered |
| `getTool returns undefined for an unregistered tool name` | miss path — `state[name]?.render` short-circuits to `undefined` (this is the contract `ToolPartDisplay:1392` relies on to fall back to `GenericTool`; the fallback component itself is NOT rendered here) |
| `registering the same tool name twice keeps only the latest renderer` | duplicate/override: plain property assignment, last write wins |
| `registering a tool without a renderer leaves lookup returning undefined` | `render?` is optional — entry exists but `getTool` still returns `undefined` |
| `ToolRegistry exposes register and render as aliases of the standalone functions` | `ToolRegistry.register === registerTool`, `ToolRegistry.render === getTool` |
| `ToolRegistry surface is exactly register and render` | `Object.keys(ToolRegistry).sort()` → `["register", "render"]` — locks the public API shape against accidental growth during Phase 2 extraction |
| `every built-in tool registered at module load resolves to a renderer` | the 14 names `read, list, glob, grep, webfetch, websearch, task, bash, edit, write, apply_patch, todowrite, question, skill` each `getTool(name)` → function. Locks the module-load registration table: a Phase 2 move of the registrations must preserve it |
| `unknown tool lookup yields undefined so ToolPartDisplay falls back to GenericTool` | locks the `?? GenericTool` composition at `:1392` from the registry side: `getTool("definitely_missing")` is `undefined` so `getTool(missing) ?? fallback` resolves to the fallback (local stub component — `GenericTool` is imported by message-part from `./basic-tool`, not re-exported), and the hit side of `??` resolves to the registered renderer; component mounting deferred |

#### 1b. `describe("PART_MAPPING")` — 4 tests (secondary, exposed)

Source: `PART_MAPPING` at `:161` (exported `Record<string, PartComponent | undefined>`), built-ins assigned at `:1360` (tool), `:1456` (compaction), `:1461` (text), `:1568` (reasoning); `registerPartComponent` at `:832-834`; consumer `Part` at `:1270-1285` does `PART_MAPPING[props.part.type]` inside `<Show when={component()}>`.

| Test name | Behavior locked |
| --- | --- |
| `built-in part types tool, text, reasoning and compaction have renderers after module load` | the four module-load assignments exist and are functions |
| `unknown part types have no renderer so Part renders nothing` | `PART_MAPPING["__mp_missing__"]` → `undefined` (the `<Show when>` miss path) |
| `registerPartComponent adds a renderer for a new part type` | adds under a fresh unique type key |
| `registerPartComponent replaces the renderer for an existing part type` | override on a unique key registered twice (never on a built-in) |

#### 1c. `describe("getToolInfo")` — 13 tests (secondary, exposed)

Source: `getToolInfo` switch at `:328-429`, private helpers `webSearchProviderLabel` (`:322-326`) and `agentTitle` (`:276-279`) exercised through it. **Verified to work outside an `I18nProvider`** — `useI18n()` (`context/i18n.tsx:30,36-38`) has a `createContext` fallback bound to the `en` dict, so titles resolve to English defaults with no provider/mounting. Subtitles go through `getFilename` (`@opencode-ai/core/util/path.ts:1-6`).

| Test name | Behavior locked |
| --- | --- |
| `read tool info shows the file basename as the subtitle` | `{ icon: "glasses", title: "Read", subtitle: "b.ts" }` for `filePath: "/a/b.ts"` |
| `read tool info has no subtitle when filePath is missing` | default `input = {}` → `subtitle: undefined` |
| `list tool info shows the file basename from the path` | `path: "/x/y"` → `subtitle: "y"` |
| `glob and grep tool info surface the search pattern as the subtitle` | both cases → `icon: "magnifying-glass-menu"`, `subtitle = input.pattern` |
| `webfetch tool info shows the url as the subtitle` | `subtitle = input.url` |
| `websearch tool info labels parallel and exa providers` | `"parallel"` → `"Parallel Web Search"`, `"exa"` → `"Exa Web Search"`; `subtitle = input.query` |
| `websearch tool info falls back to Web Search for unknown providers` | any other provider → `"Web Search"` |
| `task tool info capitalizes the subagent type in the title` | `subagent_type: "plan"` → title `"Plan Agent"` (i18n `{{type}} Agent` template) |
| `task tool info defaults to Agent when no subagent type is given` | no/empty `subagent_type` → title `"Agent"`; `subtitle = input.description` |
| `bash tool info shows the description as the subtitle` | `{ icon: "console", title: "Shell", subtitle: input.description }` |
| `edit and write tool info show the file basename` | both → `icon: "code-lines"`, titles `"Edit"`/`"Write"`, `subtitle = getFilename(filePath)` |
| `apply_patch tool info pluralizes the file count` | 1 file → `"1 file"`, 2 files → `"2 files"` (`ui.common.file.one/other`) |
| `unknown tools fall back to the mcp icon and the raw tool name` | default branch → `{ icon: "mcp", title: tool }` |

(If review wants a tighter file, `skill` → `input.name || "Skill"` and `todowrite`/`question` fixed titles are cheap additions — same pattern, not required.)

### Step 2 — Verify (exact commands)

All commands run from package dirs (root AGENTS.md: tests cannot run from repo root; `packages/ui/AGENTS.md`: `bun test <filename>` without a path prefix).

```powershell
# 1. New file in isolation (mirrors the package test script's preloads)
cd C:\Github\opencode-personal\packages\ui
bun test message-part.test.ts --conditions=browser --preload ./test/solid-jsx.ts

# 2. Full packages/ui suite stays green (baseline before this PR: 147 pass / 0 fail / 14 files)
bun run test

# 3. Typecheck (tsgo --noEmit) — also proves zero `as any` / correct ToolComponent typing
bun typecheck

# 4. Lint from repo root (oxlint); confirm no : error for the new file
cd C:\Github\opencode-personal
bun run lint

# 5. Confirm no `as any` crept into the new test
rg "as any" packages/ui/src/components/message-part.test.ts   # expect: no matches
```

Success criteria: all five green; full suite ≥ 147 + 26 = 173 pass, 0 fail. Final state check — run `git status --porcelain` only AFTER any temporary sanity mutation has been fully restored (`git checkout -- packages/ui/src/components/message-part.tsx`): it must show **no modified tracked files** (in particular `message-part.tsx` clean) and **exactly one new untracked file**, `packages/ui/src/components/message-part.test.ts`. Notes: `_plan/` is gitignored (`.gitignore:60`), so this plan file does not appear in `git status`; pre-existing untracked entries that predate this work (e.g. `.zay/`) are unrelated and must be left untouched.

### Step 3 — No other changes

- Do **not** modify `packages/ui/package.json` test scripts (see Architecture Decisions — happy-dom is ruled out).
- Do **not** touch `message-part.tsx` or any production file.
- Do **not** touch `packages/app` (its `sendFollowupDraft.test.ts` A-13 casts are a separate sub-item, §4).

## 3. Architecture Decisions

### AD-1: Test file location — `packages/ui/src/components/message-part.test.ts`

- **Approach:** one colocated test file covering all three exposed pure seams, single `mock.module` + single dynamic import preamble.
- **Rationale:** matches `message-part-utils.test.ts` co-location convention (`packages/ui/AGENTS.md` explicitly deviates from root's `test/` dir convention); one preamble instead of three; the seams are all in one source file and will be extracted together conceptually.
- **Alternatives:** (a) separate file per seam (`message-part-registry.test.ts`, …) — more files, repeated preamble, no benefit at this size; (b) put tests in `packages/app` per the issue's stale path — wrong package, would break co-location convention.
- **Trade-off:** ~30 tests in one file is reviewable in one pass; if Phase 2 extracts seams into separate modules, the test file can split in the same PR (test moves are mechanical).

### AD-2: `mock.module("@solidjs/router")` + dynamic import — NOT happy-dom preload

- **Approach:** stub the router before `await import("./message-part")`; `afterAll(() => mock.restore())` per root AGENTS.md (mock.module persists across test files).
- **Rationale (both verified empirically in this session):**
  1. Static import of `message-part.tsx` **fails** in bun test: `@solidjs/router/dist/index.js:43` calls `window.history` at module load → `ReferenceError: window is not defined`.
  2. Adding `--preload ./test/happydom.ts` (registering `@happy-dom/global-registrator`) **breaks 2 existing tests**: `theme-storage.test.ts:16` and `theme-css.test.ts:130` assign `globalThis.localStorage = …`, which happy-dom makes readonly (`TypeError: Attempted to assign to readonly property`) → suite drops to 124 pass / 2 fail.
  3. The router mock alone loads the full module graph (markdown, kobalte, motion, i18n…) and all three seams work — smoke-verified green (registry hit/miss/override, `getToolInfo` outside provider, `PART_MAPPING` keys).
- **Alternatives:** (a) happy-dom preload in `package.json` — rejected: breaks theme tests, and fixing them is an unrelated test refactor outside this PR's scope; (b) hand-rolled `globalThis.window` stub — fragile (router touches more than `history`), non-idiomatic; (c) extract the registry first so tests import a leaf module — that IS Phase 2, forbidden here (Rule 3 requires tests first).
- **Trade-off:** the mock leaks across test files unless restored (root AGENTS.md warning) — mitigated by `afterAll(mock.restore)`; no other `packages/ui` test imports `@solidjs/router` (verified by rg), so blast radius is nil even if restore semantics differ across bun versions.

### AD-3: Include `PART_MAPPING` + `getToolInfo` (the "if cheap" clause) — but only exported seams

- **Approach:** cover the two additional **already-exported**, context-free pure seams in the same file; explicitly exclude unexported pure helpers.
- **Rationale:** scope allows "pure grouping/formatting helpers **already exposed**". `getToolInfo` and `registerPartComponent` are exported and need zero source changes (i18n fallback proven). `groupParts`/`sameGroup`/`sameGroups`/`isContextGroupTool` (`:510-588`, `:735-737`), `urls` (`:431`), `sessionLink` (`:443`), `tone`/`taskAgent` (`:303-320`), `renderable` (`:598`), `toolDefaultOpen`/`partDefaultOpen` (`:609-617`), `getDiagnostics` (`:105`) are **module-private** — locking them requires exporting or extracting first, i.e. a source change → Phase 2 territory.
- **Trade-off:** grouping (the issue's third named concern) stays unlocked until Phase 2; its extraction PR must write its characterization tests as its first commit (Rule 3 satisfied within that PR).

### AD-4: Behavioral test names, concrete English assertions

- **Approach:** names follow root AGENTS.md "Behavioral Naming" (`registerTool stores the renderer under the given name…`); titles/subtitles asserted as concrete strings (`"Read"`, `"Plan Agent"`, `"1 file"`).
- **Rationale:** characterization = lock *current observable output*, not re-derive it (anti-pattern: importing `en` dict and comparing against `en["ui.tool.read"]` duplicates implementation logic in the test). Concrete strings flag accidental copy/logic drift during decomposition.
- **Trade-off:** a deliberate i18n copy change will fail these tests — correct for a characterization suite; update assertions in the same PR as the copy change.

### AD-5: Out of scope (explicit)

| Deferred | Why |
| --- | --- |
| Component renderers (`ToolPartDisplay` dispatch, `Dynamic`, error `Switch`, `GenericTool` rendering, `TextPartDisplay`, …) | Require SolidJS mounting + `DataProvider`/i18n/router contexts; `packages/ui` has no renderer-test harness (only happy-dom-free pure tests + stories) → later phases / Storybook |
| Effects & memos (`createMemo` at `:1392`, `hideQuestion`, `taskHref`, streaming flags, …) | Phase 3 targets effect/memo count reduction; those need their own characterization first |
| Unexported pure helpers (grouping, `urls`, `sessionLink`, `tone`, `taskAgent`, `renderable`, `toolDefaultOpen`, `partDefaultOpen`, `getDiagnostics`) | Not exposed; locking requires export/extraction = source change → Phase 2 PR's first step |
| `packages/app` god-files (layout/session/prompt-input) | Phases 2+ per issue; separate PRs |
| A-13: `sendFollowupDraft.test.ts` `as any` casts (24 occurrences found; issue says 19 — stale count) | Separate sub-item, `packages/app`; this PR only guarantees **zero new** `as any` |
| `packages/ui` happy-dom preload for future renderer tests | Would require fixing `theme-storage`/`theme-css` readonly-localStorage tests first — separate PR |

## 4. Follow-ups (Phase 2+, separate PRs — reference this plan)

Phase 2+ extractions are **out of scope here** and must be separate PRs that cite `_plan/issue-380-app-godfile-phase1-2026-11-08.md` as their Rule 3 gate:

1. **Phase 2 — extract one seam per PR** (issue acceptance criteria). First candidates, in dependency order, each PR: move code → keep `message-part.tsx` re-exports (strangler fig) → run this plan's tests unchanged as the regression net → only then delete re-exports.
   - `ToolRegistry` (state/register/get) → e.g. `message-part/tool-registry.ts`
   - `getToolInfo` → e.g. `message-part/tool-info.ts`
   - `PART_MAPPING`/`registerPartComponent` → e.g. `message-part/part-mapping.ts`
   - Unexported pure helpers (`groupParts`, `sameGroup(s)`, `isContextGroupTool`, …): the extraction PR **must add characterization tests in its first commit** (they can't be tested before export — Rule 3 satisfied test-first within the PR).
2. **Phase 3** — reduce `createMemo`/`createEffect` counts, with its own characterization net for reactive behavior.
3. **A-13** — tighten `sendFollowupDraft.test.ts` casts (`as any` → `as unknown as T` / narrowing) in `packages/app`.
4. **Issue hygiene** — update #380's file paths (`packages/app/src/ui/…` → `packages/ui/src/components/message-part.tsx`) and the A-13 cast count (19 → 24) so later phases don't chase stale anchors.

## 5. Open Questions

1. **Grouping seam sequencing:** for Phase 2 extraction of `groupParts`, do we export it in place first (tiny source PR + tests) or write tests inside the extraction PR against the new module? (Recommendation: tests-first commit inside the extraction PR — avoids a standalone export-only PR.)
2. **Renderer test harness:** should a later PR add happy-dom to `packages/ui` (fixing the two readonly-`localStorage` tests) to unlock mounted-renderer characterization, or stay with pure-function tests + Storybook? Affects how much of Phase 2/3 can be locked before moving component code.
3. **`getToolInfo` copy assertions:** confirm reviewers accept concrete English string assertions (`"Read"`, `"Plan Agent"`) rather than en-dict lookups — see AD-4.
4. **Built-in list drift:** the 14-tool and 4-part-type module-load assertions intentionally fail when registrations are added/removed — desired as a tripwire, or should they be `expect.arrayContaining`-style (weaker)? (Recommendation: keep strict — registration table changes should be conscious.)
