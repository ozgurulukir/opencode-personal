# Architectural Review — opencode-personal (Bun monorepo)

*Dispatched 4 parallel research agents: Architecture, Data/Storage, Frontend, Cross-cutting.*

---

## 1. At a Glance

| Dimension | Verdict |
|---|---|
| Overall shape | Large but **decomposed monolith** (~736 files in `opencode/src`) with strong per-domain boundaries (`AGENTS.md` culture) |
| Core language/runtime | **Bun** 1.3.14 workspace; Effect 4.0.0-beta; SolidJS for UI; Drizzle/SQLite |
| State model | **Event-sourced** (SyncEvent + event log), NOT a classic Store/Behavior. V2 separates read-model from write-engine |
| API contract | **Effect `HttpApi` + Schema** single-source-of-truth → HTTP, OpenAPI, and generated SDK |
| Extension surface | Typed `packages/plugin`, Effect `Context` services, reflective plugin hooks |

---

## 2. Architecture (core CLI/server)

### Findings
- **Composition root**: `src/index.ts` (258 lines) is pure `yargs` — commands (`Run`, `Generate`, `Console`, `Providers`, `Agent`, …), error handlers, `EventEmitter.defaultMaxListeners = 100`. `bin` = `./bin/opencode`.
- **HTTP API**: `HttpApi.make("opencode")` in `server/routes/instance/httpapi/api.ts:54` composes a registry of groups (`.addHttpApi(...)`) with `.middleware(SchemaErrorMiddleware)`, `HttpApi.AdditionalSchemas`. Endpoints declared via `HttpApiEndpoint`, `.handle("name", fn)`. Handlers split into *group* vs *handler* files (`httpapi/AGENTS.md:44`).
- **State**: No `StateFlow`/`Behavior`/`Store` symbol exists. State is **event-sourced** via `SyncEvent` engine (`define`/`project`/`registry`/`replay` in `sync/index.ts`). `data` is `DeepMutable` — projectors mutate persisted shapes.
- **Run loop**: `run-loop.ts:73` (~279-290 line `Effect.fn("SessionPrompt.run")` `while(true)`). Decomposed into sibling helpers under `session/loop/*` (`command`, `model`, `predict`, `subtask`, `title`, `reminders`). All deps injected (`RunLoopDeps`).

> **Correction (2026-09-22) — run-loop anchor moved.**
> After commit `6e4a27f`, `runLoop` (`Effect.fn("SessionPrompt.run")`) starts at
> `run-loop.ts:88-90` with `while (true)` at `:97`; the file is now 384 lines
> (total, per `(Get-Content).Count`). The fn body (~88→384, ≈295 lines) remains
> within the review's "~279-290" hedge — the drift is the `:73` anchor, not the
> length. Helper-module list and `RunLoopDeps` (`run-loop.ts:47`) verified
> current; the dir also contains `create-user-message.ts`, `shell.ts`,
> `tools.ts`.

- **Topology**: domains = `account, acp, agent, bus, cli, control-plane, effect, mcp, permission, project, session, snapshot, storage, sync, tool, util, v2`. Every domain ships an `AGENTS.md` documenting invariants.

> **Correction (2026-09-22) — domain list incomplete; AGENTS.md coverage overstated.**
> `packages/opencode/src` contains **41** domain dirs, not the 17 listed
> (omitted: `auth`, `command`, `config`, `env`, `file`, `format`, `git`, `id`,
> `ide`, `image`, `installation`, `lsp`, `patch`, `plugin`, `provider`, `pty`,
> `question`, `reference`, `search`, `server`, `share`, `shell`, `skill`,
> `worktree`). Only **18 of 41** ship an `AGENTS.md` — "every domain" is not
> accurate.

**Strengths**
- End-to-end type safety on the HTTP layer; a dedicated `test:httpapi` coverage gate enforces it.
- Rigorous durability model — `SyncEvent` sequenced, versioned, transactional, idempotent; clean `Event` (persisted) vs `Properties` (reactive).
- Heavy dependency injection → testable; clear per-domain seams.

**Risks**
- **Group↔handler name mismatches fail at runtime, not typecheck.**
- **Rigid event schema evolution** — `run` rejects old event versions (`AGENTS.md:137`); no backfill/migration path.

