# Plan: [web] Add typecheck gate (astro check) to packages/web — issue #375

- **Date:** 2026-11-08
- **Issue:** ozgurulukir/opencode-personal#375
- **Branch:** `issue-375-web-typecheck-gate`
- **Status:** APPROVED
- **Depends on / interacts with:** PR #374 (deletes orphaned share-viewer tree), PR #376 (vestigial docs cleanup)

---

## 1. Goal

`packages/web` has no typecheck gate: no `typecheck` script, orphaned `@astrojs/check` devDep, CI builds without checking types, and `bun turbo typecheck` / husky pre-push skip the package. Web type errors ship silently.

**Goal:** wire `astro check` into the package script, the turbo pipeline (automatic), pre-push, and CI — while (a) fixing the 5 real pre-existing non-share errors and (b) explicitly waiving the 25 share-tree errors that PR #374 will delete.

---

## 2. Ground truth (verified 2026-11-08 on this branch)

### 2.1 Actual `bunx astro check` result (from `packages/web`)

**30 errors, 0 warnings** across 36 files, split:

| Bucket | File(s) | Count | Fate |
| --- | --- | --- | --- |
| Share tree (waive) | `src/components/Share.tsx` | 21 | Deleted by #374 |
| Share tree (waive) | `src/components/share/part.tsx` | 4 | Deleted by #374 |
| Non-share (fix) | `src/components/Footer.astro` | 2 (lines 2, 9) | Fix in this issue |
| Non-share (fix) | `src/components/SiteTitle.astro` | 1 (line 3) | Fix in this issue |
| Non-share (fix) | `src/components/Head.astro` | 1 (line 11) | Fix in this issue |
| Non-share (fix) | `src/components/Hero.astro` | 1 (line 5) | Fix in this issue |

> **Correction to issue narrative:** the issue/PR-#376 note said errors are "all localized in Share.tsx and part.tsx (+ possibly astro templates)". Empirically there are **exactly 5 non-share errors in 4 Starlight override components**. Those are NOT covered by #374's deletion and MUST be fixed here (AC4).

Share-tree errors are V1-shape drift against current SDK types (`PartID` brands, `MessageWithParts.tokens/cost/providerID/modelID/path`, `ToolState.title`, missing `opencode/session/index` module resolution) — classic dead-code rot. Confirmed: **nothing outside `src/components/share/` + `Share.tsx` imports the share tree** (grep: only intra-tree imports; no `src/pages/` exists — Starlight routes come from `content/docs/`). The tree is fully orphaned.

### 2.2 Anchor re-verification (all issue citations confirmed)

| Citation | Verified |
| --- | --- |
| `packages/web/package.json:6-12` — scripts are only `dev/start/build/preview/astro` | ✅ lines 6–12 |
| `packages/web/package.json:35` — `@astrojs/check` devDep, unreferenced | ✅ line 35 |
| `.github/workflows/pages.yml:46` — `bun run --cwd packages/web build` only | ✅ line 46 |
| Root `bun turbo typecheck` skips web | ✅ turbo runs `typecheck` only where the script exists; web has none |
| Husky pre-push runs `bun typecheck` → `bun turbo typecheck` | ✅ `.husky/pre-push:22` |

### 2.3 Turbo pipeline — NO turbo.json change needed

Root `turbo.json:6` already declares a generic task:

```json
"typecheck": {}
```

Turbo's default behavior: run the task in every workspace package that defines a matching script. The other 7 packages (`opencode`, `core`, `sdk/js`, `ui`, `app`, `plugin`, root) each declare `"typecheck": ...`. **Adding the script to `packages/web/package.json` is sufficient** — no pipeline entry, no filter, no dependsOn needed (web typecheck has no build deps: all `diff-wasm`/`opencode` imports live only inside the waived share tree).

Root `package.json:13` → `"typecheck": "bun turbo typecheck"` (no `--filter`), so root turbo picks web up automatically. Pre-push (`.husky/pre-push:22` → `bun typecheck`) inherits this. CI jobs `ci.yml:19` and `typecheck.yml:24` also call `bun typecheck` and inherit it.

### 2.4 `astro check` capabilities (verified via `--help` on `@astrojs/check` 0.9.12)

