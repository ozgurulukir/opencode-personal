# Remove Upgrade / Auto-Update Feature (REWRITE — supersedes rejected 2026-09-25 draft)

## Goal

Delete all upgrade / auto-update functionality from this personal opencode fork while keeping shared infrastructure intact. **Scope wording (corrected per review):** this eliminates *upgrade* shell-outs (version check → download → replace binary), **not** all package-manager shell-outs — `Installation.method()` stays and still shells out to package managers for `opencode uninstall`.

**Corrected anchors (verified by grep/read 2026-09-26):**
- The `Installation` service lives at `packages/opencode/src/installation/index.ts` (~339 lines) — **NOT** `packages/core/src/installation.ts` (does not exist).
- `packages/core/src/installation/version.ts` exports `InstallationVersion`, `InstallationChannel`, `InstallationLocal` — shared, imported by ~15+ files (config.ts, provider.ts, session.ts, mcp/index.ts, storage/db.ts, tui/plugin/api.tsx, acp/agent.ts, plugin/loader.ts, temporary.ts, …). **KEEP untouched.**
- `Installation.method()` + `Installation.Method` are consumed by `packages/opencode/src/cli/cmd/uninstall.ts:60,90,104,144` — method detection is load-bearing for `opencode uninstall`. **KEEP.**
- Inverted truth vs. old plan: `Installation.info()` (index.ts:167-172) and the `Info` zod schema (index.ts:48-56) have **ZERO consumers** anywhere in `packages/`. `info()` internally calls `result.latest()` (removed in this change), so it cannot survive — **REMOVE `info()`, `Info` schema, `InstallationInfo` ref.** (`--version` uses `InstallationVersion` from core, not `Info`.)

## Steps

Dependency order: server/config first (so SDK regen sees the final schema), then module surgery, then consumers, then SDK regen, then typecheck/tests/gates.

### Step 1 — Server route + handler + config schema + flags

**Files:**
- `packages/opencode/src/server/routes/instance/httpapi/groups/global.ts`
  - Remove `GlobalUpgradeInput` (lines 21-23), `GlobalUpgradeResult` (25-34), `GlobalPaths.upgrade` (line 41), and the `HttpApiEndpoint.post("upgrade", GlobalPaths.upgrade, …)` endpoint (lines 94-104, incl. `identifier: "global.upgrade"`).
- `packages/opencode/src/server/routes/instance/httpapi/handlers/global.ts`
  - Remove the `installation` yield (line 72 — **only** `Installation.Service` consumer in the tree, verified), the `upgrade` fn (98-128, incl. `Installation.Event.Updated.type` at 123), the `upgradeRaw` fn (130-147), `.handleRaw("upgrade", upgradeRaw)` (155), and the now-unused imports (lines 5, 15).
  - KEEP the healthy/version path (line 76 uses `InstallationVersion` from `@opencode-ai/core/installation/version` — untouched).
- `packages/opencode/src/config/config.ts`
  - Remove `autoupdate` field (line 169).
- `packages/core/src/flag/flag.ts`
  - Remove `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_ALWAYS_NOTIFY_UPDATE` (lines 43-44).

**Post-step check:** `Installation.Service` and `Installation.defaultLayer` still have consumers (`httpapi/server.ts:196`, `app-runtime.ts:106`) — `defaultLayer` (with `CrossSpawnSpawner`) **REMAINS exported** because the module-level `Installation.method()` wrapper used by uninstall needs it (reached via `makeRuntime(Service, defaultLayer)` at index.ts:333). Do not delete either.

### Step 2 — `installation/index.ts` surgery

Apply the keep/remove table below. Order within the file: remove `Event`, response schemas (73-82), `UpgradeFailedError`, `getReleaseType`/`ReleaseType`, `latest`/`upgrade` service methods (207-…, 264-…), `info()` (167-172), `Info` schema (48-56), `Interface.latest`/`Interface.upgrade`/`Interface.info` members, module wrappers `latest` (335) and `upgrade` (337), `upgradeCurl`, `getBrewFormula`, the `run` helper (117-134 — **REMOVE**: `method()` uses `text()` at 179-185, not `run`; `run` is called only inside `upgrade()` at 271-305, so it is dead after upgrade removal), and the `NpmConfig` import (14) once `upgradeCurl` is gone. Then strip every import/local the compiler/linter reports unused (see the cascading-imports list below the table).

### Step 3 — CLI / TUI / app consumers

**CLI (delete whole files):**
- `packages/opencode/src/cli/cmd/upgrade.ts` (delete file)
- `packages/opencode/src/cli/upgrade.ts` (delete file)
- `packages/opencode/src/index.ts`: remove import `UpgradeCommand` (line 10) and `.command(UpgradeCommand)` (line 176).

