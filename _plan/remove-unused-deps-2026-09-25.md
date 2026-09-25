# Plan: Remove unused dependencies (batch, removal-only)

**Date:** 2026-09-25
**Status:** ✅ EXECUTED — all 7 batches verified; 7 manifests + bun.lock changed, zero source files. `@aws-sdk/client-s3` removed (0 code hits).
**Provenance:** New plan, derived from the completed audit. This is a **removals-only** plan: **NO source-code changes.** If any removal breaks typecheck/build, the executor must **REVERT that single batch** and report it — never patch code to accommodate a removal.

---

## Goal

Delete declared-but-unused dependencies from 6 manifests (root + 5 packages), remove 2 placeholder root scripts, and fix 3 misplaced/catalog entries — in ordered batches so any failure bisects to one `package.json`. Reduces install size, dependency-audit surface, and false-positive upgrade noise in `script/check-updates.ts`.

## Scope decision

**IN — exactly these edits (file → section → key → action). This is the ONLY allowed edit surface — key deletions/moves in these 7 manifests (6 + root catalog rows in B7), plus `bun.lock` as a consequence of `bun install`. The B7 catalog-row cleanup is limited to ONLY the two `semver` rows (`semver`, `@types/semver`), each conditional on its own grep gate; no other catalog row is touched. No other fields, no other files:**

### B1 — root `package.json`