> **Correction (2026-09-22) — anchor cites the wrong file.**
> The rejection is real but lives at `sync/index.ts:137-138` (`SyncEvent.run:
> running old versions of events is not allowed`), not `AGENTS.md:137`
> (`sync/AGENTS.md` is 32 lines total, so line 137 cannot exist there). The
> no-backfill observation stands.

- **Reflection breaks typing** — plugin hooks invoked via `(hook as any)` in `plugin/index.ts` (+ `mcp/index.ts`).
- **`data` is `DeepMutable`** — read/write integrity depends on discipline inside each projector.
- Large monolith: root `SessionApi` group + 290+ line run-loop body are hotspots.

---

## 3. Data Layer & Storage

### Findings
- **ORM**: Drizzle over `bun:sqlite`. Tables in explicit `*.sql.ts` files — `session.sql.ts` (Session/Message/Part/Todo/SessionMessage), `project.sql.ts`, `account.sql.ts`, `workspace.sql.ts`, `sync/event.sql.ts`, `share/share.sql.ts`.
- **Convention**: snake_case **columns** (`project_id`, `share_url`) + branded camelCase **IDs** via `id: text().$type<SessionID>()`. JSON columns use `text({ mode: "json" })`.
- **Migrations**: Bun-native (file-based one-time) + Node (compiled `OPENCODE_MIGRATIONS` array) — dual build.
- **Lazy DB singleton**: `Database.Client` lazy at `storage/db.ts:91`; `Database.use` falls back to global singleton outside transactions.
- **Global.Path** (`core/global.ts:16-30`): portable XDG paths (`data`, `cache`, `config`, `state`, `tmp`, `bin`, `repos`, `log`) auto-created at module load. DB at `Global.Path.data/opencode.db`.
- **Config**: searches `opencode.jsonc/.json/config.json` (`config.ts:383`); auto-migrates with `$schema` injection (`config.ts:454`).
- **SDK client** (`packages/sdk/js`): `script/build.ts` runs `bun dev generate > openapi.json` → feeds through **orval**. Root re-exports **only v2**; v1 (`src/gen/`) is frozen/stale.

> **Correction (2026-09-22) — the generator is @hey-api/openapi-ts, not orval.**
> `packages/sdk/js/script/build.ts:10` imports `createClient` from
> `@hey-api/openapi-ts`; the call is at `build.ts:16` with plugins
> `@hey-api/typescript` (`:25`), `@hey-api/sdk` (`:29`), `@hey-api/client-fetch`
> (`:36`). The `bun dev generate > openapi.json` step is verified (`build.ts:14`).
> Zero `orval` references exist in `packages/sdk/js`.

> **Correction (2026-09-22) — v1 was removed, not frozen.**
> `src/gen/` does not exist: the legacy v1 generation was REMOVED during SDK
> consolidation. `packages/sdk/js/src/` now contains only `v2/`,
> `error-interceptor.ts`, `index.ts`, `process.ts`; the root export re-exports v2.

- **Sync**: event-sourced messaging layer; every event wrapped in a `{ type: "sync", syncEvent }` envelope with `.1` version suffix (`sync/index.ts:327`). V2 is a **read model**, not an in-memory store.

**Strengths**
- Consistent, strongly-typed schema layer with `$type<T>()` branded IDs.
- Dual Bun/Node migration support; `Global.Path` centralizes portable storage.
- Clean read-model vs write-engine separation in V2.

**Risks**
- **Non-portable drizzle config** — hardcoded `/home/thdxr/.local/share/...` (`drizzle.config.ts:8`) breaks `drizzle-kit` on other machines/CI.

> **Correction (2026-09-22) — risk voided by commit 0bd91a8.**
> `drizzle.config.ts` now resolves
> `url: process.env.OPENCODE_DB_PATH ?? path.join(os.homedir(), ".local",
> "share", "opencode", "opencode.db")` — no hardcoded `/home/thdxr` path
> remains. The Bun/Node migration-path divergence (next risk) is unaffected.

