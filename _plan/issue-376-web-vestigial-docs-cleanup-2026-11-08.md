# Issue #376 — [web] Remove vestigial /docs middleware, dead sidebar config, stale artifacts

> **PLANNING ONLY** — no code changes. Branch `issue-376-web-vestigial-docs-cleanup` is already checked out.
> Every file:line anchor below was re-verified against the tree (2026-11-09); corrections vs. the issue are listed in **Anchor re-verification**.

## 1. Goal

Remove dead/vestigial artifacts in `packages/web` (plus the `sst-env.d.ts` leftovers in `packages/web` and `packages/app`) that no longer match the live site surface: a middleware that only fires on nonexistent `/docs` routes, dead header config, ghost-locale sidebar translations, stale `robots.txt` disallows, a doubly-disabled locale-sync workflow, and lint/config leftovers. **No change to docs content or URL routing** (site = Starlight docs at `/` + `/tr/`, deployed by `pages.yml` on `main`); the only live-surface changes are deliberate — the sidebar gains a Share entry (AC2) and `robots.txt` becomes permissive so the live `/share/` docs page is crawlable (AC3). Everything else is dead-code removal.

## 2. Steps

### AC1 — middleware + locales.ts + headerLinks → **CHOSEN: REMOVE** (not restore `/docs`)

1. **Delete `packages/web/src/middleware.ts`** (94 lines).
   Why safe: only acts on `/docs*` (alias regex `:5`, early-return gate `:86`, redirects `:93`); no `/docs` routes exist (`src/pages/` does not exist — `b1f0759f23` deleted `s/[id].astro`, `f3c1867c22` deleted the last file `[...slug].md.ts`); `oc_locale` / `accept-language` have no references within `packages/web` outside this file (repo-wide, the only other `oc_locale` hit is the unrelated cookie writer in `packages/app/src/context/language.tsx:33`).
2. **Delete `packages/web/src/i18n/locales.ts`** — imported only by `middleware.ts:2` (repo grep; the only other mention is prose in `packages/web/AGENTS.md:31`).
3. **Edit `packages/web/AGENTS.md:31`** — exact-string replacement (doc-integrity rule: a stale file reference propagates into agent behavior; the rest of the line stays byte-identical):
   - **Remove:** ``locale routing (`src/i18n/locales.ts`) declares only `root` + `tr`.``
   - **Replace with:** ``only `root` + `tr` locales are configured (`astro.config.mjs`).``
   - Resulting sentence: ``Docs ship in English (root) and Turkish (`content/docs/tr/`); only `root` + `tr` locales are configured (`astro.config.mjs`).``
4. **`packages/web/config.mjs:5-8`** — remove the entire `headerLinks` array (4 lines). Keep `url` / `base` / `github` — they are live (consumed by `astro.config.mjs:11-12,73-74`, `content/docs/{server,sdk}.mdx:6`, and their `tr/` mirrors `content/docs/tr/{server,sdk}.mdx:6`).
5. **Remove `app.header.home` + `app.header.docs`** from `packages/web/src/content/i18n/en.json:3-4` **and** `tr.json:3-4` (2 lines each). Zero consumers repo-wide (grep: only the JSONs and the now-deleted `headerLinks` entries); `content.config.ts:5-7` derives its custom schema from `en.json` keys, so edit both files together; both JSON files stay (en.json is imported).

Why NOT restore a `/docs` URL shape: the site *is* the docs (Starlight serves content at `/` + `/tr/` via `locales` at `astro.config.mjs:31-42`); en/tr negotiation is already handled natively (`Lander.astro:2-5` uses `astro:i18n` `getRelativeLocaleUrl`). Restoring `/docs` would re-introduce a route structure deliberately deleted in the fork — more explanation, more code, no user.

### AC2 — sidebar matches disk

6. **`packages/web/astro.config.mjs:137`** — add `"share"` to the Usage group:
   `items: ["tui", "cli", "web", "ide", "github", "gitlab", "share"]`
   **CHOSEN: add `share.mdx` to the sidebar** (not delete). Its content documents the live share feature and the **external** `opncd.ai` viewer (`src/content/docs/share.mdx:6,20`), independent of the local viewer route #374 removes. Both `share/` and `tr/share/` pages are already built and reachable by URL (verified: `dist/share/index.html`, `dist/tr/share/index.html`, `.astro/data-store.json` registers `share`) — the sidebar entry adds nav discoverability, not reachability. Verified: sidebar has 30 slugs vs 31 root mdx files — `share` is the **only** gap (root index is covered by the `""` entry at `:86`).