**TUI:**
- `packages/opencode/src/cli/cmd/tui/worker.ts`: remove `import { upgrade } from "@/cli/upgrade"` (line 8) and the `checkUpgrade` handler (93-100). **KEEP** the `Installation` import (line 2) — `isLocal()` used at lines 31, 33.
- `packages/opencode/src/cli/cmd/tui/thread.ts`: remove `client.call("checkUpgrade", …)` (226-228).
- `packages/opencode/src/cli/cmd/tui/app.tsx`: remove the full upgrade listener (839-884: `DialogConfirm`, `skipped_version` KV, `sdk.client.global.upgrade`), the `semver` import (line 23), and the now-orphaned `DialogConfirm` import (line 51) + `DialogAlert` import (line 50). `exit()` (654) stays.
- `packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx`: remove the upgrade tip (line 117).

**`packages/app` UI (behavior-preserving — see Residual Risk):**
- `context/platform.tsx`: remove `UpdateInfo` type (10), optional `checkUpdate?` (53), `updateAndRestart?` (56).
- `pages/layout.tsx`: remove `useUpdatePolling()` (369-419) and its call site (line 540 only).
- `pages/error.tsx`: remove only the two functions `checkForUpdates`/`installUpdate` (230-255) and the check/update UI `Show` (295-310); from the `createStore` (224-228) drop the now-unused `checking`/`version` fields but **keep `actionError`** (still read at line 312).
- `components/settings-general.tsx`: remove `check()` (125-175). In `UpdatesSection` (689-736) do **NOT** delete the whole section — it contains a live non-upgrade **release-notes** row (707-717, `settings.general.releaseNotes()`, still consumed by `context/highlights.tsx:168`). Remove only the upgrade rows — startup row (694-705) and check-now row (719-733) — and keep the section with the release-notes row. **KEPT:** `const UpdatesSection` (689) and `<UpdatesSection />` (756) stay; the `<h3>` at 691 uses `settings.general.section.updates` (i18n key kept). Also note `store.checking` (settings-general.tsx:94) becomes dead after removing `check()` and the check-now row — remove the property manually (oxlint `no-unused-vars` does not flag object-literal properties).
- `context/settings.tsx`: remove `updates.startup` in THREE places — type decl (36-38), `defaultSettings` (121-123), accessor (240-245).
- i18n `en.ts`: remove only the genuinely upgrade-only keys — `toast.update.title`, `toast.update.description`, `toast.update.action.installRestart` (consumed only by the deleted code: `settings-general.tsx:145,165,166` inside `check()`, and `layout.tsx:383-387` inside the removed `useUpdatePolling`), any install/upgrade progress keys, `settings.updates.*` that are upgrade-only, `error.page.action.checkUpdates/updateTo/checking`. **Do NOT remove** `toast.update.action.notYet` (live non-upgrade consumer: `packages/app/src/pages/layout.tsx:2302`, the getting-started dismiss button; that line is kept) or `settings.general.section.updates` (live non-upgrade consumer: `packages/app/src/components/settings-general.tsx:691`, the `<h3>` heading of the retained `UpdatesSection`) — keep both keys in `en.ts` and all locales — **and mirror the removals in all 16 other locales (ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht) + `en`**. Note: `parity.test.ts` only spot-checks two unrelated keys, so it will not catch missed locales — grep is the gate.

### Step 4 — SDK regeneration (GATE — before any typecheck)

Run `./packages/sdk/js/script/build.ts` **AFTER** Steps 1-3 server/config changes, **BEFORE** `packages/app` typecheck.

Regenerated artifacts to expect (verified anchors in current `packages/sdk/openapi.json`):
- `packages/sdk/openapi.json`: `/global/upgrade` + `global.upgrade` (359-436), `installation.updated` (19093), `installation.update-available` (19117), `autoupdate` (14489) — all gone.
- `packages/sdk/js/src/v2/gen/types.gen.ts`: `GlobalUpgrade*` (3835-3868), event literals (2619, 2627), `autoupdate` (1175) — gone.
- `packages/sdk/js/src/v2/gen/sdk.gen.ts`: `GlobalUpgradeErrors/Responses` imports (66-67), `upgrade()` (570-582) — gone.

**NEVER hand-edit generated files.** Check `packages/sdk/js/script/build.ts` for upgrade-specific fixups (grep found none currently, but re-verify at execution time).

### Step 5 — Dual-package typecheck with stale tsbuildinfo clear

