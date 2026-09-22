# Plan: Verify `_review/_arch-review.md` claims and append dated corrections

**Date:** 2026-09-22 (rev 4 — line-count methodology corrected; false STALE verdicts removed)
**Source:** `_review/_arch-review.md` (repo root, UNTRACKED, last modified 22.09.2026 09:25)
**Scope:** Planning only — no source files modified in this phase. Only `_review/_arch-review.md` (and this plan file) change in the Code stage.

---

## Goal

`_review/_arch-review.md` was written by 4 read-only research agents. Before its conclusions are acted on, every factual claim in the review must be verified against the CURRENT working tree, and every STALE / INACCURATE claim must get an exact, dated correction appended under the affected item — mirroring the integrity-notice pattern of `_review/CODE_REVIEW.md` (original text preserved, dated correction block appended, evidence cited as `file:line`) and the plan precedent `_plan/fix-code-review-findings-2026-09-22.md` (verification outcome recorded before any work; stale claims documented, not silently rewritten).

**Scope of "every factual claim":** all checkable assertions in §1–§6, including the §1 At-a-Glance table, §2 findings/risks/strengths, §3 findings/risks, §4 findings/risks, §5 paragraphs/risks, and the validity of the 8 §6 recommendations. Purely evaluative judgments (e.g. "production-grade", "mature") are out of scope.

**Method:** every claim below was checked against the current tree via direct source reads, `rg`/`Get-Content` (text/config/JSON/docs — where graph tools are blind), and file listings. Line anchors were re-measured after recent commits (`6e4a27f` touched `run-loop.ts`; `0bd91a8` touched `drizzle.config.ts` + `trace-imports.ts` — verified via `git show --stat`; neither touched `index.ts`). No claim is marked without evidence; nothing was invented.

**File-length methodology (rev 3 correction):** file-length claims are measured with **`(Get-Content <file>).Count`** — TOTAL lines including blanks — which is the same numbering the review's "N lines" claims use and the same array numbering this plan uses for its own anchors (`_review/_arch-review.md:122/123` of 132 total). `Measure-Object -Line` counts NON-BLANK lines only and is NOT used for length claims (rev 1/2 used it and produced false "STALE" verdicts for `index.ts` and `build.ts`; both reclassified VERIFIED in this revision). Sanity check: `_review/_arch-review.md` → `.Count` = 132, `Measure-Object -Line` = 98.

**Precedent reference:** `_plan/fix-code-review-findings-2026-09-22.md` (structure: verified-code → outcome → action) and `_review/CODE_REVIEW.md` (integrity notice + dated correction blocks under each affected finding; verified block format `> **Correction (2026-09-22) — …**`, `_review/CODE_REVIEW.md:71`).

**Verdict rules (applied consistently):**
- VERIFIED / STALE (was true, anchor or value moved) / INACCURATE (wrong against current tree) / OBSERVATIONAL (true as observed, not a hard contract) / UNRESOLVED.
- **Anchor-drift rule:** a line-number drift within the SAME file of ≤2 lines → VERIFIED with a current-anchor note; a wrong-file or nonexistent anchor → INACCURATE. Applied uniformly (e.g. `sync/AGENTS.md:29` → heading now `:30`, same file, 1-line drift → VERIFIED with note; `AGENTS.md:137` for the event-version rejection → wrong file entirely → INACCURATE).
- **Approximation rule:** a claim the review itself hedges with "~" is VERIFIED (approx) when the measured value falls within a trivially small delta of the hedged figure; a correction block for such a delta would be noise.
- Correction blocks are appended ONLY for STALE / INACCURATE claims. VERIFIED-with-anchor-note items get no-op notes (§ "No-op notes" below), not correction blocks.

---

## Verification table

**Verdict counts:** VERIFIED **56** · STALE **4** · INACCURATE **8** · OBSERVATIONAL **1** · UNRESOLVED **0** = **69** claims.

### §1 At a Glance

| § | Claim (short) | Verdict | Evidence |
|---|---|---|---|
| 1 | Bun 1.3.14 workspace, Effect beta, SolidJS, Drizzle/SQLite | VERIFIED | root `package.json` catalog; `packages/opencode/package.json` deps |
| 1 | Event-sourced state (SyncEvent), V2 read-model split | VERIFIED | `sync/AGENTS.md:5-13`, `v2/AGENTS.md` |
| 1 | Effect `HttpApi` + Schema → HTTP/OpenAPI/SDK | VERIFIED | `api.ts:54-59`, `packages/sdk/js/script/build.ts:10-16` |
| 1 | "~736 files in `opencode/src`" | VERIFIED (approx) | actual **740** files (`Get-ChildItem -Recurse -File` count). The review's own "~" hedge covers a 4-file delta; per the approximation rule no correction is warranted |