7. **Prune ghost-locale keys** in the four sidebar `translations` maps — keep only `en` + `tr-TR`, delete the other **16** keys per map:

   | Map | `translations: {` | keep `en` | keep `tr-TR` | delete (ghost) lines |
   |---|---|---|---|---|
   | Windows | `:93` | `:94` | `:109` | `:95-108`, `:110-111` |
   | Usage | `:117` | `:118` | `:133` | `:119-132`, `:134-135` |
   | Configure | `:142` | `:143` | `:158` | `:144-157`, `:159-160` |
   | Develop | `:182` | `:183` | `:198` | `:184-197`, `:199-200` |

   Ghost keys (×16): `ar, bs-BA, da-DK, de-DE, es-ES, fr-FR, it-IT, ja-JP, ko-KR, nb-NO, pl-PL, pt-BR, ru-RU, th-TH, zh-CN, zh-TW`.
   **Keys must be `en` + `tr-TR`, not `tr`**: Starlight resolves sidebar labels via `pickLang(map, localeToLang(locale))` — an exact lang-code match (`en` for root, `tr-TR` for `tr`), verified in the installed `@astrojs/starlight@0.42.5` (`dist/utils/i18n.js:137-139`, `dist/utils/slugs.js:28-32`). Only `root` + `tr` exist on disk; ghost locale dirs were deleted in `10f62c2c05 docs(web): keep English and Turkish only` but these maps were left behind.

### AC3 — robots.txt

8. **`packages/web/public/robots.txt`** — delete lines 4-6 (comment + both `Disallow`s). Result:
   ```
   User-agent: *
   Allow: /
   ```
   - `Disallow: /s/` — `/s/` belonged to `src/pages/s/[id].astro` (deleted `b1f0759f23`); no such route exists now.
   - `Disallow: /share/` — **wrong today**: Starlight builds a route for *every* docs entry regardless of sidebar membership, so the share docs page at `/share/` is live (empirical: `packages/web/dist/share/index.html` + `dist/tr/share/index.html` exist, dist newer than `share.mdx`, content contains `opncd.ai`; `.astro/data-store.json` registers `share`). The deployed disallow actively blocks this live docs page from crawlers — dropping it makes `/share/` crawlable. (The external viewer itself lives on `opncd.ai`, a different origin with its own robots.)

### AC4 — docs-locale-sync workflow → **CHOSEN: DELETE** (not re-enable)

9. **Delete `.github/workflows/docs-locale-sync.yml`** (100 lines). Grounds:
   - `:6` triggers on branch `dev` — origin's default branch is `main` (`git symbolic-ref refs/remotes/origin/HEAD` → `refs/remotes/origin/main`; `gh repo view` → `main`), and origin has no `dev` branch (`dev` exists only as `remotes/upstream/dev`).
   - `:12` `if: false` — job permanently disabled; `:13` shows the real guard was commented out.
   - `:80` references `.opencode/agent/translator.md` — **does not exist** (`.opencode/agent/` contains only `triage.md`, `duplicate-pr.md`).
   - No other locale-sync mechanism under `.github/` (grep `translator|locale` → only this file).
   - EN↔TR sync is manual by convention (`packages/web/AGENTS.md` mirror discipline).

   Re-enable alternative rejected: would first require restoring the missing agent file, the upstream runner label (`blacksmith-4vcpu-ubuntu-2404`), and `OPENCODE_*` secrets — and manual sync is the established practice anyway.

### AC5 — lint/config leftovers

10. **Root `.oxlintrc.json`** (the only one repo-wide — `packages/web/.oxlintrc.json` does not exist) — delete the duplicate `"options"` blocks at lines 44-49; keep the one at lines 3-5. All three are byte-identical (`{"typeAware": true}`) → zero behavior change.
11. **Delete `packages/web/sst-env.d.ts`** — no `import "sst"` consumer in `packages/web` (only the file itself); no `import.meta.env` usage in the package (grep = 0); SST's deploy of web (`infra/app.ts:52-60`) is already broken in this fork (`infra/app.ts:15` → deleted `packages/function/`) and `.github/workflows/deploy.yml` fires only on `dev`/`production` (fork deploys docs via `pages.yml` on `main`).
12. **Delete `packages/app/sst-env.d.ts`** (package root) — outside `packages/app/tsconfig.json` `include: ["src", "package.json"]`, so it is never compiled; nothing references it.
13. **`packages/app/src/sst-env.d.ts` → CHOSEN: relocate then delete.** Its only real payload is `/// <reference types="vite/client" />`; its `ImportMetaEnv`/`ImportMeta` declarations are empty duplicates of `src/env.d.ts`.
    - Add `/// <reference types="vite/client" />` as line 1 of **`packages/app/src/env.d.ts`**, then delete `src/sst-env.d.ts`.
    - `vite/client` types `import.meta.env.DEV/.MODE` plus the index signature used at ~20 sites (`entry.tsx:104,137-141`, `layout.tsx:2433`, `titlebar.tsx:93`, `command.tsx:262`, …); `VITE_*` keys stay in `env.d.ts`. Merged type surface after the move is identical to today.