1. Delete stale incremental state: `packages/app/node_modules/.ts-dist/` and `packages/sdk/js/tsconfig.tsbuildinfo` (tsgo `-b` caches can mask real SDK-contract errors; turbo `--force` does NOT clear them).
2. `bun typecheck` from `packages/opencode` (never `tsc` directly).
3. `bun typecheck` from `packages/app` (SDK regen affects both packages).
4. `bun run lint` (oxlint) — `tsgo` has no `noUnusedLocals`; `.oxlintrc.json` `no-unused-vars` catches leftover imports/locals.

### Step 6 — Tests

Run from `packages/opencode` (root test script is guarded to fail). Run the **full suite** (order-dependent failures are known).

**Delete/adjust:**
- `test/installation/installation.test.ts`: **delete the whole file** (168 lines; it contains ONLY the `latest` suite — the helpers at 1-51 are used nowhere else).
- `test/installation/release-type.test.ts`: all of `getReleaseType` — delete file.
- `test/cli/tui/use-event.test.tsx`: lines 36-44 are the `update(version)` **helper**, not a test case. The only test using it is 163-176 ("delivers truly global events even when a workspace is active"). **Preferred: rewrite that test to emit a different global event** (it validates generic cross-workspace delivery, not upgrade behavior); fallback: remove 163-176 plus the 36-44 helper. Decide at execution time.
- `test/server/httpapi-exercise/index.ts:1386-1391`: `POST /global/upgrade` probe — remove.
- `test/config/config.test.ts`: remove ONLY lines 1469, 1477, 1485 and ONLY lines 2498, 2507 (the `autoupdate` keys/assertions). Do NOT delete the surrounding ranges — 1470/1478/1486 (`disabled_providers`) and 2497/2505-2506 (`server`) are non-upgrade assertions that must stay.

After each file's surgery run `bun run lint` — `tsgo` has no `noUnusedLocals`, but `.oxlintrc.json` `no-unused-vars` catches leftover imports/locals.

### Step 7 — Docs + grep gate

**Docs:**
- EN: `packages/web/src/content/docs/cli.mdx` (upgrade section 633-650 + env row 687), `config.mdx` (`### Autoupdate` heading 564 + body 566-576 — 576 is the orphaned Homebrew sentence, include it — plus lines 18, 38, 914), `plugins.mdx:157` (`installation.updated`), `troubleshooting.mdx:199`.
- TR (only variant dir — there is NO `docs.cn/`): `packages/web/src/content/docs/tr/cli.mdx` (upgrade section 520-537 + env row 573), `tr/config.mdx` (`### Autoupdate` heading + body, EN-equivalent of 564-576, plus extra `autoupdate` occurrences at lines 20, 37, 737), `tr/troubleshooting.mdx:199`, `tr/plugins.mdx:156`.
- `packages/opencode/src/skill/prompt/customize-opencode.md:45` (autoupdate mention).
- `packages/opencode/src/cli/effect-cmd.ts:46` — doc comment lists `upgrade` among effectCmd commands; remove that stale mention.

**Grep gate (must return zero matches in `packages/`):**

```powershell
rg -n "Installation\.(latest|upgrade|getReleaseType|info|Event)|InstallationInfo|getBrewFormula|GlobalUpgradeInput|GlobalUpgradeResult|upgradeRaw|installation\.(updated|update-available)|autoupdate|OPENCODE_DISABLE_AUTOUPDATE|OPENCODE_ALWAYS_NOTIFY_UPDATE|global\.upgrade|checkUpgrade|UpgradeCommand|skipped_version|checkUpdate|updateAndRestart|UpdateInfo|useUpdatePolling|toast\.update\.(title|description|action\.installRestart)|settings\.updates\.|error\.page\.action\.(checkUpdates|updateTo|checking)" packages
```

## Keep / Remove table — `packages/opencode/src/installation/index.ts`