### §2 Architecture

| § | Claim (short) | Verdict | Evidence |
|---|---|---|---|
| 2 | `src/index.ts` 258 lines | VERIFIED | `(Get-Content packages/opencode/src/index.ts).Count` = **258** (total lines, blanks included) — matches the review exactly. Neither `6e4a27f` nor `0bd91a8` touched `index.ts` (`git show --stat`) |
| 2 | pure yargs, commands Run/Generate/Console/Providers/Agent | VERIFIED | `index.ts:2-3,78`, command imports at top of file |
| 2 | `EventEmitter.defaultMaxListeners = 100` | VERIFIED | `index.ts:1,50` |
| 2 | `bin` = `./bin/opencode` | VERIFIED | `packages/opencode/package.json:20-21` |
| 2 | `HttpApi.make("opencode")` at `api.ts:54` | VERIFIED | `server/routes/instance/httpapi/api.ts:54` (`OpenCodeHttpApi`) |
| 2 | `.middleware(SchemaErrorMiddleware)` | VERIFIED | `api.ts:33,52` (import `:24`) |
| 2 | `HttpApi.AdditionalSchemas` | VERIFIED | `api.ts:59` |
| 2 | group/handler split at `httpapi/AGENTS.md:44` | VERIFIED | `AGENTS.md:43-44` ("groups/<resource>.ts" / "handlers/<resource>.ts") |
| 2 | `HttpApiEndpoint` declarations + `.handle("name", fn)` | VERIFIED | `httpapi/AGENTS.md:43` (`HttpApiEndpoint.post(...)`), `:44` (`.handle("name", handlerFn)`), `:10` (`handlers.handle("list", ...)`) |
| 2 | `run-loop.ts:73` ~279-290-line `Effect.fn("SessionPrompt.run")` `while(true)` | **STALE (anchor)** | after commit `6e4a27f`: `Effect.fn` at **`run-loop.ts:88-90`**, `while (true)` at **`:97`**. File total = **384** lines (`(Get-Content).Count`); the fn body (~88→384, ≈295 lines) is within the review's "~279-290" hedge — the drift is the `:73` anchor, not the length |
| 2 | helpers under `session/loop/*` (command, model, predict, subtask, title, reminders) | VERIFIED | dir listing: `command.ts, model.ts, predict.ts, subtask.ts, title.ts, reminders.ts` (+ also `create-user-message.ts, shell.ts, tools.ts` — list incomplete but not wrong) |
| 2 | deps injected (`RunLoopDeps`) | VERIFIED | `run-loop.ts:47` (`export interface RunLoopDeps`), `:88,90` |
| 2 | domains = 17 listed (`account…v2`) | **INACCURATE** | `src/` has **41** dirs (plain and `-Force` counts agree); the 17-item list omits 24: `auth, command, config, env, file, format, git, id, ide, image, installation, lsp, patch, plugin, provider, pty, question, reference, search, server, share, shell, skill, worktree` |
| 2 | "Every domain ships an `AGENTS.md`" | **INACCURATE** | only **18 of 41** dirs have one (`acp, agent, cli, lsp, mcp, permission, plugin, provider, search, server, session, share, skill, snapshot, storage, sync, tool, v2`) |
| 2 | "`run` rejects old event versions (`AGENTS.md:137`)" | **INACCURATE (anchor)** | behavior real but lives in **`sync/index.ts:137-138`** (`SyncEvent.run: running old versions of events is not allowed`); `sync/AGENTS.md` is **32** lines total (`(Get-Content).Count`) — the cited `AGENTS.md:137` anchor does not exist (wrong-file anchor → INACCURATE per the anchor-drift rule) |
| 2 | risk: group↔handler mismatches fail at runtime, not typecheck | VERIFIED | `httpapi/AGENTS.md:44` (verbatim) |
| 2 | risk: plugin hooks via `(hook as any)` | VERIFIED | `plugin/index.ts:239,255,276`; `mcp/index.ts:169` |
| 2 | strength: `test:httpapi` coverage gate | VERIFIED | `packages/opencode/package.json:12` (coverage/auth/effect modes, `--fail-on-missing --fail-on-skip`) |
| 2 | No `StateFlow`/`Behavior`/`Store` symbol exists | VERIFIED | `rg "StateFlow|Behavior"` over `packages/opencode/src` → zero symbol hits (only prose in `command/template/review.txt:60` and `skill/AGENTS.md:48`) |
| 2 | state via SyncEvent engine (`define`/`project`/`registry`/`replay` in `sync/index.ts`) | VERIFIED | `sync/index.ts:230` (`define`), `:261` (`project`), `:193` (`registry`), `:362,366` (`replay`/`replayAll`) |
| 2 | `data` is `DeepMutable` — projectors mutate persisted shapes | VERIFIED | `agent/agent.ts:56`, `config/config.ts:348,356`, `sync/index.ts:40` (`DeepMutable` from `@opencode-ai/core/schema`) |
| 2 | extension surface: typed `packages/plugin` | VERIFIED | `packages/plugin/` exists (`src/`, `script/`, own `package.json`) |

