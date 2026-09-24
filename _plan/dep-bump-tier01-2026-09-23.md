# Plan: Tier 0/Tier 1 targeted dependency version bump (batch, bump-only)

**Date:** 2026-09-23
**Status:** ✅ EXECUTED (2026-09-23) — landed in `b5fc1f9` (31 Tier 0/Tier 1 targets across 6 manifests; `solid-js` deferred to a dedicated patch-re-key plan; all verifications green). Residual: the full `packages/opencode` test suite did not complete within the tool budget — documented as residual risk, not proof of clean.
**Provenance:** New plan. The hardened `script/check-updates.ts` (landed in `c25068d`, 2026-09-23) reported 111 upgradable deps; the user approved ONLY the Tier 0 (dev/type/build tooling) + Tier 1 (isolated patch-only runtime) subset below. All `from` versions below were re-verified against the actual `package.json` files in the tree on 2026-09-23 — zero drift found (every `from` matches disk). Rev 2 (2026-09-23, review-adjudicated): dropped the `solid-js` bump entirely (patchedDependencies coupling — see Deferred), fixed the AWS acceptance contradiction, added core/web/app verification, listed surviving divergence warnings, corrected the check-updates.ts contract, named the lockfile `github:` drift.

---

## Goal

Bump ONLY the approved Tier 0/Tier 1 dependency set, via `package.json` version edits + `bun install`. This is a **version-bumps-only** plan: **NO code fixes.** If any bump proves breaking (typecheck or test failure attributable to it), the executor must **REVERT that single bump** and report it — never patch code to accommodate a bump.

Do NOT bump the risky set (see Scope).

## Scope decision

**IN — exactly these edits (file → section → package → from → to). This is the ONLY allowed edit surface — version-string edits in these 6 manifests, plus `bun.lock` as a consequence of `bun install`. No other fields, no other files:**

**Root `package.json`**
- `dependencies`: `@aws-sdk/client-s3` `3.1110.0` → `3.1138.0` (verified `:103`)
- `devDependencies`: `oxlint` `1.78.0` → `1.85.0` (`:95`); `prettier` `3.9.6` → `3.9.9` (`:97`); `turbo` `2.10.12` → `2.11.3` (`:100`)
- `workspaces.catalog` (verified `:26-83`): `@cloudflare/workers-types` `4.20251008.0` → `4.20260702.1`; `@kobalte/core` `0.13.11` → `0.13.14`; `@octokit/rest` `22.0.0` → `22.0.1`; `@tsconfig/bun` `1.0.9` → `1.0.11`; `@tsconfig/node22` `22.0.2` → `22.0.6`; `@types/bun` `1.3.12` → `1.4.2`; `@types/luxon` `3.7.1` → `3.7.5`; `@types/node` `24.12.2` → `24.13.6`; `@types/semver` `7.7.1` → `7.8.0`; `diff` `8.0.2` → `8.0.4`; `marked` `17.0.1` → `17.0.6`; `opentui-spinner` `0.0.6` → `0.0.7`; `remend` `1.3.0` → `1.3.1`; `ulid` `3.0.1` → `3.0.2`; `vite-plugin-solid` `2.11.10` → `2.11.14`

> **`solid-js` is NOT in this batch** — deliberately dropped (review CRITICAL 1). See "solid-js exclusion" below and Deferred.

**`packages/opencode/package.json`** (verified `:74, :103, :109-111, :150-151`)
- `@aws-sdk/credential-providers` `3.1110.0` → `3.1138.0`; `@modelcontextprotocol/sdk` `1.30.0` → `1.30.1`; `@octokit/graphql` `9.0.4` → `9.0.5`; `ignore` `7.0.6` → `7.0.10`; `immer` `11.1.16` → `11.1.18`; `prettier` `3.9.6` → `3.9.9`; `vscode-languageserver-types` `3.18.0` → `3.18.3`

**`packages/web/package.json`** (verified `:26, :35`)
- `js-base64` `3.9.2` → `3.9.4`; `vscode-languageserver-types` `3.18.0` → `3.18.3`

**`packages/app/package.json`** (verified `:32`)
- `@tsconfig/bun` `1.0.10` → `1.0.11` (also resolves the catalog divergence — see Divergence D1)

**`packages/core/package.json`** (verified `:31`)
- `@npmcli/arborist` `9.9.1` → `9.9.2`