- `--minimumFailingSeverity error|warning|hint` — **default is already `error`**. All 30 diagnostics are errors, so severity gating alone cannot waive them (rules out option (b)-severity and the issue's `--minimumFailingSeverity` suggestion as a waiver).
- No CLI exclude flag.
- **tsconfig `exclude` IS respected** — empirically proven (see §2.5).
- Repo AGENTS.md's `--skipLibCheck` note for web is **stale for this path**: plain `astro check` reports zero `node_modules` lib errors; all 30 are project files. No `--skipLibCheck` needed.

### 2.5 Empirical probes (all run, then reverted — working tree clean)

**Probe A — tsconfig exclude silences share errors:**
`astro check --tsconfig` with `exclude: ["dist", "src/components/Share.tsx", "src/components/share/**"]` → **26 files, 5 errors** (share gone; only the 4 astro components remain). Excluded `.tsx` files are not pulled back in via imports (tree is orphaned).

**Probe B — typing `virtual:starlight/user-config`:**
Adding an ambient declaration exporting the real `StarlightConfig` clears `Footer.astro:2`, `Footer.astro:9` (implicit-any cascade), and `SiteTitle.astro:3`. A structural/loose type instead re-introduces errors in `SiteTitle.astro` (logo union narrowing) and `Footer.astro:28` (`StarlightIcon` mismatch) — **must use the real `StarlightConfig` type**.

**Probe C — full fix set → 0 errors:**
With (B) + Head/Hero `route.id` + Footer `github?.href` + Probe A exclude: **`Result (26 files): 0 errors, 0 warnings, 0 hints`.**

**Bonus finding — latent runtime bug exposed by typing:** `Footer.astro:36` reads `config.github`, but `github` is a field of the *site* config (`config.mjs`), not of Starlight's user-config. At runtime `config.github` is `undefined` (the "Source on GitHub" href is broken today). Typing surfaces this as TS2339. Fix: reuse the already-found social link (`github?.href` from line 9 — same URL as `config.mjs.github`).

---

## 3. Chosen approach (options weighed)

| Option | Verdict |
| --- | --- |
| **(a) Fix all 30 errors** | ❌ Wasteful: 25 die with #374; fixing V1→V2 shape drift in dead code is throwaway work. |
| **(b) Waive everything** (severity flag / blanket ignore) | ❌ Too broad: would also waive the 5 real errors in live Starlight overrides; `--minimumFailingSeverity` cannot help (all errors are severity `error`). |
| **(c) Hybrid — fix 5 real + exclude share tree** | ✅ **CHOSEN.** Gate is green today, catches NEW errors everywhere including non-share files, and the waiver is a single commented `exclude` block that #374's follow-up deletes. |

**Waiver mechanism:** `tsconfig.json` `exclude` + JSONC comment naming issue #374. Verified respected by `astro check`; scoped only to the two orphaned paths; does not weaken the gate for any live file.

---

## 4. Exact changes

### 4.1 `packages/web/package.json` — add script (AC1)

```json
"scripts": {
  "dev": "astro dev",
  "start": "astro dev",
  "build": "astro build",
  "preview": "astro preview",
  "astro": "astro",
  "typecheck": "astro check"
},
```

- Plain `astro check` (default `--minimumFailingSeverity error` already matches the gate intent).
- `@astrojs/check` (line 35) stops being orphaned — it is what powers `astro check`.
- **No turbo.json edit** (§2.3).

### 4.2 `packages/web/tsconfig.json` — waive share tree (AC4 waiver)

```jsonc
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  // WAIVER (issue #375 / AC4): the orphaned share-viewer tree
  // (Share.tsx + share/) carries 25 pre-existing type errors from V1-shape
  // drift. It has zero live imports and PR #374 deletes it wholesale —
  // do NOT fix; exclude until #374 merges, then delete these two patterns.
  "exclude": ["dist", "src/components/Share.tsx", "src/components/share/**"],
  "compilerOptions": {
    "jsx": "preserve",
    "jsxImportSource": "solid-js"
  }
}
```

### 4.3 `packages/web/src/types/starlight-virtual.d.ts` — declare `virtual:starlight/user-config` (AC4 fix)

Append alongside the existing `user-images` declaration (keep the file a pure ambient script — no top-level imports; import *inside* `declare module`):

```ts
declare module "virtual:starlight/user-config" {
  import type { StarlightConfig } from "@astrojs/starlight/types"
  const config: StarlightConfig
  export default config
}
```

> Do **not** use a structural/loose type — Probe B showed it re-breaks `SiteTitle.astro` (logo union) and `Footer.astro` (`StarlightIcon`). `@astrojs/starlight/types` → `dist/types.d.ts` re-exports `StarlightConfig` (verified in package exports map).

### 4.4 `packages/web/src/components/Footer.astro` — line 36 `config.github` fix (AC4)

- **Line 2** — fixed by §4.3 (no edit).
- **Line 9** — fixed by §4.3 typing `config.social` (no edit).
- **Line 36** — replace broken `config.github` (property does not exist on Starlight config; `undefined` at runtime):

```astro
<!-- before -->
<p><a target="_blank" rel="noopener noreferrer" href={config.github}>Personal fork · Source on GitHub</a></p>
<!-- after -->
<p><a target="_blank" rel="noopener noreferrer" href={github?.href}>Personal fork · Source on GitHub</a></p>
```

`github` is already `config.social?.find((item) => item.icon === "github")` at line 9; its `href` is site `config.mjs.github` — same URL, and it fixes the currently-broken href.

### 4.5 `packages/web/src/components/Head.astro:11` — `slug` → `route.id` (AC4)

```astro
// before
const isHome = Astro.locals.starlightRoute.entry.slug === ""
// after
const isHome = Astro.locals.starlightRoute.id === ""
```

**Why `route.id`:** `StarlightDocsEntry` is `CollectionEntry<'docs'> & { filePath }` — Astro content-layer entries have `id`, not `slug`. Starlight's `Route` documents `id` as "The slug" and normalizes `index` → `""` (`normalizeIndexSlug` in `@astrojs/starlight/dist/utils/routing/index.js:13`), so `id === ""` is exactly the old `slug === ""` home check.

### 4.6 `packages/web/src/components/Hero.astro:5` — same reshape (AC4)

```astro
// before
const { slug } = Astro.locals.starlightRoute.entry;
// after
const { id: slug } = Astro.locals.starlightRoute;
```

Local name `slug` kept so the template (`slug === ""`) is untouched.

### 4.7 `.github/workflows/pages.yml` — typecheck before build (AC3)

Insert after `bun install --frozen-lockfile` (line 38) and before schema generation / build — typecheck needs neither `public/*.json` nor `dist`:

```yaml
      - run: bun install --frozen-lockfile
      - name: Typecheck web
        run: bun run --cwd packages/web typecheck
      - name: Generate JSON schemas
        # ... existing lines 39-45 ...
      - run: bun run --cwd packages/web build
```

**Already covered without edits (verify, don't touch):**
- `.github/workflows/ci.yml:19` — `bun typecheck` on push/PR to `main`/`dev` → turbo picks web up once the script exists. **This is the actual PR gate.**
- `.github/workflows/typecheck.yml:24` — same, but only triggers on `dev` (pre-existing quirk; out of scope).
- Husky pre-push — `bun typecheck` → includes web automatically.

`pages.yml` is deploy-time belt-and-suspenders (runs only on `main` after merge); adding it satisfies AC3 and catches the case where someone bypasses PR CI.

### 4.8 `packages/web/AGENTS.md` — short typecheck note (documentation)

Add a brief section (after the intro line):

```markdown
## Typecheck

`bun run typecheck` (= `astro check`) is wired into turbo, pre-push, and CI.
The `tsconfig.json` `exclude` waives the orphaned share tree
(`Share.tsx`, `share/`) pending #374 — do not add errors there; remove the
exclude patterns once #374 deletes those files.
```

---

## 5. Files touched (summary)

| File | Change |
| --- | --- |
| `packages/web/package.json` | + `"typecheck": "astro check"` |
| `packages/web/tsconfig.json` | `exclude` + waiver comment |
| `packages/web/src/types/starlight-virtual.d.ts` | + `virtual:starlight/user-config` ambient decl |
| `packages/web/src/components/Footer.astro` | line 36: `config.github` → `github?.href` |
| `packages/web/src/components/Head.astro` | line 11: `entry.slug` → `route.id` |
| `packages/web/src/components/Hero.astro` | line 5: `entry.slug` → `route.id` (destructure rename) |
| `.github/workflows/pages.yml` | + typecheck step before build |
| `packages/web/AGENTS.md` | + Typecheck section |

**Not touched:** root `turbo.json` (generic task already correct), root `package.json`, `.husky/pre-push`, `ci.yml`, `typecheck.yml`.

---

## 6. Verification steps (run in order)

```powershell
# 1. Package-level gate — expect "Result (N files): 0 errors"
cd packages/web
bun run typecheck          # == astro check

# 2. Turbo picks up web — expect @opencode-ai/web in task list / cache miss then pass
cd ..\..
bun turbo typecheck --filter=@opencode-ai/web
bun typecheck              # full monorepo; must stay green (other packages unchanged)

# 3. Gate actually fails on a NEW error (sanity: revert a fix temporarily, expect non-zero exit)
#    e.g. put `entry.slug` back in Head.astro → bun run typecheck → exit 1 → restore

# 4. Waiver is scoped: share files still excluded, non-share still checked
#    (confirmed by probe A/C: 26 files / 0 errors with full fix set)

# 5. Lint (leftover-import check)
bun run lint               # grep output for "no-unused-vars" on touched files

# 6. Optional runtime spot-check (Footer href fix)
bun run --cwd packages/web dev   # open a doc page footer → "Source on GitHub" link must resolve
```

CI verification: open a PR → `ci.yml` `typecheck` job must show `@opencode-ai/web` executing `astro check`. After merge, `pages.yml` runs the new `Typecheck web` step before build.

---

## 7. Follow-up after PR #374 merges (REQUIRED)

#374 deletes `src/components/Share.tsx` and `src/components/share/`. Then:

1. Remove `"src/components/Share.tsx"` and `"src/components/share/**"` from `tsconfig.json` `exclude` (leave `"dist"`) and delete the waiver comment.
2. Delete the Typecheck/§AGENTS.md waiver sentence (keep the typecheck how-to).
3. Optionally drop now-dead `opencode` / `@opencode-ai/diff-wasm` deps from `packages/web/package.json` if #374 doesn't already (they are only imported by the share tree).
4. Re-run `bun run typecheck` from `packages/web` — must still be 0 errors (the 5 fixes are independent of the share tree).
5. No turbo/CI changes needed for the follow-up.

**Merge-order note:** the plan is order-independent. If #374 lands first, the exclude patterns match nothing (harmless) and can be cleaned up opportunistically; the 5 non-share fixes are still required either way. If #375 lands first, the waiver is active until #374's follow-up.

---

## 8. Architecture decisions

| Decision | Rationale | Alternatives rejected |
| --- | --- | --- |
| Waiver = tsconfig `exclude` + comment | Empirically respected by `astro check`; JSONC allows the required explanatory comment (AC4); scoped to 2 orphaned paths; trivially deletable with #374 | Severity flag (can't waive errors); wrapper script that greps/baselines output (more code, brittle, violates "less is more"); fixing 25 dead-code errors (throwaway) |
| Fix 5 real errors now | They live in active Starlight overrides (`astro.config.mjs:205-211`); #374 does not touch them; gate must be green on main | Waiving them too (defeats the gate's purpose for live files) |
| `StarlightConfig` (real type) for ambient decl | SSOT against starlight; Probe B: structural types re-break SiteTitle/Footer | Hand-rolled structural type (probe-failed) |
| `route.id` for home detection | Starlight normalizes `index`→`""` on `Route.id`; same semantics as old `entry.slug === ""` | `entry.id` (equivalent for normal routes, but `route.id` is the documented slug); casting `as any` (banned) |
| `github?.href` for Footer repo link | Fixes latent runtime bug (`config.github` is undefined on Starlight config today); reuses line-9 lookup; same URL | Importing site `config.mjs` into Footer (extra coupling for one href); casting |
| Plain `astro check` script | Default `--minimumFailingSeverity` is already `error`; fewer knobs | Explicit flag (noise), `tsgo` (wrong tool for `.astro`) |
| No turbo.json change | Generic `"typecheck": {}` task + script-exists discovery is the monorepo convention used by 7 other packages | Package-scoped task entry (redundant) |
| pages.yml step after install, before schema gen | typecheck needs neither `public/*.json` nor `dist`; fails fast before the slower build | After build (wastes minutes on type errors) |

---

## 9. Open questions

1. **#374 merge timing** — if #374 is hours away, one could sequence #375 after it and skip the waiver entirely. The plan works either way (§7); prefer shipping the waiver now so the gate exists regardless of #374's review latency.
2. **`typecheck.yml` only triggers on `dev`** (pre-existing; `ci.yml` covers `main`/`dev` PRs). Out of scope for #375 — flagging as unrelated drift, not fixing here.
3. **`Footer.astro:36` runtime bug** — the `github?.href` fix changes rendered HTML (broken `href` → real URL). Intentional and covered by the type fix; mention in the PR description so reviewers don't treat it as unrelated scope creep.

---

## 10. Acceptance criteria mapping

| AC | How met |
| --- | --- |
| `"typecheck": "astro check"` in `packages/web/package.json` | §4.1 |
| `bun turbo typecheck` includes web | §4.1 + existing generic task (§2.3); verified by step 2 of §6 |
| CI runs typecheck (pages.yml) | §4.7; PR gate already covered by `ci.yml` unchanged |
| Pre-existing errors fixed or waived | 5 fixed (§4.3–4.6), 25 waived with comment (§4.2); verified 0 errors (Probe C, §6 step 1) |