### §3 Data Layer & Storage

| § | Claim (short) | Verdict | Evidence |
|---|---|---|---|
| 3 | table files `session.sql.ts` (Session/Message/Part/Todo/SessionMessage), `project.sql.ts`, `account.sql.ts`, `workspace.sql.ts`, `sync/event.sql.ts`, `share/share.sql.ts` | VERIFIED | all exist; `workspace.sql.ts` is at **`control-plane/workspace.sql.ts`** (path note); `session.sql.ts` also has `PermissionTable` (`:130`) |
| 3 | snake_case columns + `id: text().$type<SessionID>()` | VERIFIED | `session.sql.ts:19,25,65,82,96,116` |
| 3 | JSON columns `text({ mode: "json" })` | VERIFIED | `session.sql.ts:35,36,42,44,69,84,121,135`; `project.sql.ts:15-16` |
| 3 | dual migration build (Bun file-based + Node `OPENCODE_MIGRATIONS`) | VERIFIED | `storage/db.ts:19,105-111` (`mode: "bundled" : "dev"`) |
| 3 | `Database.Client` lazy at `storage/db.ts:91` | VERIFIED | `db.ts:91` (`export const Client = lazy(...)`) |
| 3 | `core/global.ts:16-30` XDG paths, auto-created | VERIFIED | `packages/core/src/global.ts` — `Path` object `:18-27`, `mkdir` block `:35-40` (path note: file is in `packages/core`, not `opencode/src`) |
| 3 | DB at `Global.Path.data/opencode.db` | VERIFIED | `storage/db.ts:32` |
| 3 | config search `opencode.jsonc/.json/config.json` (`config.ts:383`) | VERIFIED | `config/config.ts:383` |
| 3 | `$schema` injection (`config.ts:454`) | VERIFIED | `config.ts:453-455` |
| 3 | SDK `script/build.ts` runs `bun dev generate > openapi.json` → **orval** | **INACCURATE** | generator step real (`build.ts:14`) but the client generator is **`@hey-api/openapi-ts`** (`build.ts:10` import, `createClient` call at `:16`, plugins `@hey-api/typescript` `:25`, `@hey-api/sdk` `:29`, `@hey-api/client-fetch` `:36`); zero `orval` references in `packages/sdk/js` |
| 3 | root re-exports only v2 | VERIFIED | `packages/sdk/js/package.json` exports map (`.`, `./v2`, `./v2/gen/client`, `./v2/legacy`, …) |
| 3 | v1 (`src/gen/`) is frozen/stale | **STALE** | `src/gen/` **does not exist** — legacy v1 generation was REMOVED during SDK consolidation; `src/` = `v2/`, `error-interceptor.ts`, `index.ts`, `process.ts` |
| 3 | sync envelope `{ type: "sync", syncEvent }` with `.1` suffix (`sync/index.ts:327`) | VERIFIED | envelope emit `sync/index.ts:344-356`; `versionedType` overloads/impl `:224-226` → `` `${type}.${version}` ``; `sync/AGENTS.md:5` cites range `327-356` |
| 3 | risk: non-portable drizzle config hardcoded `/home/thdxr/...` (`drizzle.config.ts:8`) | **STALE** | fixed by commit `0bd91a8`: current `drizzle.config.ts` uses `process.env.OPENCODE_DB_PATH ?? path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")` |
| 3 | risk: migration build-path divergence (disk vs embedded) | VERIFIED | `db.ts:105-107` — two sources still selected at runtime |
| 3 | risk: lazy singleton leaks across tests | VERIFIED | `db.ts:91` in-process lazy global; consistent with documented order-dependent test failures |
| 3 | risk: subagent sessions persist indefinitely (`agent/AGENTS.md:42`) | VERIFIED | `agent/AGENTS.md:40-42` (exact line 42) |
| 3 | risk: generated SDK fragile, string patches (`js/AGENTS.md:25`) | VERIFIED | `packages/sdk/js/AGENTS.md:25` (exact) |
| 3 | risk: `SyncEvent.run` bypasses Effect services (`sync/AGENTS.md:29`) | VERIFIED | heading now at `sync/AGENTS.md:30` (same-file 1-line drift → VERIFIED with note per anchor-drift rule), body `:32`; file total = **32** lines (`(Get-Content).Count`) |