- `dependencies`: DELETE `heap-snapshot-toolkit` (verified `:107`)
- `devDependencies`: DELETE `@actions/artifact` (`:86`), `glob` (`:93` — scripts use `new Bun.Glob()`), `semver` (`:98`)
- `scripts`: DELETE placeholder `"random"` (`:17`) and `"hello"` (`:18`)
- **CONDITIONAL — `@aws-sdk/client-s3` (`:103`):** 0 code hits repo-wide as of 2026-09-25 (see appendix #1), BUT `_plan/dep-bump-tier01-2026-09-23.md:187` claims it is consumed ("Root + opencode both consume"). That claim is contradicted by the tree: opencode declares `@aws-sdk/credential-providers` (`opencode:103`), not `client-s3`. **Gate:** re-run the appendix #1 grep at execution (including `script/`, not just `src/`). Remove ONLY if zero code hits; otherwise KEEP and record why in the executor summary.

### B2 — `packages/app/package.json`

- `dependencies` DELETE: `@shikijs/transformers` (`:48`), `@solid-primitives/active-element` (`:49`), `@solid-primitives/audio` (`:50`), `@solid-primitives/scroll` (`:56`), `@solid-primitives/websocket` (`:59`), `diff` (`:64`), `marked` (`:69`), `marked-shiki` (`:70`), `shiki` (`:72`), `solid-list` (`:74`), `virtua` (`:76`)
- `devDependencies` DELETE: `vite-plugin-icons-spritesheet` (`:39`)
- **KEEP (verified in use — 28 imports, appendix #4):** `@solid-primitives/event-bus` (`:51`), `event-listener` (`:52`), `i18n` (`:53`), `media` (`:54`), `resize-observer` (`:55`), `storage` (`:57`), `timer` (`:58`)

### B3 — `packages/opencode/package.json`

- `dependencies` DELETE: `@gitlab/opencode-gitlab-auth` (`:107` — code imports the UNSCOPED `opencode-gitlab-auth` at `src/plugin/index.ts:18`; the unscoped entry `:157` is KEPT), `@openauthjs/openauth` (`:112`), `@pierre/diffs` (`:127` — owned by `packages/ui` `:50`; ui's catalog ref keeps the catalog row alive), `@standard-schema/spec` (`:131` — declared TWICE; also devDeps `:60`), `@zip.js/zip.js` (`:132`), `chokidar` (`:137` — watcher is `@parcel/watcher` `:126`), `minimatch` (`:154` — owned by `packages/core/src/util/glob.ts:2`; core's own entry is untouched), `partial-json` (`:160`)
- `devDependencies` DELETE: `@babel/core` (`:44` — MED-HIGH confidence, gated: only `prettier/plugins/babel` + `prettier/plugins/estree` are used, `src/cli/cmd/generate.ts:35-36`; prettier v3 bundles its parsers, `@babel/core` is not needed at runtime — appendix #3 + a runtime import smoke in Step 3), `@standard-schema/spec` (`:60` — the duplicate), `@types/babel__core` (`:62`), `why-is-node-running` (`:77`)
- **KEEP:** `@parcel/watcher` (`:126`) + all 8 `@parcel/watcher-*` (`:48-55` — cross-compile pins, `script/build.ts:218`); `@zvec/bindings-*` (`:56-59` — dynamic platform require, `src/search/zvec.ts:130`); `opencode-gitlab-auth` (`:157`); `semver` (`:162`), `glob` (`:147`), `@types/semver` (`:67`) — out of scope (opencode keeps its literal pins; core's copies are removed in B4)

### B4 — `packages/core/package.json`

- `dependencies` DELETE: `semver` (`:43`)
- `devDependencies` DELETE: `@types/semver` (`:26`)
- **KEEP:** `minimatch` (`:41`), `glob` (`:39`) — used by core

### B5 — `packages/ui/package.json`

- `dependencies` DELETE: `@shikijs/transformers` (`:51`), `@solid-primitives/bounds` (`:52`), `luxon` (`:63`), `virtua` (`:77`)
- `devDependencies` DELETE: `@types/luxon` (`:38`)
- **KEEP:** `motion-dom` (`:69`), `motion-utils` (`:70`) — needs-review, out of scope; `vite-plugin-icons-spritesheet` (`:43`) — ui uses it for icon generation; only app's copy is unused

### B6 — `packages/web/package.json`

- `dependencies` DELETE: `@fontsource/ibm-plex-mono` (`:17`), `@shikijs/transformers` (`:18`), `ai` (`:21`), `js-base64` (`:26`), `remeda` (`:32`)

### B7 — misplaced / catalog fixes (separate batch, after all removals)

- `packages/web`: MOVE `@types/luxon` from `dependencies` (`:20`) → `devDependencies`. `luxon` itself IS already declared in web (`:28`, `catalog:`) — **no add needed** (read-verified 2026-09-25).
- `packages/app`: MOVE `tailwindcss` from `dependencies` (`:75`) → `devDependencies` (build-time only: consumed via `@tailwindcss/vite` at `vite.js:3,36`; the `@import "tailwindcss/theme.css"` / `@import "tailwindcss/utilities.css"` directives live in `packages/ui/src/styles/tailwind/index.css:3-4`, resolved from ui's own devDep; zero app-local tailwind CSS refs — appendix #5). NOT a removal — full removal is deferred (Open Question Q2).
- `packages/app`: CHANGE `@tsconfig/bun` `"1.0.11"` → `"catalog:"` (`:32`). Catalog entry EXISTS at root `:43` with the same version `1.0.11` → version no-op, pure normalization.
- **Catalog row cleanup (root `workspaces.catalog`, conditional — grep-gate each):** ONLY `semver` (`:65`) and `@types/semver` (`:41`) are candidates, authorized by the brief rule "semver/@types/semver catalog normalization ONLY IF the removals above leave no semver consumer". After B1–B6, DELETE each of these two rows ONLY after a grep shows zero `"{name}": "catalog:"` refs across ALL workspace manifests — INCLUDING `packages/script/package.json`, which has its own literal `semver`/`@types/semver` pins (untouched by this plan) and must be counted in the gate. The `@openauthjs/openauth` (`:45`) and `virtua` (`:73`) catalog rows are explicitly NOT removed — out of authorized scope (optional follow-up only).

**Batch order rationale:** root → app → opencode → core → ui → web → fixes. No cross-batch interaction was found: removing `@pierre/diffs` from opencode leaves ui's `catalog:` ref (`ui:50`) intact; removing `minimatch` from opencode leaves core's copy intact; catalog rows are only touched in B7 after all consumer removals have landed. B7 is last so its grep gates see the post-removal state.

## Do Not Touch / Out of Scope

**NEEDS-REVIEW — explicitly NOT removed in this plan (reviewer boundary):**
- `@aws-sdk/client-s3` (root `:103`) — UNLESS the Step 1 verification gate passes; otherwise leave + record why
- `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/context-async-hooks`, `@opentelemetry/exporter-trace-otlp-http` (opencode `:119-122`; core also declares a set `:33-36`)
- `motion-dom`, `motion-utils` (ui `:69-70`)
- `typescript` devDependencies (all packages)
- `@astrojs/check` (web `:40`)
- root `@opentui/*` (`:87-89`)

**STRUCTURALLY KEPT (verified load-bearing):** `@parcel/watcher` + `@parcel/watcher-*` and `@zvec/bindings-*` (opencode); unscoped `opencode-gitlab-auth` (opencode `:157`); `semver`/`glob` (opencode), `minimatch`/`glob` (core); the app `@solid-primitives/*` KEEP set; ui's `vite-plugin-icons-spritesheet`.

**OUT — files/surfaces never touched:** `github/package.json` (standalone action, outside the workspace), every other `package.json` in the tree, `patches/*`, `patchedDependencies`, ALL source files, and historical plan docs. The phantom `storybook/preview-api` import in ui stories is out of scope.

**Documentation-integrity note (AGENTS.md rule):** no root or package AGENTS.md claim is contradicted by these removals. The one contradicted claim found is in `_plan/dep-bump-tier01-2026-09-23.md:187` (`@aws-sdk/client-s3` "Root + opencode both consume") — a historical EXECUTED plan doc; per convention bodies are preserved as provenance, so do NOT edit it — record the drift in the executor summary. The code wins.

## Architecture decisions

- **Direct `package.json` edits, not `bun remove`:** `bun remove` is interactive/heavy and rewrites the manifest wholesale; precise per-section key deletions keep the diff auditable (same section-scoping discipline as the dep-bump-tier01 plan).
- **Per-batch `bun install` + lockfile hunk audit:** each batch = edit → `bun install` → audit `git diff bun.lock` → verify. Keeps each lockfile diff small and makes a failure attributable to exactly one batch. This is a deliberate deviation from the brief's suggested single end-of-run install — chosen for bisectability, since the brief's per-batch `bun.lock` revert rule (requirement 3) requires a per-batch install to have something to revert.
- **Lockfile churn discipline (AGENTS.md Notes):** `bun install` can silently modify `bun.lock` without dep changes (`configVersion` removal, integrity stripping, formatting churn). Revert every hunk NOT attributable to the batch's removals — restore from `git show HEAD:bun.lock`, never hand-edit integrity hashes. Exception: the `ghostty-web#main` `github:` ref re-resolves to the moving tip on every install — that hunk is HONEST drift, accepted noise.
- **No tests required:** manifest-only plan, zero source changes; unused deps never affected module resolution. Typecheck/build is the gate. (Contrast: dep-bump-tier01 ran test suites because installed versions changed; here nothing installed changes behavior.) The AGENTS.md pre-push hook runs full `bun turbo typecheck` across all packages and blocks the push — that is the final safety net.
- **Pre-existing-failure attribution:** AGENTS.md Known Issues that must NOT be misread as regressions: `packages/diff-wasm` fails typecheck with TS2307 until `bun run --cwd packages/diff-wasm build:wasm` (empty gitignored `pkg/`); `packages/web` needs `--skipLibCheck` for any manual `astro check` (pre-existing astro/starlight lib errors); `packages/app` `tsgo -b` caches in `packages/app/node_modules/.ts-dist/tsconfig.tsbuildinfo` and can mask errors — delete stale `*.tsbuildinfo` before every app typecheck.

## Step-by-step execution

### Step 0 — Pre-flight

1. `git status` — if dirty, stop and report. Record current HEAD SHA for rollback.
2. Baseline: run each batch's verification command once BEFORE any edit and record pass/fail (app: clear `.ts-dist` first). This is the attribution baseline — only deltas from it count as regressions.

### Step 1 — B1 root

Edit root `package.json`: delete the 3 devDeps keys, the `heap-snapshot-toolkit` dep key, and the 2 placeholder scripts. Then the AWS gate:

```powershell
# AWS verification gate — must return ZERO code hits (package.json/bun.lock/_plan hits are expected)
rg -n "S3Client|PutObjectCommand|client-s3" --glob "!node_modules" --glob "!bun.lock" --glob "!package.json" --glob "!_plan/**"
```

- Zero hits → also DELETE `@aws-sdk/client-s3` (`:103`). Any code hit → KEEP it and record the hit in the executor summary.

Then: `bun install` → lockfile hunk audit (Architecture decisions) → verify from root:

```powershell
bun run typecheck   # = bun turbo typecheck (full workspace)
```

**Expected:** exit 0, modulo the documented diff-wasm TS2307 pre-existing failure (run `bun run --cwd packages/diff-wasm build:wasm` first if `packages/diff-wasm/pkg/` is empty on this box).

### Step 2 — B2 app

Edit `packages/app/package.json`: delete the 11 dependency keys + 1 devDep key listed in B2. `bun install` → lockfile audit → verify:

```powershell
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "packages\app\node_modules\.ts-dist"
bun run --cwd packages/app typecheck
```

**Expected:** exit 0. (Stale tsbuildinfo deleted first — mandatory.)

### Step 3 — B3 opencode

Edit `packages/opencode/package.json`: delete the 8 dependency keys + 4 devDep keys listed in B3. `bun install` → lockfile audit → verify:

```powershell
bun run --cwd packages/opencode typecheck
# @babel/core runtime smoke — prettier's babel plugin must load without @babel/core installed
bun -e "await import('prettier/plugins/babel'); await import('prettier/plugins/estree'); console.log('prettier plugins OK')"
```

**Expected:** typecheck exit 0; the smoke prints `prettier plugins OK`. If the smoke fails, revert ONLY the `@babel/core` deletion (restore the key, re-install) and record — `@types/babel__core` may still go if typecheck stays green.

### Step 4 — B4 core

Edit `packages/core/package.json`: delete `semver` (`:43`) + `@types/semver` (`:26`). `bun install` → lockfile audit → verify:

```powershell
bun run --cwd packages/core typecheck
```

### Step 5 — B5 ui

Edit `packages/ui/package.json`: delete the 4 dependency keys + `@types/luxon` devDep key listed in B5. `bun install` → lockfile audit → verify:

```powershell
bun run --cwd packages/ui typecheck
```

### Step 6 — B6 web

Edit `packages/web/package.json`: delete the 5 dependency keys listed in B6. `bun install` → lockfile audit → verify (web has NO `typecheck` script — `astro build` is the available verification, per dep-bump-tier01 precedent):

```powershell
bun run --cwd packages/web build
# OPTIONAL weaker-but-direct check (needs --skipLibCheck per AGENTS.md):
# bunx astro check --skipLibCheck   (from packages/web)
```

**Expected:** build exit 0.

### Step 7 — B7 fixes

1. web: move `@types/luxon` to `devDependencies` (alphabetical position among existing devDeps).
2. app: move `tailwindcss` to `devDependencies`; change `@tsconfig/bun` to `"catalog:"`.
3. Catalog rows: gate ONLY `semver` + `@types/semver` — grep every workspace manifest (incl. `packages/script/package.json`) for `"semver": "catalog:"` / `"@types/semver": "catalog:"`; delete each of the two root catalog rows only on zero remaining refs. Do NOT touch the `@openauthjs/openauth` or `virtua` rows.

`bun install` → lockfile audit → verify:

```powershell
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "packages\app\node_modules\.ts-dist"
bun run --cwd packages/app typecheck
bun run --cwd packages/app build      # validates the tailwindcss move + @tsconfig/bun catalog ref
bun run --cwd packages/web build      # validates the @types/luxon move
```

### Step 8 — Final lockfile idempotency + diff audit

```powershell
bun install        # re-run: must produce NO further changes (idempotency proof)
git diff --stat
```

 **Expected `git diff --stat`:** 6 package manifests total (root + 5 packages), `bun.lock`, `_plan/index.md` (+ this plan file). ZERO source files, ZERO `patches/` changes. `bun.lock` diff contains ONLY the removed packages' rows (+ accepted `ghostty-web#main` drift).

## Exit criteria

1. Every batch's verification command passes, modulo the documented pre-existing failures (diff-wasm TS2307 → `build:wasm`; web `--skipLibCheck` caveat; app tsbuildinfo cleared each time) and the Step 0 baseline.
2. Final `bun install` is idempotent — the only `bun.lock` changes are the removed dependencies' rows (+ accepted `ghostty-web#main` drift).
3. `git diff --stat` shows only the manifests + `bun.lock` + `_plan/index.md` — zero source files.
4. The AWS gate outcome (removed or kept-with-reason) is recorded in the executor summary.
5. AGENTS.md pre-push hook (`bun turbo typecheck` full workspace) passes at push time.

## Risks & rollback

- **Per-batch rollback:** `git checkout -- <that package.json>` (or root `package.json`) → `bun install` → re-run that batch's verification. If `bun.lock` has entangled churn, `git checkout -- bun.lock` + re-install. Never bisect by patching code.
- **Risk per package:** root **LOW** (unused devtools + placeholder scripts; AWS item gated). core **LOW**. ui **LOW-MEDIUM** (luxon/virtua removals are audit-verified; ui typecheck covers). app **MEDIUM** (11 removals but all unused; B7 touches build config — `build` gate covers). opencode **MEDIUM** (largest manifest; `@babel/core` is MED-HIGH confidence — mitigated by the Step 3 runtime smoke; `@standard-schema/spec` dual-declaration makes both deletions same-batch). web **MEDIUM** (weakest verification — build only, no typecheck script; the 5 removals are audit-verified unused).
- **`@aws-sdk/client-s3`:** residual risk is a dynamic/hidden import the grep misses; the gate greps repo-wide including `script/`, and `bun.lock` hits are expected pre-removal. If any doubt remains at execution, KEEP (the brief's default).
- **Catalog row deletions (B7):** a row deleted while some consumer still refs `catalog:` would break install — the grep gate makes this near-impossible; if `bun install` errors after a row deletion, restore the row.

## Verification evidence appendix

Spot-checks re-run 2026-09-25 while writing this plan (commands reusable at execution):

| # | Target | Command | Observed result |
| - | ------ | ------- | --------------- |
| 1 | `@aws-sdk/client-s3` gate | `rg -n "S3Client\|PutObjectCommand\|client-s3"` repo-wide | ONLY `package.json:103`, `bun.lock`, `_plan/dep-bump-tier01-2026-09-23.md` — **0 code hits**; the old plan's consumption claim (`:187`) is contradicted by the tree |
| 2 | `@gitlab/opencode-gitlab-auth` | `rg -n "opencode-gitlab-auth" packages/opencode/src` | Single hit `src/plugin/index.ts:18` imports the **UNSCOPED** `opencode-gitlab-auth` → scoped pkg unused |
| 3 | `@babel/core` | `rg -n "@babel/core\|babel__core\|prettier/plugins" packages/opencode/src` | Only `generate.ts:35-36` (`prettier/plugins/babel` + `estree`) → `@babel/core`/`@types/babel__core` unused |
| 4 | app `@solid-primitives/*` KEEP set | `rg -n "@solid-primitives/(event-bus\|event-listener\|i18n\|media\|resize-observer\|storage\|timer)" packages/app/src` | 28 live imports across 22 files → KEEP confirmed |
| 5 | app `tailwindcss` | `rg -n "tailwindcss" packages/app` (+ `rg -n "@import [\"']tailwindcss" packages/app/src`) | Only `vite.js:3,36` (`@tailwindcss/vite`) + manifest; 0 app-local CSS imports; the `@import "tailwindcss/…"` directives live in `packages/ui/src/styles/tailwind/index.css:3-4` |
| 6 | web `luxon` | read `packages/web/package.json` | `luxon: "catalog:"` declared at `:28` → `@types/luxon` move needs no runtime add |
| 7 | B7 catalog gates | `rg -n '"(semver\|@types/semver)": "catalog:"' --glob "package.json"` (all workspace manifests, incl. `packages/script`) | Must be EMPTY per name before deleting that row. Today `semver` has zero `catalog:` consumers; `@types/semver` has ONE — `packages/core/package.json:26` — which B4 removes, so its gate can only pass AFTER B4. The `@openauthjs/openauth` and `virtua` rows are NOT candidates and their gates are not run. |
| — | B1 root: `@actions/artifact`, `heap-snapshot-toolkit`, `glob`, `semver` | `rg -n '[\x22\x27](@actions/artifact\|heap-snapshot-toolkit)[\x22\x27]' . --glob '!node_modules' --glob '!bun.lock' --glob '!_plan/**' --glob '!package.json'` → 0 hits; `rg -n 'from [\x22\x27](semver\|glob)[\x22\x27]' script --glob '!node_modules'` → 0 hits (root-owned `script/**` imports neither) | Root `script/**` uses `new Bun.Glob()`; `semver`/`glob` ARE imported elsewhere (`packages/core/src/util/glob.ts:1`; `packages/opencode/src/{installation/index.ts:12,plugin/shared.ts:4,cli/cmd/tui/app.tsx:23}`; `packages/script/src/index.ts:2`) — but those packages declare their OWN pins and are untouched; only root's unused copies go. |
| — | B2 app (11 deps + `vite-plugin-icons-spritesheet`) | `rg -n '[\x22\x27](@shikijs/transformers\|@solid-primitives/active-element\|@solid-primitives/audio\|@solid-primitives/scroll\|@solid-primitives/websocket\|marked-shiki\|marked\|shiki\|solid-list\|virtua\|diff\|vite-plugin-icons-spritesheet)[\x22\x27]' packages/app --glob '!package.json' --glob '!node_modules'` | 0 hits (KEEP set `event-bus\|event-listener\|i18n\|media\|resize-observer\|storage\|timer` intentionally excluded) |
| — | B3 opencode (8 deps + 4 devDep keys) | `rg -n '[\x22\x27](@gitlab/opencode-gitlab-auth\|@openauthjs/openauth\|@pierre/diffs\|@standard-schema/spec\|@zip.js/zip.js\|chokidar\|minimatch\|partial-json\|@types/babel__core\|why-is-node-running)[\x22\x27]' packages/opencode --glob '!package.json' --glob '!node_modules'` | 0 hits; scoped `@gitlab/...` unused — code imports unscoped `opencode-gitlab-auth` at `src/plugin/index.ts:18`; `minimatch` owned by core |
| — | B3 `@babel/core` | `rg -n '[\x22\x27]@babel/core[\x22\x27]' packages/opencode/src` | 0 hits; only `prettier/plugins/babel\|estree` used at `generate.ts:35-36` (row 3) |
| — | B4 core: `semver`, `@types/semver` | `rg -n '[\x22\x27]semver[\x22\x27]' packages/core/src --glob '!node_modules'` | 0 hits — core has no `semver` import (`@types/semver` is types-only) |
| — | B5 ui: `@shikijs/transformers`, `@solid-primitives/bounds`, `luxon`, `virtua`, `@types/luxon` | `rg -n '[\x22\x27](@shikijs/transformers\|@solid-primitives/bounds\|luxon\|virtua\|@types/luxon)[\x22\x27]' packages/ui --glob '!package.json' --glob '!node_modules'` | 0 hits |
| — | B6 web: `@fontsource/ibm-plex-mono`, `@shikijs/transformers`, `ai`, `js-base64`, `remeda` | `rg -n '[\x22\x27](@fontsource/ibm-plex-mono\|@shikijs/transformers\|ai\|js-base64\|remeda)[\x22\x27]' packages/web --glob '!package.json' --glob '!node_modules'` | 0 hits |

Quoting caveat: the `[\x22\x27]` form matches both quote characters; a literal `"` inside a single-quoted PowerShell regex argument silently yields zero matches (false clean), so always use `[\x22\x27]`. Markdown-table caveat: inside the table cells above, `\|` is a markdown-escaped literal `|` — when copying a command out of the table, convert `\|` back to plain `|` before running `rg`, otherwise the alternation stays escaped and the command matches nothing.

## Open questions

- **Q1 (execution-time):** if any B7 catalog gate grep is non-empty (a consumer survived that the audit missed), delete nothing for that name and record the consumer — the row stays.
- **Q2 (human, post-execution):** full REMOVAL of app `tailwindcss` (not just the devDependencies move) — needs proof that no app-local CSS/config will ever reference it directly; deferred with the move as the safe interim.
- **Q3 (human, pre-execution):** the AWS gate default encoded here is REMOVE on zero hits. If the reviewer prefers keeping `@aws-sdk/client-s3` regardless (e.g. anticipated S3 work), say so before execution — the gate then becomes a no-op record.

## Deliberately deferred (with reasons)

- **Needs-review set** (OTel quartet, `motion-dom`/`motion-utils`, `typescript` devDeps, `@astrojs/check`, root `@opentui/*`) — each needs its own usage investigation; bundling them here would violate the verified-only contract.
- **`storybook/preview-api` phantom import in ui stories** — out of scope; separate storybook hygiene item.
- **`github/package.json`** — outside the workspace; standalone action, separate decision.
- **Historical plan doc correction** (`dep-bump-tier01:187`) — bodies are preserved provenance; drift is recorded in the executor summary instead.