**`packages/ui/package.json`** (verified `:60, :62, :65`)
- `dompurify` `3.4.13` → `3.4.16`; `katex` `0.18.4` → `0.18.9`; `marked-katex-extension` `5.1.10` → `5.1.13`

### solid-js exclusion (review CRITICAL 1 — explicit decision)

**DROPPED from this batch: `solid-js` 1.9.10 → 1.9.15.** The catalog `solid-js` pin is coupled to the root `patchedDependencies` key `solid-js@1.9.10` (`package.json:136` → `patches/solid-js@1.9.10.patch`). Bumping the catalog while the key stays at 1.9.10 makes Bun **silently ignore the patch** — empirically proven on this box (Bun 1.4.2): a version-mismatched `patchedDependencies` key is skipped with exit 0, no warning, patch NOT applied. There is no observable signal, so "verify no patch failures" observes nothing. Three reasons this bump cannot proceed here:

1. **Scope violation:** re-keying `patchedDependencies` is a non-version-string field edit — outside the approved edit surface (the 6 manifests' version tokens only).
2. **Patch semantics:** the patch changes Solid `Transition` runtime semantics (upstream issue #2046); shipping an un-patched install would change behavior invisibly.
3. **Silent failure mode:** Bun emits NO signal on version mismatch — the failure mode is an undetected un-patched dependency tree.

Therefore this plan leaves catalog `solid-js` at `1.9.10` and the patch key untouched; **no `⚠ [patch-mismatch]` warning is expected or acceptable after execution.** The dedicated follow-up plan's required scope is specified in Deferred.

**OUT — the risky set, explicitly never touched:** opentui (`@opentui/*`), `web-tree-sitter`, `effect`/`@effect/*`/`@effect/opentelemetry`, `drizzle-orm`/`drizzle-kit` (beta pins), `@hono/zod-validator`, `@solidjs/router`, `virtua`, `@astrojs/starlight`, `@opentelemetry/exporter-trace-otlp-http`, `@zvec/*`, `@lydell/node-pty`, `@typescript/native-preview`, `@zip.js/zip.js`, `hono`/`hono-openapi`, `remeda`, `typescript`, `vite`, `zod`, `@ai-sdk/*`, `ai`, `gitlab-ai-provider`, `@sentry/*`, `@playwright/test`, `@tanstack/*`, `astro`/`@astrojs/*`.

**OUT — files never touched:** `github/package.json` (standalone GitHub Action, outside the workspace), `.opencode/package.json`, every other `package.json` in the tree, `patches/*`, the `patchedDependencies` block, and ALL source files. Only the 6 manifests listed above (+ `bun.lock` as a natural consequence of `bun install`).

## Divergence decisions (must-decide items — explicit recommendations)

### D1 — `@tsconfig/bun`: catalog 1.0.9 vs `packages/app` 1.0.10
**Decision: ALIGN BOTH to 1.0.11 (include both bumps).** Both are Tier 0 (tsconfig base = build/type tooling). Aligning removes the divergence outright; leaving catalog at 1.0.9 while bumping only `packages/app` would *create* a new divergence in the opposite direction. Cost is nil — the catalog entry is consumed by root devDependencies, `packages/opencode`, and `packages/core` via `catalog:` refs (`opencode:61`, `core:21` verified), so all consumers move together.

### D2 — `@npmcli/arborist`: `packages/core` 9.9.1 (Tier 1 → 9.9.2) vs root catalog 9.4.0
**Decision: bump ONLY `packages/core` 9.9.1 → 9.9.2. LEAVE catalog at 9.4.0.** Justification: 9.4.0 → 9.9.2 is a MINOR-series jump for a heavy package (npm's dependency-tree resolver) — outside the patch-only Tier 1 contract and not user-approved. The divergence persists after this plan by design; it is inert (grep-verified: no workspace manifest consumes `@npmcli/arborist` via `catalog:`; only `packages/core` uses it as a direct dep). The executor must EXPECT the residual `⚠ [divergence]` line post-execution — it is a designed outcome, not a failure (see Step 3 expected observations). Catalog entry hygiene → future plan (Q1).

### D3 — `dompurify`: `packages/ui` 3.4.13 (Tier 1 → 3.4.16) vs root catalog 3.3.1
**Decision: bump ONLY `packages/ui` 3.4.13 → 3.4.16. LEAVE catalog at 3.3.1.** Justification: 3.3.1 → 3.4.16 is a MINOR-series jump — outside the patch-only contract and not user-approved. Critically, `packages/web` depends on `isomorphic-dompurify` `3.22.0` (web `:25`) which pulls its own dompurify transitively; there is no `dompurify: "catalog:"` ref in any workspace manifest (grep-verified), so the catalog entry is currently unconsumed and the divergence is inert. The executor must EXPECT the residual `⚠ [divergence]` line post-execution (see Step 3). Catalog entry hygiene → future plan (Q1).

### D4 — `vscode-languageserver-types` cross-package check (verified, no divergence)
Both `packages/opencode` (`:76`) and `packages/web` (`:35`) pin `3.18.0` **independently** (direct literal pins in each manifest's `dependencies` — NOT a catalog entry; no `vscode-languageserver-types` key exists in `workspaces.catalog`). Same `from` in both files, same `to` in both files → no divergence exists today and none is created. Bump both to `3.18.3` as listed. Note for the record: this duplicated pin is a candidate for catalog consolidation in a future hygiene plan (Q2) — out of scope here.

## Verified anchors (all re-verified against the tree, 2026-09-23)

- Root `package.json`: `@aws-sdk/client-s3` `:103`; `oxlint` `:95`; `prettier` `:97`; `turbo` `:100`; catalog keys at the lines cited in Scope; `patchedDependencies` `solid-js@1.9.10` at `:136` (left untouched)
- `packages/opencode/package.json`: `prettier` `:74`; `@aws-sdk/credential-providers` `:103`; `@modelcontextprotocol/sdk` `:109`; `@octokit/graphql` `:110`; `vscode-languageserver-types` `:76`; `ignore` `:150`; `immer` `:151`
- `packages/web/package.json`: `js-base64` `:26`; `vscode-languageserver-types` `:35`; `isomorphic-dompurify` `:25` (context for D3); scripts: `build` `:9` (`astro build`) — **no `typecheck` script exists in web's manifest**
- `packages/app/package.json`: `@tsconfig/bun` `:32`; scripts: `typecheck` `:12` (`tsgo -b`), `test:unit` `:17` (`bun test --preload ./happydom.ts ./src`)
- `packages/core/package.json`: `@npmcli/arborist` `:31`; scripts: `test` `:9` (`bun test`), `typecheck` `:11` (`tsgo --noEmit`)
- `script/check-updates.ts` CLI contract (verified against the current script, `c25068d` + follow-ups): flags `--check`, `--apply`, `--install`, `--typecheck` (requires `--apply`), `--all`. Flag parsing at `:381-385`; mutual exclusion errors exit 2 (`:388-393`). **`--check` exits 1 when updates exist OR fetch failures occurred** (`:510`: `results.length > 0 || failed.length > 0 ? 1 : 0`). **Report-only invocation = `bun run script/check-updates.ts` (no flags)** — prints the report, exits 0 regardless. Verification steps below use the report-only form.

## Architecture decisions

- **Bump-only contract:** edits are limited to exact `(file, section, name, from)` tokens listed in Scope. Use precise edits (per-section), never a file-wide name regex — the same section-scoping discipline the hardened `check-updates.ts` adopted (its A4); here done manually since we're applying an explicit approved list, not running `--apply`.
- **`bun install` once from root** after all edits. `bun install` is known to churn `bun.lock` beyond the intended changes (integrity stripping, formatting, `configVersion` removal — AGENTS.md Notes). Mitigation below in the lockfile discipline step.
- **`packages/app` typecheck caching:** `packages/app` uses `tsgo -b` whose `tsconfig.tsbuildinfo` caches results and can mask real errors; turbo `--force` does NOT clear it. Stale build-info MUST be deleted before typechecking (AGENTS.md packages/app note).
- **Divergences D2/D3 are left to persist by design** — each is inert (no `catalog:` consumer for either dep; grep-verified) and resolving them would require non-approved minor jumps. They appear as expected `⚠ [divergence]` warnings, listed explicitly in Step 3.
- **solid-js: no patch interaction in this plan.** With solid-js dropped, the `patchedDependencies` block and `patches/` directory are never in play; no patch validation step exists here.

## Step-by-step execution

### Step 0 — Pre-flight registry re-check (review CRITICAL 2)

1. Confirm clean tree: `git status` — if dirty, stop and report.
2. Baseline snapshot for rollback: note current HEAD SHA.
3. Run `bun run script/check-updates.ts` (report-only, no flags) BEFORE any edit. **Record for each of the ~30 targets in Scope the current in-channel latest (`latestInRange`) at this moment** — npm registries move; the `to` values in this plan were approved against a 2026-09-23 snapshot. This record is the basis for the Step 3 acceptance comparison.
4. **AWS registry check (explicit):** the current registry in-channel latest for BOTH `@aws-sdk/client-s3` and `@aws-sdk/credential-providers` is reported as `3.1139.0`, while this plan's approved target is `3.1138.0`. **The plan keeps the user-approved `to = 3.1138.0`** — the approved target set is authoritative; the plan must not silently substitute versions. Consequence: the Step 3 acceptance criterion has a pre-approved remainder for exactly these two packages (see expected observations). If a fully-clean list is wanted, that is a human decision — see Open Question Q3.

### Step 1 — Edit the 6 manifests

Apply exactly the edits in Scope. For each edit, locate the line by the verified anchors and change only the version token. After editing, run `git diff` and confirm the diff contains ONLY version-token changes in exactly these 6 files. If anything else appears (including any change to `patchedDependencies`, `patches/`, or a solid-js line), stop and fix the edit.

### Step 2 — `bun install` + lockfile discipline

1. Run `bun install` from repo root.
2. Inspect `git diff bun.lock` hunks.
3. **Keep** every hunk attributable to the intended bumps (version updates + integrity-hash changes for the bumped packages).
4. **Revert any hunk NOT attributable to the intended version changes** (unrelated formatting churn, integrity stripping on non-bumped packages, `configVersion` removal, etc.) — restore those hunks from `git show HEAD:bun.lock` and re-run `bun install` to confirm they don't regenerate. NEVER hand-edit integrity hashes — only revert whole hunks back to HEAD state.
5. **Known `github:` drift (name it explicitly):** the `ghostty-web#main` branch ref re-resolves to the moving tip on every `bun install` — that hunk is HONEST drift. Never hand-edit its hash back; if it must be removed, restore via `git show HEAD:bun.lock` + reinstall (but note it will re-appear on the next install — treat it as accepted noise). This exception is the ONLY non-bump hunk allowed to survive.
6. With solid-js dropped, no patch-application concern exists in this step; `patches/solid-js@1.9.10.patch` continues to apply unchanged against catalog 1.9.10.

### Step 3 — Verification (exact sequence)

**Order matters; run each from repo root unless noted.**

```powershell
# 1. Clear stale app typecheck cache (masks real errors otherwise)
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue "packages\app\node_modules\.ts-dist"

# 2. Typecheck opencode (largest blast radius: catalog types + sdk consumers)
bun run --cwd packages/opencode typecheck

# 3. Typecheck app (second SDK/upper-bound consumer)
bun run --cwd packages/app typecheck

# 4. Typecheck core (@npmcli/arborist consumer)
bun run --cwd packages/core typecheck

# 5. Build web (js-base64 + vscode-languageserver-types consumer; NOTE: web has NO
#    typecheck script in its manifest — `astro build` is the available verification.
#    A manual web typecheck, if the executor wants one, requires --skipLibCheck per
#    AGENTS.md due to pre-existing astro/starlight lib errors:
#    bunx astro check --skipLibCheck from packages/web — OPTIONAL, build is required)
bun run --cwd packages/web build
```

**Expected observations:** all exit 0 with no errors. If failures appear, do NOT fix code — see Step 4 (rollback guidance).

```powershell
# 6. Tests, from package dirs — NEVER root `bun run test` (blocked guard)
bun run --cwd packages/opencode test
bun run --cwd packages/ui test
bun run --cwd packages/core test
bun run --cwd packages/app test:unit
```

**Expected observations:** same pass/fail set as the pre-change baseline. Known pre-existing flakes (documented in AGENTS.md — permission `reply - reject…`, `usage.characterization.test.ts:76`, `ModelsDev Service > get()…`, `session.system > skills output is sorted…`) are NOT regressions; isolate any new failure with `bun test <file>` to attribute it before rolling back a bump. Order-dependent failures: if a test passes in isolation but fails in the suite, check AGENTS.md Known Issues before attributing it to a bump. `packages/app` `test:unit` is INCLUDED deliberately: it exercises the `@tsconfig/bun` and catalog-type consumers in app and is fast (happydom-preloaded unit tests); if the executor finds it slow or environmentally broken on their box, exclusion must be justified in the executor summary (a real baseline comparison is the fallback).

```powershell
# 7. Re-run the report-only check and compare against the Step 0 baseline
bun run script/check-updates.ts
```

**Expected observations:**
- **Every Tier 0/Tier 1 target NO LONGER appears as upgradable, EXCEPT `@aws-sdk/client-s3` and `@aws-sdk/credential-providers`**, which are EXPECTED to remain flagged if the registry has advanced to `3.1139.0` while the approved target is `3.1138.0` — **a pre-approved remainder, NOT a failure** (Step 0 / Open Question Q3).
- **Surviving `⚠ [divergence]` stderr lines, by design (do NOT misread as failure):**
  - `⚠ [divergence] @npmcli/arborist` — catalog `9.4.0` vs `packages/core` `9.9.2` (D2, persists)
  - `⚠ [divergence] dompurify` — catalog `3.3.1` vs `packages/ui` `3.4.16` (D3, persists)
  - (`@tsconfig/bun` divergence RESOLVES via D1 — it must NOT appear post-execution; if it does, the app bump was missed)
- **NO `⚠ [patch-mismatch]` for `solid-js`** — solid-js was not bumped, catalog and patch key still agree at 1.9.10. Its presence would mean the executor bumped solid-js against this plan.
- No RISKY-set package changed its reported state (their current pins must be identical to the Step 0 baseline — e.g. effect still `4.0.0-beta.65`, opentui still `0.2.16`, solid-js still `1.9.10`).

```powershell
# 8. Lint (oxlint 1.78.0 → 1.85.0 is a self-tooling bump — make sure the new linter version passes on the repo it runs on)
bun run lint
```

**Expected observations:** no new lint errors vs baseline (new oxlint versions occasionally add default rules — if new errors appear and they are rule-default changes, revert the oxlint bump alone and report).

### Step 4 — Rollback guidance (per-single-bump isolation, NOT batch revert)

If a bump breaks typecheck/tests:
1. **Attribute first:** `git stash` all manifest edits, confirm the baseline is green, then re-apply bumps in halves (or bisect individual packages) to identify the breaking single bump.
2. **Revert that SINGLE package:** restore only that one version token (e.g. edit that one line back to `from`), run `bun install`, delete `packages/app/node_modules/.ts-dist` again, re-run the failing verification. Alternative for a full-file revert: `git checkout -- <file>` + `bun install` (only if that file has no other intended bumps).
3. **Report, don't fix:** note the reverted package + failure mode in the executor summary. Do NOT patch code, do NOT add `@ts-expect-error`, do NOT change config to accommodate.
4. If the breaking bump is in the catalog and consumed by multiple packages (e.g. `@types/bun`), reverting the catalog line reverts it for all consumers at once — that's fine and expected. (`solid-js` is not in the batch, so its multi-consumer case does not arise here.)

## Verification plan

Covered in Step 3 (exact commands + expected observations). Additional structural checks:

- `git diff --stat` must show exactly: 6 `package.json` files + `bun.lock` + `_plan/index.md`. Zero source files. Zero `patches/` changes. Zero `patchedDependencies` changes.
- `bun.lock` diff audit completed per Step 2 (including the named `ghostty-web#main` drift exception).
- Final `check-updates.ts` report reviewed against the Step 0 recorded baseline, with the AWS remainder and D2/D3 divergences accounted for per the expected observations.

## Risks

- **`@types/bun` 1.3.12 → 1.4.2 (HIGH-attention):** types a newer Bun than the pinned runtime (`packageManager: bun@1.3.14`, `package.json:7`). API typings may reference runtime APIs that 1.3.14 lacks (types drift ahead of runtime). This is a types-only bump — no runtime change — but can surface TS errors in opencode/core. If typecheck fails in Bun-API-typed code, revert `@types/bun` alone. Note the root `overrides` block (`package.json:129`) pins `@types/bun: "catalog:"` so the catalog edit propagates everywhere consistently.
- **`turbo` 2.10.12 → 2.11.3:** build-orchestrator bump; a minor-series jump in turbo's own versioning. Risk: turbo task-graph/config behavior changes. Mitigation: turbo only runs `typecheck` tasks here; Step 3's typechecks are the direct validator. If turbo misbehaves, revert and run the per-package typechecks directly for the rest of verification.
- **`oxlint` 1.78.0 → 1.85.0:** new default rules possible across 7 minor versions. Mitigation: `bun run lint` in Step 3; revert alone if new rule-default errors appear.
- **`@aws-sdk/client-s3` + `@aws-sdk/credential-providers` 3.1110.0 → 3.1138.0 (lockstep, with known remainder):** same-service minors; these two MUST stay in lockstep (bump both or neither). Root + opencode both consume; typecheck covers. The `3.1138.0` target leaves them flagged in the report (pre-approved remainder, Q3).
- **`@cloudflare/workers-types` 4.20251008.0 → 4.20260702.1:** date-based version ≈ 8 months of Cloudflare API type evolution; a larger-than-usual types jump. Consumers are app/web type surfaces; typecheck + web build cover.
- **`@npmcli/arborist` 9.9.1 → 9.9.2 in core:** patch bump of a heavy dependency-tree resolver; covered by core typecheck + test (Step 3, commands 4 and 6).
- **Lockfile churn:** known `bun install` noise, mitigated by the hunk-audit discipline (Step 2); the `ghostty-web#main` `github:` drift is explicitly named as accepted noise (Step 2.5).

## Open questions

- **Q1 (human, post-execution):** Catalog entries `@npmcli/arborist` (9.4.0, unused by any `catalog:` ref) and `dompurify` (3.3.1, unused) are dead-or-divergent catalog rows. Recommend a follow-up hygiene plan: either bump-and-align or delete the unused entries. Not this plan.
- **Q2 (human, post-execution):** `vscode-languageserver-types` is pinned identically in two manifests — candidate for catalog consolidation. Not this plan.
- **Q3 (human, pre/during-execution — AWS remainder):** The registry in-channel latest for both AWS packages is `3.1139.0` today, while the approved target is `3.1138.0`. If a fully-clean upgradable list is desired, bump BOTH AWS packages to the registry latest (`3.1139.0` today) instead of `3.1138.0` — at execution the executor must use whichever value matches the approved intent, and MUST keep the two AWS packages in lockstep regardless of which value is chosen. The default encoded in this plan is the user-approved `3.1138.0`, with the remainder accepted.

## Deliberately deferred (with reasons)

- **`solid-js` 1.9.10 → 1.9.15** — DROPPED from this batch (review CRITICAL 1). A dedicated follow-up plan must own the full coupling, with this required scope: (a) re-key the root `patchedDependencies` entry to `solid-js@<newVersion>` **BEFORE** `bun install` (Bun matches the patch to the installed version by the KEY, not by filename); (b) do **NOT** rename the patch file `patches/solid-js@1.9.10.patch` — keep the filename, change only the key, and verify Bun still resolves it (add a follow-up check that the patch file path remains valid or, if Bun requires the filename to track the key on this Bun version, that finding must be documented in the follow-up plan before execution); (c) re-run typecheck/tests **with the patch active** — the patch changes Solid `Transition` runtime semantics (issue #2046), so verification against an un-patched install is invalid; (d) include an explicit **patch-applied assertion**: after `bun install`, grep the installed `node_modules/solid-js/dist/solid.js` for a line specific to the patch to prove it actually applied (Bun silently ignores version-mismatched keys with exit 0 — proven on this box, Bun 1.4.2 — so the absence of warnings proves nothing).
- **All 111-minus-~30 remaining upgradable deps** — the risky set is out of scope by user decision; individual future plans required for each risky family (opentui, effect, drizzle, vite/typescript, sentry, astro, etc.).
- **D2/D3 divergence resolution** — requires non-approved minor jumps; documented for follow-up (Q1).
- **`patchedDependencies` auto-rewrite tooling** — the check-updates-hardening plan deferred this (its Q2); the solid-js follow-up plan (above) is the first consumer of a manual re-key flow; tooling only if more patched deps need bumps later.
- **`github/package.json` bumps** — outside the workspace; standalone action, separate decision.
- **Catalog consolidation for `vscode-languageserver-types`** — future hygiene plan (Q2).