### §4 Frontend / Web

| § | Claim (short) | Verdict | Evidence |
|---|---|---|---|
| 4 | app = SolidJS SPA (Vite + `vite-plugin-solid` + Tailwind v4) | VERIFIED | `packages/app/package.json:31,40,75` |
| 4 | provider chain `QueryProvider → GlobalSDKProvider → GlobalSyncProvider → ServerProvider+ConnectionGate` | **INACCURATE (order)** | actual nesting is the reverse: `ServerProvider` (`app.tsx:303`) → `ConnectionGate` (`:308`) → `QueryProvider` (`:310`) → `GlobalSDKProvider` (`:311`) → `GlobalSyncProvider` (`:312`) — Server/Connection are the OUTERMOST layers |
| 4 | router scoped by `:dir` → `/:dir/session/:id?` | VERIFIED | `app.tsx:318-320` |
| 4 | `global-sync/event-reducer.ts` switch on `event.*` | VERIFIED | actual path `packages/app/src/context/global-sync/event-reducer.ts` (+ co-located `.test.ts`) — anchor path note (see No-op note N1) |
| 4 | ui: Kobalte, Storybook co-located, virtualized lists, i18n | VERIFIED | `@kobalte/core` (`ui/package.json:47`); `*.stories.tsx` co-located in `ui/src/components/` + root `dev:storybook` → `packages/storybook`; i18n = **17** locale files in `ui/src/i18n/` |
| 4 | web = Astro/Starlight | VERIFIED | `packages/web/package.json:7-16` (`@astrojs/starlight 0.41.7`) |
| 4 | bun-test + `happydom` preload, no Vitest | VERIFIED | `app/package.json:18-20` (`--preload ./happydom.ts`); zero `vitest` refs in app/opencode/ui package.json |
| 4 | Playwright Chromium-only | VERIFIED | `app/playwright.config.ts:44-46` (single `chromium` project) |
| 4 | "67 app unit specs" | **STALE (minor)** | now **68** test files in `packages/app/src` (`Get-ChildItem -Recurse -Include *.test.ts,*.test.tsx`) |
| 4 | UI + app both at `1.14.48` | VERIFIED | both `package.json:3` |
| 4 | risk: i18n parity weak across 17 locales | VERIFIED | 17 locale files confirmed (`ar…zht`) |

### §5 Cross-Cutting

| § | Claim (short) | Verdict | Evidence |
|---|---|---|---|
| 5 | `script/build.ts` 437 lines | VERIFIED | `(Get-Content packages/opencode/script/build.ts).Count` = **437** (total lines, blanks included) — matches the review exactly |
| 5 | embeds WASM/native/migrations, strict assertions | VERIFIED | `build.ts` (tree-sitter wasm inlined as bytes, `libopentui`, migrations; consistent with root AGENTS.md Known Issues) |
| 5 | `patchedDependencies`: solid-js, `@opentui/core`, photon-node, npmcli agent | VERIFIED | root `package.json` — all 4 present, plus `@standard-community/standard-openapi@0.2.9` (5 entries total; omission noted in No-op note N2 — incompleteness, not falsity) |
| 5 | Turbo v2 | VERIFIED | `turbo.json` `$schema: v2-10-12` |
| 5 | `typecheck` uncached-freeflow | OBSERVATIONAL | `"typecheck": {}` in `turbo.json` — no outputs declared; caching semantics not further verifiable from config alone |
| 5 | all `test*` depend on `^build` | **INACCURATE** | `turbo.json:20,29,38` special-case `opencode#test:ci`, `@opencode-ai/app#test:ci`, `@opencode-ai/ui#test:ci` with `dependsOn: ["^build"]`, and the package-scoped `#test` tasks likewise — BUT the generic `"test:ci"` at `turbo.json:16` has **no `dependsOn`**, and `packages/core/package.json:10` defines `test:ci` with no package-scoped override → `@opencode-ai/core#test:ci` runs WITHOUT `^build` |
| 5 | "`build` task has no `dependsOn`" | **INACCURATE (phrasing)** | `turbo.json` declares `"build": { "dependsOn": [] }` — an explicit EMPTY array, not a missing key. Substance holds (no upstream deps → stale-build risk real) |
| 5 | ~310 tests in `opencode`, 24 in `core`, 67 in app | VERIFIED (approx; unit note) — EXCEPT the unhedged "67 in app" | the review's "~310 **tests**" vs measured **316 test FILES** in `packages/opencode/test` is a unit mismatch (test cases number ~2929 via `rg -o "^\s*(test|it)\("`); file breakdown confirmed: **310 `.test.ts` + 6 `.test.tsx` = 316**; core = **24** files (180 cases); app = **68** files (495 cases via the same `rg` pattern). The hedged "~310" and confirmed "24" fall under the approximation rule (no block); the UNHEDGED "67 in app" is stale (68) and is corrected via **E10 at `_review/_arch-review.md:100`** (same block also covers the `:76` instance) |
| 5 | "SDK/JS has zero unit tests — a gap" | **INACCURATE (framing)** | literally true for `packages/sdk/js` (no `test/` dir, 0 `test(` occurrences) — but SDK behavior tests live in **`packages/opencode/test/server/`** (root AGENTS.md rule; dir exists with `httpapi-*.test.ts`, `routes/`, etc.). The externally-consumed surface IS tested; the gap is location, not absence |
| 5 | `as any` count = 67 (opencode 29, ui 33, core 5) | VERIFIED | `rg -o "as any"` → 29 + 33 + 5 = 67 |
| 5 | no `constantTimeEqual` exists | VERIFIED | zero matches across `packages/` |
| 5 | CLI built with `--use-system-ca` | VERIFIED | `script/build.ts:366` |
| 5 | risk: order-dependent test failures | VERIFIED | documented in root AGENTS.md Known Issues (mock leakage, ScopedCache, flaky permission tests) |