- **Migration build-path divergence** — disk `migration/` vs embedded `OPENCODE_MIGRATIONS` can drift silently.
- **Lazy singleton leaks state across tests** (`Database.Client` persists in-process; `Database.use` falls back to global singleton).
- **Subagent sessions persist indefinitely** (no auto-cleanup, `agent/AGENTS.md:42`).
- **Generated SDK fragile** — fixes must be mirrored in `script/build.ts` as string patches (`js/AGENTS.md:25`).
- **`SyncEvent.run` bypasses Effect services** (`sync/AGENTS.md:29`) → harder to test/reason about.

---

## 4. Frontend / Web

### Findings
- **`packages/app`**: SolidJS SPA (Vite + `vite-plugin-solid` + Tailwind v4), **not** Astro at app level. Entry `app.tsx` composes a stacked provider chain (`QueryProvider` → `GlobalSDKProvider` → `GlobalSyncProvider` → `ServerProvider`+`ConnectionGate` → `@opencode-ai/ui` providers). Router (`@solidjs/router`) is path-param scoped by `:dir` → `/:dir/session/:id?`.

> **Correction (2026-09-22) — provider nesting is the reverse of the stated order.**
> `ServerProvider` (`app.tsx:303`) is outermost, wrapping `ConnectionGate`
> (`:308`) → `QueryProvider` (`:310`) → `GlobalSDKProvider` (`:311`) →
> `GlobalSyncProvider` (`:312`). Router `:dir` scoping verified
> (`app.tsx:318-320`).

- **State**: **Dual worlds** — web uses TanStack Query + SolidJS `createStore` + a custom event-reducer (`global-sync/event-reducer.ts` switch on `event.*`). **No shared StateFlow** with CLI; only contracts flow via generated SDK.
- **`packages/ui`**: deep, production-grade shared component library (Kobalte, Storybook co-located, full CSS design system, virtualized lists, i18n). Consumed via deep-import barrel.
- **`packages/web`**: Astro/Starlight static docs site with embedded Solid components.
- **Testing**: bun-test + `happydom` preload (no Vitest); Playwright e2e (Chromium-only, needs running backend); 67 app unit specs + UI co-located tests.

> **Correction (2026-09-22) — app spec count drifted.**
> App unit tests are now **68 test files** in `packages/app/src` (was 67).
> bun-test + `happydom` preload and Chromium-only Playwright verified current.

**Strengths**
- Clear provider layering in one composition root; minimal predictable routing.
- Mature async data layer (TanStack Query + event-reducer sync engine).
- Solid CI enforcement (turbo + husky pre-push typecheck + SDK-regen gate).

**Risks**
- **Dual state worlds** (web vs CLI) → contract drift caught only at push via SDK regen.
- **Version-lock friction** — UI + app both at `1.14.48`; UI can't release independently.
- **E2E gap** — Chromium-only, manual backend required.
- **i18n parity self-admittedly weak** — spot-check only across 17 locales.
- **`tsgo -b` `.tsbuildinfo` footgun** — stale incremental cache can mask SDK-contract errors.

---

## 5. Cross-Cutting

**Build/packaging** (`script/build.ts`, 437 lines): `bun dev generate` → `Bun.build()` (esbuild, ESM, minify, splitting, Solid plugin) → `Bun.compile` cross-compiles per os/arch, embedding WASM (tree-sitter diff inlined as bytes), native `libopentui.*`, and SQL migrations. Strict build-time WASM assertions.

**Dependency governance**: Bun `catalog` (shared versions) + `workspace:*` + `patchedDependencies` (solid-js, `@opentui/core`, photon-node, npmcli agent) + postinstall glue.

**Orchestration**: Turbo v2 — `typecheck` is uncached-freeflow; all `test*` depend on `^build`.

> **Correction (2026-09-22) — not all test tasks depend on ^build.**
> `turbo.json` special-cases `opencode#test:ci` (`:20`), `@opencode-ai/app#test:ci`
> (`:29`), `@opencode-ai/ui#test:ci` (`:38`) — and the package-scoped `#test`
> tasks — with `dependsOn: ["^build"]`. But the generic `"test:ci"` task
> (`turbo.json:16`) has NO `dependsOn`, and `packages/core/package.json:10`
> defines `test:ci` with no package-scoped override — so
> `@opencode-ai/core#test:ci` runs without `^build`.