| Symbol (line) | Action | Reason |
|---|---|---|
| `Method` type (18) | **KEEP** | `uninstall.ts:90,104,144` |
| `ReleaseType` (20) | REMOVE | upgrade-only |
| `Event` (22-33, both `installation.updated` + `installation.update-available`) | REMOVE | both upgrade-only; consumers: handlers/global.ts:123, app.tsx:839, use-event.test.tsx:39, docs, SDK gen |
| `getReleaseType` (37) | REMOVE | only `cli/upgrade.ts:22` (deleted) |
| `Info` schema + `Info` type (48-56) | REMOVE | zero consumers; `info()` cannot survive `latest()` removal |
| `USER_AGENT` (58) | **KEEP** | shared |
| `isPreview()` (60-62) | REMOVE (default) | zero consumers — dead code; see Open Questions |
| `isLocal()` (64) | **KEEP** | worker.ts:31,33 |
| `UpgradeFailedError` (68) | REMOVE | upgrade-only |
| response schemas (73-82) | REMOVE | upgrade-only |
| `Interface` (84) | KEEP, minus `latest`/`upgrade`/`info` members | `method` member stays |
| `Service` (91) | **KEEP** | still referenced via layer wiring; harmless after handler removal — verify no orphan, else keep for uninstall path |
| `layer` (93) | KEEP (trimmed) | provides `method` |
| `text` helper (101-115) | **KEEP** | `method()` (179-185) uses it |
| `method()` service impl | **KEEP** | uninstall |
| `latest()` service impl (207) | REMOVE | upgrade-only |
| `upgrade()` service impl (264) | REMOVE | upgrade-only |
| `info()` (167-172) | REMOVE | zero consumers + depends on `latest()` |
| `run` helper (117-134), `getBrewFormula` (136), `upgradeCurl` (144) | REMOVE all three | `run` is called only inside `upgrade()` (271-305); `method()` uses `text()` (179-185), not `run` |
| module wrappers `latest` (335), `upgrade` (337) | REMOVE | only `cli/upgrade.ts` + `cli/cmd/upgrade.ts` (both deleted) |
| module wrapper `method` (336) | **KEEP** | uninstall.ts:60 |
| `defaultLayer` (328) | **KEEP** | httpapi/server.ts:196, app-runtime.ts:106 |
| `NpmConfig` import | REMOVE if unused after `upgradeCurl` | upgrade-only |

**Cascading unused imports/locals after surgery** — remove these per file (or rely on `bun run lint` to catch leftovers; the general rule is: remove every symbol the compiler/linter reports unused after each file's surgery):

- `installation/index.ts`: `semver` (12), `BusEvent` + `Event` (8 / 22-35), `Schema` (1), `z` (7, `import z from "zod"` — unused once `Info` is removed), `Log` + `const log` (10 / 16), `withTransientReadRetry` (4), `http`/`httpOk` (97-98), `HttpClientRequest`/`HttpClientResponse` (2), `NpmConfig` (14).
- `handlers/global.ts`: `Schema` (in the `effect` import, line 9), `parseBody` (28-34), `HttpServerRequest` (in the http import, line 11).
- `cli/cmd/tui/worker.ts`: `WithInstance` (line 6, used only inside removed `checkUpgrade` at 94).

## Rule 3 assessment (characterization tests)

Removal deletes behavior; no new characterization tests are required. Existing tests covering removed behavior are deleted/trimmed (Step 6). No file split or refactor is performed, so the mandatory pre-split characterization rule does not trigger.

## Residual Risk

- `platform.checkUpdate` / `platform.updateAndRestart` are **optional members with NO implementations** in `packages/app` (`packages/desktop` was deleted) — all app-side consumers are already inert. App removal is behavior-preserving; the only risk is i18n key drift across the 16 other locales + `en` (mitigated by the Step 7 grep, not by `parity.test.ts`).
- `Installation.Service` retains zero yield sites after handler removal; keeping it exported is intentional (uninstall path + layer wiring) but confirm no dead-layer warning surfaces in typecheck.
- Upstream (`anomalyco/opencode`) may have divergent fixes touching these files — rebase conflicts possible on future upstream merges.

## Architecture Decisions

- **Surgical removal, not module deletion:** `installation/index.ts` survives as a slim method-detection module because `opencode uninstall` depends on it. Alternative (delete whole module + rewrite uninstall) rejected: larger blast radius for zero benefit.
- **Shared `version.ts` untouched:** ~15+ importers across three packages; zero upgrade coupling.
- **SDK regen as a hard gate:** generated files are never hand-edited; regen must precede app typecheck because `packages/app` consumes `@opencode-ai/sdk` types.
- **tsbuildinfo clear before typecheck:** known trap where stale `tsgo -b` caches mask SDK-contract errors until push time on a clean box.
- **Bus events removed entirely (both):** `installation.updated` and `installation.update-available` have no non-upgrade consumers.

## Open Questions

1. `isPreview()` (index.ts:60-62): zero consumers verified. Default = remove. If a future re-add of update checking is planned, keep with a comment — decide at execution time.
2. `use-event.test.tsx` 163-176: rewrite with a different global event (preferred — the test validates generic cross-workspace delivery) or remove along with the 36-44 helper; decide at execution time.
3. Whether any `web` (Astro) content beyond the listed mdx files references `opencode upgrade` — the Step 7 grep covers `packages/` only; run a repo-wide `rg "opencode upgrade"` over `web/src/content` as a belt-and-suspenders check.