## 3. Architecture Decisions

| AC | Chosen option | Rationale (verified) | Rejected alternatives |
|---|---|---|---|
| 1 | **REMOVE** middleware + locales.ts + headerLinks (+ orphaned `app.header.*` keys) | Middleware can never fire (no `/docs` routes); `locales.ts` has exactly one importer; `headerLinks` zero consumers; least-surprise = delete dead code | Restore `/docs` shape — invents a deleted route structure; Starlight already handles en/tr |
| 2a | **ADD** `share` to sidebar Usage group | `share.mdx` documents a live feature + external `opncd.ai` viewer; `tr/` mirror exists | Delete `share.mdx` (content is accurate); leave gap (AC demands disk↔sidebar match) |
| 2b | Prune maps to **`en` + `tr-TR`** | Starlight `pickLang` matches exact lang codes; only `root`/`tr` configured | Keep `tr` key (never matches); keep all keys (AC5-style dead config) |
| 3 | **DELETE** robots.txt lines 4-6 (comment + both disallows) | `/share/` is a **live** docs page (Starlight routes every entry; `dist/share/index.html` + `.astro/data-store.json` evidence) that the current disallow blocks from crawlers; `/s/` belonged to deleted `src/pages/s/[id].astro` | Keep the disallows (leaves a live page blocked from crawlers); drop only `/s/` (keeps the wrong `/share/` rule) |
| 4 | **DELETE** workflow | 3 independent blockers (branch, `if: false`, missing agent file); manual sync is convention | Re-enable on `main` — needs agent file + runner + secrets restored first |
| 5 | Delete web/app-root sst-env; **relocate `vite/client`** then delete `app/src/sst-env` | Files are SST-authored leftovers; app-root file isn't even in the tsconfig; relocating preserves `import.meta.env` typing at zero type-surface cost | Keep `app/src/sst-env.d.ts` (leaves an SST artifact AC asks to remove); hand-add `DEV`/`MODE` to `env.d.ts` (more churn than a reference line) |

**Trade-offs / notes**
- Deleting `src/middleware.ts` leaves the project with no user middleware — safe: Starlight injects its own via `addMiddleware` in `astro:config:setup` (`@astrojs/starlight/dist/index.js:22,33`), so `Astro.locals.starlightRoute` (`Header.astro:3`) and `Astro.locals.t` (`Footer.astro:8`, `Head.astro:9`) keep working.
- `sst-env.d.ts` files are marked *auto-generated by SST*; a future local `sst deploy`/`sst dev` may regenerate them — acceptable (deploy path is broken here anyway); just re-delete if noticed.
- i18n keys `share.*` (~47) and `app.lander.*` (~20) in `en.json`/`tr.json` are **also** dead (share messages were props from the deleted share page; `Lander.astro` was fork-hardcoded) — intentionally left, see Out of scope.

## 4. Verification

Run from repo root (pwsh); `bun install` first if deps are stale.

1. `bun run lint` — root oxlint; confirms `.oxlintrc.json` still parses after dedupe (also `rg ": error " <lint output>`).
2. `bun run --cwd packages/web astro check` — run **before** edits for a baseline, then after. `@astrojs/check` is already a devDep; web has **no** turbo `typecheck` script, so this is its only type gate.
3. `bun run --cwd packages/web build` — mirrors `pages.yml:46`. (CI first runs the `script/schema.ts` step to generate `public/config.json` and `public/tui.json` — both gitignored (`.gitignore:56-57`), while `public/theme.json` is tracked; not required for the build itself, only for deployed runtime.)
4. `Remove-Item packages/app/node_modules/.ts-dist/tsconfig.tsbuildinfo; bun typecheck` from `packages/app` — covers the `src/sst-env.d.ts` → `env.d.ts` move (`tsgo -b` caches aggressively; stale build-info can mask errors).
5. Root `bun typecheck` — the pre-push hook runs this across all packages.
6. Grep gates (expect no hits outside intended prose): `rg -n "middleware|locales\.ts|headerLinks|app\.header|oc_locale|accept-language" packages/web`.
7. Build-output spot check: `packages/web/dist/` contains `index.html` + `tr/index.html`, no `docs/` path, and `robots.txt` is the 2-line version.

**Typecheck implications:** `packages/web` is outside turbo typecheck (no script) — `astro check` is manual and not in CI; `packages/app` is covered (`tsgo -b`); oxlint runs from root. GitNexus note for the Code stage: verify the index is fresh (`list_repos`) before running `impact`/`detect_changes` per repo rules — deleting `middleware.ts` should show zero upstream callers.