### §6 Recommendations — validity after corrections

| # | Recommendation | Status | Reason |
|---|---|---|---|
| 1 | Test isolation hardening | **VALID** | order-dependent failures + lazy `Database.Client` singleton confirmed |
| 2 | Portability (drizzle config + migration paths) | **DOWNGRADE — partially done** | drizzle config fixed by `0bd91a8` (`OPENCODE_DB_PATH` + `os.homedir()`); only the Bun/Node migration-path divergence remains |
| 3 | SDK test coverage | **DOWNGRADE — reframe** | SDK behavior tests already exist in `packages/opencode/test/server/`; the actionable item is relocating/adding tests closer to `packages/sdk/js`, not creating coverage from zero |
| 4 | Add local `constantTimeEqual` | **VALID** | confirmed absent |
| 5 | Type hygiene (67 `as any`, reflective hooks) | **VALID** | counts confirmed; `plugin/index.ts:239,255,276`, `mcp/index.ts:169` |
| 6 | Sync refactor through `SyncEvent.Service` | **VALID** | `sync/AGENTS.md:30-32` confirms bypass |
| 7 | Subagent session lifecycle cleanup | **VALID** | `agent/AGENTS.md:42` confirms indefinite persistence |
| 8 | E2E breadth (multi-browser) | **VALID** | single Chromium project confirmed |

---

## Exact edit specs for `_review/_arch-review.md` (Code stage)

All blocks use the verified precedent string from `_review/CODE_REVIEW.md:71`: `> **Correction (2026-09-22) — <summary>**`. For each item: KEEP the original sentence at the cited `_review/_arch-review.md` line, append the dated correction block directly under it. Do not rewrite review conclusions.

**E1 — DELETED (rev 3).** The rev-2 E1 block ("index.ts is now 242 lines") was a FALSE correction produced by the non-blank `Measure-Object -Line` methodology. `(Get-Content packages/opencode/src/index.ts).Count` = **258**, matching the review's claim exactly, and neither `6e4a27f` nor `0bd91a8` touched `index.ts`. The §2 row is VERIFIED; nothing is appended to `_review/_arch-review.md` for it.

**E2 — `_review/_arch-review.md:25` (§2, run-loop bullet; anchor moved by `6e4a27f`).** Append:

```markdown
> **Correction (2026-09-22) — run-loop anchor moved.**
> After commit `6e4a27f`, `runLoop` (`Effect.fn("SessionPrompt.run")`) starts at
> `run-loop.ts:88-90` with `while (true)` at `:97`; the file is now 384 lines
> (total, per `(Get-Content).Count`). The fn body (~88→384, ≈295 lines) remains
> within the review's "~279-290" hedge — the drift is the `:73` anchor, not the
> length. Helper-module list and `RunLoopDeps` (`run-loop.ts:47`) verified
> current; the dir also contains `create-user-message.ts`, `shell.ts`,
> `tools.ts`.
```