**Testing scale**: ~310 tests in `opencode`, 24 in `core`, 67 in app. Characterization tests present + fixture harness. **SDK/JS has zero unit tests** — a gap.

> **Correction (2026-09-22) — app test-file count drifted.**
> The "67 in app" figure is now **68 test files** in `packages/app/src`. The
> hedged "~310 tests in `opencode`" tracks test FILES (316 = 310 `.test.ts` +
> 6 `.test.tsx`; ~2929 test cases) and "24 in `core`" is confirmed (24 files).

> **Correction (2026-09-22) — SDK tests exist, but in another package.**
> `packages/sdk/js` has no test directory (verified: zero `test(` occurrences),
> but SDK behavior tests are NOT absent — they live in
> `packages/opencode/test/server/` per repo convention (root AGENTS.md; dir
> contains `httpapi-*.test.ts`, `routes/`, …). The gap is test
> location/proximity, not missing coverage of the consumed surface.

**Type-checking footguns** (documented): Effect Schema cross-file identity breaks under `verbatimModuleSyntax`; conditional types in parameter positions can be skipped; tracked `as any` count = **67** (opencode 29, ui 33, core 5).

**Security**: Permission subsystem is a first-class Effect `Layer` with deny-before-allow precedence. **No `constantTimeEqual`** exists in the fork — secret comparisons lack constant-time handling (documented gap). CLI built with `--use-system-ca`.

### Strengths
- Real cross-compilation with per-os native bundling + WASM inlining + strict assertions.
- Serious test scale with transparent flakiness accounting in `AGENTS.md`.
- Strong dependency governance.

### Risks
- **Widespread order-dependent test failures** in the full suite (shared-state / global mock leakage) — likely needs isolation hardening.
- **SDK/JS under-tested** — the externally-consumed surface has no unit tests.
- **`build` task has no `dependsOn`** in `turbo.json` → risk of stale upstream builds.

> **Correction (2026-09-22) — dependsOn is explicitly empty, not absent.**
> `turbo.json` declares `"build": { "dependsOn": [] }` (`turbo.json:7-8`) — an
> explicit empty array rather than a missing key. The substance (no upstream
> deps → stale-build risk) holds.

- **`constantTimeEqual` missing** — documented secret-comparison gap.

---

## 6. Consolidated Recommendations (priority-ordered)

1. **Test isolation hardening** — highest impact. Fix shared-state / global-mock leakage so tests pass in full suite, not just in isolation. Guard `Database.Client` global singleton with per-test teardown.
2. **Portability** — make `drizzle.config.ts` path-driven via env/`Global.Path`; unify migration build paths to eliminate Bun/Node divergence.

> **Downgraded (2026-09-22) — partially done.**
> `drizzle.config.ts` portability fixed by `0bd91a8` (`OPENCODE_DB_PATH` env +
> `os.homedir()` fallback). Remaining scope: unify the Bun/Node migration build
> paths (`storage/db.ts:105-107`).

3. **SDK test coverage** — add unit tests for `packages/sdk/js` (orval output), currently the most externally-consumed surface.

> **Downgraded (2026-09-22) — reframed.**
> SDK behavior tests already exist at `packages/opencode/test/server/` (repo
> convention). The actionable item is moving/adding tests adjacent to
> `packages/sdk/js`, not creating coverage from zero.

4. **Security** — add a local `constantTimeEqual` (Bun exposes `node:crypto` `timingSafeEqual`) for API-key/secret comparisons.
5. **Type hygiene** — reduce the 67 `as any` (focus on `plugin/index.ts` + `mcp/index.ts` reflective calls); document/fix the event-schema evolution path.
6. **Sync refactor** — route `SyncEvent.run`/`replay` through `SyncEvent.Service` so they participate in Effect context and become testable.
7. **Lifecycle** — add cleanup/auto-archive for the indefinitely-persisted subagent sessions.
8. **E2E breadth** — add multi-browser Playwright projects (currently Chromium-only).

---

*Method: 4 parallel research subagents (read-only), one per architectural dimension, then synthesized. Each agent cited concrete file paths and line anchors. See per-agent transcripts for full evidence.*