## Out of scope (intentional)

- **`packages/web/src/components/share/content-diff.tsx:199-240`** (commented fixture, file ends at 240) — the share component tree belongs to **issue #374** (orphaned share viewer); if #374 deletes the file, this dies with it. Only touch if #374 is closed without removing the tree.
- Dead i18n keys beyond `app.header.*`: `share.*` + `app.lander.*` in `en.json`/`tr.json` — `share.*` coordinates with #374; `app.lander.*` is a separate cleanup.
- Other packages' `sst-env.d.ts` (`ui`, `storybook`, `sdk/js`, `script`, `plugin`, `opencode`, `core`, `github/`) and root `sst-env.d.ts` / `sst.config.ts` / `infra/` / `deploy.yml` — AC5 names only `packages/web` + `packages/app`. (Fork-wide SST vestigial-ness = its own issue.)
- `.oxlintrc.json` `ignorePatterns` `"**/.sst"` — harmless, not in AC.
- Supplementary `_plan/webui-review-findings-2026-11-08.md` (W-6/W-7/W-9/W-10 context) — **exists and was read** (11,727 bytes, mtime 2026-11-08, predating this plan's re-verification). Its findings corroborate this plan: W-6 (vestigial middleware/`locales.ts`/`headerLinks`), W-7 (`share.mdx` sidebar gap + ghost locale maps — its "14 locales" count is corrected here to **16** ghost keys), W-9 (stale `robots.txt` + double-disabled workflow), W-10 (`content-diff.tsx` fixture, `sst-env.d.ts`, oxlintrc `options` triplication). No conflicts with this plan's AC choices.

## Anchor re-verification (issue claim → tree)

| Issue claim | Status |
|---|---|
| `src/middleware.ts:81-93` | **Corrected:** `onRequest` spans **:80-94** (file is 94 lines); `/docs` gate at `:86`, alias regex at `:5` |
| `locales.ts` imported only by `middleware.ts:2` | ✓ (repo grep) |
| `config.mjs:5-8` headerLinks zero consumers | ✓ (repo grep = 1 hit, the definition) |
| `astro.config.mjs:85-204` sidebar | ✓ (`:85` `[`, `:204` `]`) |
| `content/docs/share.mdx` | Path is **`packages/web/src/content/docs/share.mdx`** (+ `tr/share.mdx` mirror) |
| share = only nav gap | ✓ 30 sidebar slugs vs 31 root mdx files |
| sidebar maps "14 locales" | **Corrected: 16 ghost keys** per map (18 total incl. `en`, `tr-TR`) |
| `public/robots.txt:5-6` | ✓ (`:5` `/s/`, `:6` `/share/`; comment `:4`) |
| workflow `:6` dev + `:12` `if: false` | ✓ |
| `.oxlintrc.json` options @ 3, 44, 47 | ✓ (identical values) |
| `src/pages/` deleted in `b1f0759f23` / `f3c1867c22` | ✓ refined: `b1f0759f23` **D** `s/[id].astro` (M `[...slug].md.ts`); `f3c1867c22` **D** `[...slug].md.ts` → `src/pages/` no longer exists |
| Review-pass: `Head.astro` `Astro.locals.t` anchor | **Corrected:** `Head.astro:9` (plan cited `:10`); `Footer.astro:8` unchanged |
| Review-pass: `infra/app.ts` Astro block | Re-verified at **`:52-60`** (`new sst.cloudflare.x.Astro` @52, closing `})` @60); suggested `:50-58` misreads the Worker close at `:50`. `handler:` at `:15` ✓ — plan's `:52-60` kept as-is |
| `content-diff.tsx:199-240` | ✓ (fixture `:199-240`, file ends `:240`) |
| `sst-env.d.ts` in web + app | ✓ found **3** files: `packages/web/`, `packages/app/` root, `packages/app/src/` |
| `_plan/webui-review-findings-2026-11-08.md` | ✓ exists (11,727 bytes, mtime 2026-11-08); read in full — W-6/W-7/W-9/W-10 corroborate this plan (W-7's "14 locales" corrected here to 16 ghost keys) |

## Open Questions

1. **Sidebar slot for `share`:** chose the Usage group (last position, `:137`). Alternative: top-level entry after `troubleshooting`. Reviewer preference welcome — Usage chosen because share is a user-facing feature alongside `web`/`ide`/`github`.
2. **Dead i18n purge:** should `share.*`/`app.lander.*` keys be swept in this PR? Recommended **no** (see Out of scope) — flag if the issue author wants them.