**E3 — `_review/_arch-review.md:26` (§2, topology bullet; domain list + AGENTS.md claim).** Append:

```markdown
> **Correction (2026-09-22) — domain list incomplete; AGENTS.md coverage overstated.**
> `packages/opencode/src` contains **41** domain dirs, not the 17 listed
> (omitted: `auth`, `command`, `config`, `env`, `file`, `format`, `git`, `id`,
> `ide`, `image`, `installation`, `lsp`, `patch`, `plugin`, `provider`, `pty`,
> `question`, `reference`, `search`, `server`, `share`, `shell`, `skill`,
> `worktree`). Only **18 of 41** ship an `AGENTS.md` — "every domain" is not
> accurate.
```

**E4 — `_review/_arch-review.md:35` (§2, event-schema-evolution risk; wrong-file anchor).** Append:

```markdown
> **Correction (2026-09-22) — anchor cites the wrong file.**
> The rejection is real but lives at `sync/index.ts:137-138` (`SyncEvent.run:
> running old versions of events is not allowed`), not `AGENTS.md:137`
> (`sync/AGENTS.md` is 32 lines total, so line 137 cannot exist there). The
> no-backfill observation stands.
```

**E5 — `_review/_arch-review.md:51` (§3, SDK-client bullet; orval claim).** Append:

```markdown
> **Correction (2026-09-22) — the generator is @hey-api/openapi-ts, not orval.**
> `packages/sdk/js/script/build.ts:10` imports `createClient` from
> `@hey-api/openapi-ts`; the call is at `build.ts:16` with plugins
> `@hey-api/typescript` (`:25`), `@hey-api/sdk` (`:29`), `@hey-api/client-fetch`
> (`:36`). The `bun dev generate > openapi.json` step is verified (`build.ts:14`).
> Zero `orval` references exist in `packages/sdk/js`.
```

**E6 — `_review/_arch-review.md:51` (§3, same bullet; v1 frozen/stale claim).** Append:

```markdown
> **Correction (2026-09-22) — v1 was removed, not frozen.**
> `src/gen/` does not exist: the legacy v1 generation was REMOVED during SDK
> consolidation. `packages/sdk/js/src/` now contains only `v2/`,
> `error-interceptor.ts`, `index.ts`, `process.ts`; the root export re-exports v2.
```

**E7 — `_review/_arch-review.md:60` (§3, non-portable drizzle risk; fixed by `0bd91a8`).** Append:

```markdown
> **Correction (2026-09-22) — risk voided by commit 0bd91a8.**
> `drizzle.config.ts` now resolves
> `url: process.env.OPENCODE_DB_PATH ?? path.join(os.homedir(), ".local",
> "share", "opencode", "opencode.db")` — no hardcoded `/home/thdxr` path
> remains. The Bun/Node migration-path divergence (next risk) is unaffected.
```

**E8 — `_review/_arch-review.md:72` (§4, app bullet; provider chain order).** Append:

```markdown
> **Correction (2026-09-22) — provider nesting is the reverse of the stated order.**
> `ServerProvider` (`app.tsx:303`) is outermost, wrapping `ConnectionGate`
> (`:308`) → `QueryProvider` (`:310`) → `GlobalSDKProvider` (`:311`) →
> `GlobalSyncProvider` (`:312`). Router `:dir` scoping verified
> (`app.tsx:318-320`).
```

**E9 — `_review/_arch-review.md:98` (§5, orchestration paragraph; "all `test*` depend on `^build`").** Append:

```markdown
> **Correction (2026-09-22) — not all test tasks depend on ^build.**
> `turbo.json` special-cases `opencode#test:ci` (`:20`), `@opencode-ai/app#test:ci`
> (`:29`), `@opencode-ai/ui#test:ci` (`:38`) — and the package-scoped `#test`
> tasks — with `dependsOn: ["^build"]`. But the generic `"test:ci"` task
> (`turbo.json:16`) has NO `dependsOn`, and `packages/core/package.json:10`
> defines `test:ci` with no package-scoped override — so
> `@opencode-ai/core#test:ci` runs without `^build`.
```

**E10 — `_review/_arch-review.md:76` AND `_review/_arch-review.md:100` (§4 testing bullet + §5 testing-scale paragraph; the SAME unhedged "67 app" figure appears in both).** Append under EACH line:

At `_review/_arch-review.md:76`:

```markdown
> **Correction (2026-09-22) — app spec count drifted.**
> App unit tests are now **68 test files** in `packages/app/src` (was 67).
> bun-test + `happydom` preload and Chromium-only Playwright verified current.
```

At `_review/_arch-review.md:100`:

```markdown
> **Correction (2026-09-22) — app test-file count drifted.**
> The "67 in app" figure is now **68 test files** in `packages/app/src`. The
> hedged "~310 tests in `opencode`" tracks test FILES (316 = 310 `.test.ts` +
> 6 `.test.tsx`; ~2929 test cases) and "24 in `core`" is confirmed (24 files).
```

Rationale for the split ruling: the "~310" figure is hedged by the review itself (approximation rule → VERIFIED approx, no block), but "67 in app" is UNHEDGED in both places and both instances are stale (68 measured) — so both get the same E10 correction. The §5 row's VERIFIED (approx) verdict applies to the hedged opencode/core figures; the unhedged app figure is corrected via E10 at both locations.

**E11 — DELETED (rev 3).** The rev-2 E11 block ("`script/build.ts` is now 404 lines") was a FALSE correction from the same non-blank-count methodology. `(Get-Content packages/opencode/script/build.ts).Count` = **437**, matching the review's claim exactly. The §5 row is VERIFIED; nothing is appended to `_review/_arch-review.md` for it.

**E12 — `_review/_arch-review.md:114` (§5 **Risks** bullet: "`build` task has no `dependsOn` in `turbo.json` → risk of stale upstream builds").** NOTE: this is a DISTINCT risk bullet, NOT the orchestration paragraph at `:98` (which carries E9's `test*`→`^build` correction). Append under `:114` only:

```markdown
> **Correction (2026-09-22) — dependsOn is explicitly empty, not absent.**
> `turbo.json` declares `"build": { "dependsOn": [] }` (`turbo.json:7-8`) — an
> explicit empty array rather than a missing key. The substance (no upstream
> deps → stale-build risk) holds.
```

**E13 — `_review/_arch-review.md:100` (§5, testing-scale paragraph; SDK zero-tests framing).** Append:

```markdown
> **Correction (2026-09-22) — SDK tests exist, but in another package.**
> `packages/sdk/js` has no test directory (verified: zero `test(` occurrences),
> but SDK behavior tests are NOT absent — they live in
> `packages/opencode/test/server/` per repo convention (root AGENTS.md; dir
> contains `httpapi-*.test.ts`, `routes/`, …). The gap is test
> location/proximity, not missing coverage of the consumed surface.
```

**E14 — §6 recommendation adjustments.** Under `_review/_arch-review.md:122` (recommendation 2), append:

```markdown
> **Downgraded (2026-09-22) — partially done.**
> `drizzle.config.ts` portability fixed by `0bd91a8` (`OPENCODE_DB_PATH` env +
> `os.homedir()` fallback). Remaining scope: unify the Bun/Node migration build
> paths (`storage/db.ts:105-107`).
```

Under `_review/_arch-review.md:123` (recommendation 3), append:

```markdown
> **Downgraded (2026-09-22) — reframed.**
> SDK behavior tests already exist at `packages/opencode/test/server/` (repo
> convention). The actionable item is moving/adding tests adjacent to
> `packages/sdk/js`, not creating coverage from zero.
```

Recommendations 1, 4, 5, 6, 7, 8 remain valid — no edits.

---

## No-op notes (VERIFIED items with anchor/incompleteness observations — NO correction blocks)

These are recorded here for the Code stage's awareness only; nothing is appended to `_review/_arch-review.md` for them, because the claims are accurate and correction blocks are reserved for STALE/INACCURATE items.

- **N1 (§4 event-reducer path):** actual path is `packages/app/src/context/global-sync/event-reducer.ts` (with co-located `event-reducer.test.ts`), not bare `global-sync/event-reducer.ts`. Claim verified; path shorthand only.
- **N2 (§5 patchedDependencies):** the map also includes `@standard-community/standard-openapi@0.2.9` (5 entries total). The review's 4 named entries are all present — the list is incomplete, not false.
- **N3 (§3 sync/AGENTS.md anchor):** `SyncEvent.run` bypass heading is now at `sync/AGENTS.md:30` (review cited `:29`; same-file 1-line drift per the anchor-drift rule). File total is 32 lines.
- **N4 (§3 workspace.sql.ts path):** file is at `control-plane/workspace.sql.ts`; review's bare `workspace.sql.ts` is a path shorthand.
- **N5 (§3 global.ts path):** file is at `packages/core/src/global.ts` (review's `core/global.ts` is a package-relative shorthand); XDG path lines verified.

---

## No action (verified accurate) — summary list

- `HttpApi.make("opencode")` at `api.ts:54`; `SchemaErrorMiddleware`; `AdditionalSchemas`; group/handler split + runtime-mismatch risk (`httpapi/AGENTS.md:44`); `HttpApiEndpoint` + `.handle("name", fn)` (`httpapi/AGENTS.md:43-44,10`)
- `EventEmitter.defaultMaxListeners = 100`; yargs; `bin` field; `index.ts` = 258 total lines; no `StateFlow`/`Behavior`/`Store` symbol; SyncEvent engine members (`sync/index.ts:193,230,261,362`); `data` is `DeepMutable` (`agent.ts:56`, `config.ts:348`); `packages/plugin` exists
- snake_case columns, `$type<SessionID>()` branded IDs, `text({ mode: "json" })`, all six `*.sql.ts` files
- dual Bun/Node migrations; `Database.Client` lazy at `db.ts:91`; `Global.Path` XDG + `opencode.db`; `config.ts:383/454`
- sync envelope + `.1` version suffix (`sync/index.ts:344-356`, `versionedType :224-226`)
- risks: migration divergence, lazy-singleton test leakage, subagent persistence (`agent/AGENTS.md:42`), SDK string patches (`js/AGENTS.md:25`), `SyncEvent.run` bypass (`sync/AGENTS.md:30`)
- app stack (Vite/solid/Tailwind v4), `:dir` router, event-reducer behavior, Kobalte/Storybook/i18n(17), Astro/Starlight, happydom, Chromium-only Playwright, `1.14.48` versions
- Turbo v2, `script/build.ts` = 437 total lines, test scale (approx; 316 opencode test files = 310 `.test.ts` + 6 `.test.tsx`, 24 core), `as any` = 67 (29/33/5), no `constantTimeEqual`, `--use-system-ca` (`build.ts:366`), `test:httpapi` gate

---

## Ordered steps for the Code stage

1. **Step 1:** Apply edits E2–E9 and E11–E13 to `_review/_arch-review.md` at the cited lines (append-only correction blocks; never delete or rewrite original sentences). E1 and E11 are DELETED — no block for them. E9 appends under `:98` (orchestration paragraph) ONLY; E12 appends under `:114` (the `build`-dependsOn risk bullet) ONLY — they are different locations. E10 appends under BOTH `:76` and `:100` (the same unhedged "67 app" figure appears in both). Apply the two §6 downgrade blocks (E14) under `_review/_arch-review.md:122` and `:123`. Apply NO block for the No-op notes N1–N5.
2. **Step 2:** Re-read the modified file top-to-bottom; confirm every `> **Correction (2026-09-22) —` block sits directly under its cited `_review/_arch-review.md` line and cites `file:line` evidence exactly as specified above.
3. **Step 3:** Verification commands (no package builds needed — docs only):
   - `git status --short` → expect AT MINIMUM `?? _review/_arch-review.md` and `?? _plan/verify-arch-review-2026-09-22.md`; pre-existing untracked files (e.g. `?? .zcodeignore`) may also appear and are NOT part of this change — do not stage them.
   - Spot re-check anchors cited in corrections: `rg -n "hey-api" packages/sdk/js/script/build.ts`, `rg -n "OPENCODE_DB_PATH" packages/opencode/drizzle.config.ts`, `rg -n "Effect.fn" packages/opencode/src/session/loop/run-loop.ts`, `rg -n "ServerProvider|ConnectionGate|QueryProvider" packages/app/src/app.tsx`, `rg -n '"test:ci"' turbo.json packages/core/package.json`, `(Get-Content packages/opencode/src/index.ts).Count`, `(Get-Content packages/opencode/script/build.ts).Count`.
4. **Step 4:** No typecheck/test runs required (no source changes). Do NOT run tests from repo root (repo guard).
5. **Step 5:** Commit BOTH `_review/_arch-review.md` and this plan file together (stage them explicitly; leave pre-existing untracked files like `.zcodeignore` unstaged). `_review/_arch-review.md` is UNTRACKED — an uncommitted correction would not persist (same rationale as the `_review/CODE_REVIEW.md` precedent in `_plan/fix-code-review-findings-2026-09-22.md`, Finding 2 action).

## Scope note

- Only `_review/_arch-review.md` (corrections) and this plan file change. **No source files are edited.**
- `_review/_arch-review.md` is currently UNTRACKED (`?? _review/_arch-review.md`); it MUST be committed WITH the corrections so they persist.
- Repo style: no semicolons, 120 printWidth — applies to any prose wrapping in the correction blocks.
