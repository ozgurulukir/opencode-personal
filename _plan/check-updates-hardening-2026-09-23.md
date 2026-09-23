# Plan: Harden `script/check-updates.ts` — catalog coverage, safe apply, prerelease policy, observability

**Date:** 2026-09-23
**Status:** ✅ EXECUTED (2026-09-23) — landed in `c25068d` (all R1–R7: catalog coverage, section-scoped `--apply`, same-channel prerelease policy, workspace scan boundary, `--check`/`--typecheck`); accepted in-plan deferrals (Q2 `patchedDependencies` rewrite, Q3 `script/tsconfig.json`) remain as documented scope decisions, not pending work.
**Provenance:** New plan. Scope fixed by the 2026-09-23 hardening request (7 verified findings, decisions R1–R7). Repo state at planning time: branch `main`, clean tree.

---

## Goal

Make the dependency-bump script (`script/check-updates.ts`, 246 lines, invoked as `bun run script/check-updates.ts [--apply [--install]]`) cover the monorepo's real version SSOTs (catalog, patchedDependencies), apply bumps surgically instead of via file-wide global regex, handle prereleases deliberately instead of accidentally, restrict its write boundary to workspace packages, and expose a CI-gateable exit signal. The change touches **only** `script/check-updates.ts`, a colocated test spec, and a 3-line `script/bunfig.toml` — no dependency versions change.

## Scope decision

**IN — R1 catalog scan + apply, R2 dead-code removal + field cleanup, R3 prerelease-channel policy (same-channel, never silently cross to stable), R4 surgical per-section apply with divergence pre-flight, R5 detect-only reporting for `overrides`/`patchedDependencies` (no `--apply` rewrite), R6 workspace-boundary scan (explicit, overridable), R7 bounded-concurrency fetch + abbreviated metadata + logged failures + `--check` exit signal.**

**OUT — `--install` behavior change: unchanged.** It already shells `bun install` and works.

**OUT — `overrides`/`patchedDependencies` `--apply` rewrite: DEFERRED.** Detection/reporting is cheap and closes the surprise gap; rewriting them under `--apply` needs patch-path regeneration (`patches/` filenames embed the version, e.g. `patches/solid-js@1.9.10.patch` at root `package.json:136`) and a Bun-patch-flow revalidation that is out of proportion for this pass. Until implemented, `--apply` must **warn and skip** these entries. Human decision needed for the later step (see Open Questions Q2).

**OUT — `resolutions` detection: DROPPED.** Rev 1 said "detect generically anyway, it's free" — it isn't free (another section-scoped report branch) and the key does not exist in this repo (verified: no `resolutions` in root `package.json`). Bun uses `overrides`; if a future Bun workspace ever adds `resolutions`, extend then.

**OUT — `.gitignore`-honoring file discovery: rejected.** Full gitignore parsing is disproportionate. R6 solves the same problem with an explicit workspace-package derivation (root + `workspaces.packages` glob expansion), which is deterministic and self-documenting.

## Verified anchors (all re-verified against the tree, 2026-09-23)

All in `script/check-updates.ts` unless noted:

- `findPackageJsonFiles(dir)` — `:28-38`; hardcoded skip list at `:33` (no `.gitignore` awareness, no `pkg` entry)
- `isPinned(version)` — `:41-43`; regex `^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$` at `:42` — char class `[a-zA-Z0-9.]` excludes `-`, so `1.0.0-beta.19-d95b7a4` does NOT match (silently skipped)
- `isReference(version)` — `:46-48` (skips `catalog:`, `workspace:`, `npm:`, `github:`, `file:`, `https:`)
- `parseSemver(v)` — `:51-55`; its prerelease capture `(?:-([a-zA-Z0-9.]+))?` has the SAME char-class gap as `isPinned` — it also fails on `1.0.0-beta.19-d95b7a4` (the `-` before `d95b7a4` falls outside the class), so hyphenated prereleases fail BOTH gates today. A2 widens both regexes.
- `fetchLatestVersion(name)` — `:58-69` — **dead code**, zero callers (grep-verified: only the definition matches in `script/`)
- `fetchVersionsInRange(name, major)` — `:72-96`; **pre-filters `p.major === major && !p.prerelease` at `:81-84`** (this filter is what makes prerelease pins return `null` today — rev-2 rewiring in A2b removes it); silent `catch { return null }` at `:66` and `:93`
- Collector loop — `:106-125`; sections list at `:113` (only `dependencies`/`devDependencies`/`optionalDependencies`/`peerDependencies`); first-encountered-version retention at `:120` with the "should be consistent" comment at `:122`
- Results shape — `:130` (`{ name, current, latest, latestInRange, files }` — BOTH fields set from the same value at `:154`; `latest` is removed in R2, `latestInRange` kept); sequential `for … await` at `:133`; **result-emission predicate at `:150`** (`if (latestParsed.minor > parsed.minor || latestParsed.patch > parsed.patch)`) — compares only minor/patch, so a `4.0.0-beta.65 → 4.0.0-beta.70` candidate (minor and patch both `0`) is DROPPED even when a valid in-channel upgrade exists. **`:150` is REMOVED in this change** (A1 emission contract) — emission is driven by `sameChannelVersion` non-null instead.
- Report — `:170-192` (consumes `r.latest` at `:180, :187`)
- Apply — `:198-242`; global regex at `:217` (`new RegExp(…, "g")` replacing **every** occurrence of the dep name anywhere in the file, ignoring JSON section boundaries); `bun install` at `:239`; `escapeRegex` at `:244-246`
- Module-top-level orchestration — `:102-242` runs at import time (no `main()` / no `import.meta.main` guard)
- No exit-code logic anywhere — script always exits 0; no typecheck step after apply

Root `package.json` (verified):
- `workspaces.packages: ["packages/*", "packages/sdk/js"]` — `:21-25`
- `workspaces.catalog` — `:26-84` (e.g. `effect: "4.0.0-beta.65"` `:54`, `drizzle-orm: "1.0.0-beta.19-d95b7a4"` `:53`, `@pierre/diffs: "1.1.0-beta.18"` `:46`, `"semver": "7.7.4"` `:65`, `"typescript": "catalog:"` `:108` — prerelease-heavy)
- `overrides` — `:128-131` (values are `catalog:` refs today, so nothing to bump, but the section must still be reported on)
- `patchedDependencies` — `:132-138` (keys are `name@version`, values are patch file paths whose filenames embed the version)
- No `resolutions` key exists (see Scope OUT)
- Non-workspace `package.json` files confirmed present: `github/package.json` (standalone GitHub Action, outside the Bun workspace per AGENTS.md) and `.opencode/package.json` — both are currently scanned and `--apply`-writable (bug)
- `packages/diff-wasm/pkg/` exists (wasm-pack output, gitignored) — relevant to the `--all` caveat in A4

## Architecture decisions

### A0 — Structure: single file, `import.meta.main` guard, exports for tests (review-adjudicated)

@review ruled the `.shared.ts` extraction justified but required adjudication against the cheaper alternative. **Decision: the cheaper alternative wins — no `check-updates.shared.ts`.**

- Wrap the current module-top-level orchestration (`:102-242`) in a `main()` function, invoked under `if (import.meta.main) main()`. `export` the pure decision functions (`collectPinnedDeps`, `sameChannelVersion`, `applyTargets`, `isPinned`, `parseSemver`) from `check-updates.ts` itself. Bun sets `import.meta.main` only for the entry file, never for imports, so `script/check-updates.test.ts` importing `./check-updates` gets the pure functions with **zero side effects**.
- Why not `.shared.ts`: the new file existed in rev 1 only to dodge side-effects-on-import. The 3-line guard solves that without a module boundary to keep in sync, without a second file to typecheck, and with no possible import cycle (the question is moot — nothing to import back from; state it anyway for the record: `check-updates.ts` must never import from `check-updates.test.ts` and the test must import only `./check-updates`, so a cycle cannot form).
- Why not `.shared.ts` (positive case for the alternative): AGENTS.md style ("keep it in one function/file unless composable or reusable"; "don't extract single-use helpers preemptively") prefers fewer module seams. The `.shared.ts` convention is for modules extracted FROM reactive/UI components where the split is the point; here the split buys nothing the guard doesn't.

### A1 — R3 prerelease policy: same-channel compare, never silently cross to stable (adopting the recommendation)

- If the current pin has a prerelease identifier: candidates are filtered to versions with the same major.minor.patch **base** AND a prerelease whose first dot-segment (the channel, e.g. `beta`) matches. `4.0.0-beta.65` → newest `4.0.0-beta.*`; a newer `4.0.0-beta.70` wins, `4.0.0-rc.1` and `4.0.0` (stable) are both excluded. Rationale: the repo pins betas deliberately (`effect`, `drizzle-orm`); silently jumping `beta` → stable is exactly the kind of "spooky action at a distance" the coding philosophy forbids, and stable-jump is a major/minor decision a human should make.
- **Deliberate consequence (stated explicitly):** requiring the same `major.minor.patch` base means in-channel prerelease bumps on a NEWER base (e.g. `4.0.1-beta.1` existing after a `4.0.0-beta.65` pin) are never reported. This is more conservative than strictly necessary — it is a chosen trade-off, not an oversight: cross-base prerelease jumps compound two decisions (new base + new prerelease) and are left to humans. Rev-2 explicitly accepts this narrowing; a future `--channel-any-base` escape hatch could relax it.
- If the current pin is stable: candidates are stable, same-major, no prerelease, and the **maximum** same-major version is selected — this preserves today's minor/patch-upgrade behavior (the existing `:85-91` sort picks the max; the old `:150` predicate then reported `1.2.3 → 1.3.0`). The script's documented purpose ("minor/patch upgrades", header `:2-13`) is unchanged for stable pins.
- **Emission contract (rev 3 fix for review item 1):** `sameChannelVersion` returns `null` when no strictly-newer candidate exists within the channel, and the caller emits a result row **whenever it is non-null** — there is NO secondary emission predicate. The old `:150` minor/patch comparison is removed (it would drop the flagship `4.0.0-beta.65 → 4.0.0-beta.70` row, where minor and patch are both `0`). Non-null ⇔ emitted; null ⇔ skipped. Locked by test 2's no-op case (`sameChannelVersion("4.0.0-beta.65", ["4.0.0-beta.65"]) → null`).
- Ordering within a channel: compare prerelease segments per semver rules — numeric segments compare numerically, alphanumeric lexically, numeric < alphanumeric (this fixes the current sort at `:85-91` which ignores prerelease ordering entirely and would mis-rank within a channel).
- `isPinned` fix: regex becomes `^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$`. `parseSemver`'s prerelease capture likewise widened to `[0-9A-Za-z.-]+`, then split on `.` for channel extraction. Both regexes are widened together (see anchors note: both are broken for hyphenated prereleases today).

### A2b — Fetch contract rewiring (rev 2 fix for review item 2)

`fetchVersionsInRange`'s hard-coded pre-filter (`:81-84`: `p.major === major && !p.prerelease`) is **removed**. The fetch layer is demoted to pure data retrieval:

- `fetchVersionList(name): Promise<string[] | "error">` — fetches the abbreviated packument (`Accept: application/vnd.npm.install-v1+json`), returns the raw list of ALL version keys (unfiltered — every major, every prerelease), or the string sentinel `"error"` on fetch/HTTP failure (so a failed fetch is distinguishable from "no candidates" at the call site).
- **`sameChannelVersion(current: ParsedSemver, candidates: string[]): string | null` owns ALL major/prerelease selection** — major match, stable-vs-prerelease split, channel match, within-channel ordering, and strict-newer filter (returns `null` if nothing strictly newer exists in-channel) all live in the pure function (A1). The fetch layer knows nothing about ranges. Non-null return is the sole emission signal (A1 emission contract).
- Consequence: one packument fetch serves both stable and prerelease pins identically, and the pure function is fully unit-testable with inline fixture lists — no network in tests. Without this rewiring, `sameChannelVersion` would receive an already-stable-filtered list and every prerelease pin (`effect 4.0.0-beta.65`, `drizzle-orm 1.0.0-beta.19-d95b7a4`) would report `null` forever, making A1's widening dead code and Verification 3's expected observations impossible.

### A3 — Data model: per-`(file, name, version, section)` records (rev 2 fix for review item 3)

The current collector keys `depMap` globally by name and retains only the FIRST-encountered version with a flat `files` set (`:120`, `:122`) — cross-file divergence is not representable (dep X at `1.2.0` in package A and `1.2.5` in package B collapses to `1.2.0`, and applying to B prints a spurious "could not find X"). Replaced with:

```ts
type DepSection = "dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies" | "catalog"
type PinnedEntry = { file: string /* relative to ROOT */; name: string; version: string; section: DepSection }
type Divergence = { name: string; versions: { file: string; section: DepSection; version: string }[] }
type ApplyUpdate = { file: string; name: string; from: string; to: string; section: DepSection }
```

- `collectPinnedDeps(manifests: { file: string; json: Record<string, unknown> }[])` returns `{ entries: PinnedEntry[]; divergent: Divergence[] }` — every pinned literal occurrence becomes its own entry (no global dedup, no first-encountered retention).
- Fetch/check loop dedups **by `name` only** for network purposes (rev 3 fix for review item 3 — `fetchVersionList(name)` is name-keyed, and the same packument serves every version of that package; keying by `(name, version)` would fetch the identical packument twice for a dep pinned at two versions, e.g. `drizzle-orm` in catalog and as a direct dep). Each `(name, version)` entry still gets its own `sameChannelVersion` call against the shared candidate list.
- **Cross-file divergence handling:** different versions of the same dep across files are NOT an error — each entry carries its own `from` version and is checked/applied independently (X@1.2.0 in A and X@1.2.5 in B each get their own in-range latest). Divergence is reported as a **warning** (`⚠ [divergence] <name> pinned to multiple versions across entries: a@1.2.0, b@1.2.5`) for human review, never blocking, never collapsing.
- **Within-file divergence** (same dep, two versions, same file): same treatment — independent entries, warning, each rewritten only at its own version token.

### A4 — Apply: section-scoped, version-anchored rewrite (rev 2 fix for review item 4)

Rev 1's A3 claimed "section-aware JSON surgery" but implemented a whole-file regex — a literal version inside `overrides`/`patchedDependencies` that happened to equal a scanned pin would be rewritten, contradicting A5. **Fixed: `applyTargets` is genuinely section-scoped.**

- `applyTargets(content: string, updates: ApplyUpdate[]): { content: string; missed: string[] }` — string in → string out (pure, testable).
- Mechanism: for each targeted section, extract that section's object block from the raw text with `"section"\s*:\s*\{([^{}]*)\}` and apply the version-anchored regex `("name"\s*:\s*")escapeRegex(from)(")` **only inside the extracted block**, then reassemble the file. Sections in these manifests are flat string maps (no nested objects — verified for `dependencies`/`devDependencies`/`optionalDependencies`/`peerDependencies`/`catalog` in root `package.json` and package manifests), so `[^{}]*` block extraction is safe. **Documented assumption:** if a section ever nests an object, the block regex degrades to no-match → `missed[]` → warning, i.e. fails safe (no wrong write, just a skipped one).
- `overrides`/`patchedDependencies` are never passed to `applyTargets` (A5) — with section scoping, "never touches" is now mechanically true, not just policy.
- The version-anchored regex (match `from`, not any version) is what keeps the catalog rewrite safe where a dep name appears with multiple values (e.g. `semver`: catalog `"7.7.4"` at `:65` vs devDependencies `"^7.8.5"` at `:98` — only the exact `7.7.4` token inside the `catalog` block matches).
- Zero-match inside the block → recorded in `missed[]` → warning (existing `:225` behavior kept), file still written if other updates landed.
- `escapeRegex` moves into the module-level helper area of `check-updates.ts` (used by `applyTargets`).

### A5 — R6 boundary: derive the workspace set from `workspaces.packages`, explicit override flag

- Read `workspaces.packages` (`["packages/*", "packages/sdk/js"]`) from root `package.json`, expand the globs with `Bun.Glob` (Bun API, no dep), include root `package.json` itself. Result: `package.json`, every `packages/*/package.json`, `packages/sdk/js/package.json` — **excluding** `github/`, `.opencode/`, `packages/diff-wasm/pkg/`, `dist*` automatically because they're not in the workspace globs.
- Add `--all` flag to fall back to the old recursive walk for anyone wanting the wider sweep. New behavior is the default; old behavior is opt-in. One-line header JSDoc update.
- **`--all` caveat (rev 2 fix for review item 12):** the recursive walk's skip list (`:33`) gains `pkg` — without it, `packages/diff-wasm/pkg/package.json` (wasm-pack build output, gitignored) would be scanned and `--apply`-writable. Caveat stays documented: `--all` scans by heuristic skip-list, so new noise dirs can leak in; the default workspace-glob mode is the precise one.
- **Fixture root override (rev 2 fix for review item 5a):** a `resolveRoot()` export returns `process.env.CHECK_UPDATES_ROOT ?? join(import.meta.dir, "..")`; module-level `const ROOT = resolveRoot()` stays adjacent to the existing `:19` (rev 3 fix for review item 5 — one resolver, one placement: the exported pure function is the production path, so the unit test exercises exactly what `main()` runs). Added in Step 2; covered by unit test. This is what makes the Verification 5 fixture run possible without editing the script.

### A6 — R5 overrides/patchedDependencies: detect-and-report, never touch

- Catalog entries whose value is `catalog:` inside `overrides` (`package.json:129-130`) are skipped as references, but if an override pins a literal version that diverges from the catalog entry for the same dep, report it (`⚠ [override-mismatch] <name>: <overrideVer> vs catalog <catalogVer>`).
- `patchedDependencies` keys parse as `name@version`; if the catalog (or any scanned section) pins a different version for that dep, report `⚠ [patch-mismatch] <name@patchVer> vs <foundVer> — patches/<file>.patch is keyed to the old version`. **`--apply` never rewrites either section** (warn-and-skip per Scope OUT) — mechanically guaranteed by A4's section scoping.

### A7 — R7 fetch strategy and CLI contract

- Abbreviated metadata: `Accept: application/vnd.npm.install-v1+json` header on the packument fetch. The abbreviated doc still contains the full `versions` map — sufficient for `fetchVersionList` (A2b); response size drops ~10-50× for large packages.
- Bounded concurrency: worker-pool over the name-deduped package set (A3: dedup by `name` for fetch) — fixed pool of 8 advancing a shared cursor index. No new dependency; ~8 lines.
- Failure logging: `fetchVersionList` returns the `"error"` sentinel (A2b); the orchestration logs to stderr with a **stable `⚠ [fetch-fail]` prefix** (rev 2 nit 14 — CI-greppable) and accumulates `failed: string[]`. A fetch failure is NOT counted as "up to date."
- Report additions: catalog entries print under a `  [catalog] package.json` group; divergence warnings with a stable `⚠ [divergence]` prefix; overrides/patchedDependencies mismatches with `⚠ [override-mismatch]` / `⚠ [patch-mismatch]` prefixes; a final `Check failures:` section listing `failed[]`.
- Apply warnings use a stable `⚠ [apply-warn]` prefix (covers the "could not find" message and divergence-skip notes).

### A8 — Flag interactions (rev 2 fix for review item 13)

- `--check` + `--apply` together: **mutually exclusive** — print `error: --check and --apply are mutually exclusive` to stderr and `process.exit(2)`. `--check` is report-only by definition; silently ignoring one flag would be a least-surprise violation.
- `--typecheck` requires `--apply`: if passed without it, print the same style of error and exit 2 (`--typecheck` is a post-apply step; standalone it would run a typecheck for no reason — that's just `bun typecheck`, which the user can run directly).
- `--typecheck` with `--apply` but without `--install`: allowed, but prints a note that the lockfile was not refreshed and the typecheck may see pre-install state. (Requiring `--install` would force a full dependency resolve on every apply; the note preserves the user's choice.)
- `--install` without `--apply`: today it does nothing (install only runs inside the APPLY block at `:237`). Keep that behavior, print nothing new — out of scope to make `--install` standalone.

## Step-by-step execution

### Step 1 — Guard + exports + test spec in `check-updates.ts` (A0)

**Files (modified/new):** `script/check-updates.ts`, `script/check-updates.test.ts`, `script/bunfig.toml` (new, 3 lines)

1. Wrap `:102-242` orchestration into `function main() { ... }`; call it under `if (import.meta.main) main()`. Export the pure functions per A0 (`collectPinnedDeps`, `sameChannelVersion`, `applyTargets`, `isPinned`, `parseSemver`, `resolveRoot`). No other change yet.
2. Write `script/bunfig.toml`:
   ```toml
   [test]
   root = "."
   ```
   This overrides the root `bunfig.toml:4-5` guard (`[test] root = "./do-not-run-tests-from-root"` — a deliberately nonexistent dir) for anything run with `script/` as the working directory. The root `package.json:19` `test` npm script (`echo … && exit 1`) is a separate, unrelated guard — rev 1 conflated the two; this bunfig is the one that actually blocks `bun test` from the repo root.
3. Author `script/check-updates.test.ts` FIRST (imports will resolve to the guarded-but-pre-rewrite module for the pure functions that already exist — `isPinned`, `parseSemver` — and fail on the not-yet-existing ones; author tests before the rewrite so they encode the intended contract, per the Step-1-EXISTS pattern of `chat-ordering-step1-2026-09-23.md`, whose tests live under `packages/opencode/test/`).

Test spec contents (bun:test, inline fixtures, no fs, no network):

1. **`isPinned`/`parseSemver`**: `1.0.0-beta.19-d95b7a4` is pinned and parses (channel `beta`); `4.0.0-beta.65` parses; `^1.0.0`, `workspace:*`, `catalog:` are not pinned.
2. **`sameChannelVersion`**: `(4.0.0-beta.65, ["4.0.0-beta.70", "4.0.0-rc.1", "4.0.0", "3.9.9"])` → `4.0.0-beta.70`; `(4.0.0-beta.65, ["4.0.0-beta.65"])` → `null` (no-op: no strictly-newer in-channel candidate — locks the emission contract, review item 1); `(4.0.0-beta.65, ["4.0.0", "4.0.1"])` → `null` (never crosses to stable); `(4.0.0-beta.65, ["4.0.1-beta.1"])` → `null` (same-base restriction, A1 deliberate consequence — lock it); `(1.2.3, ["1.2.9", "1.3.0", "2.0.0"])` → `1.3.0` (stable: same-major MAXIMUM — preserves today's minor-upgrade behavior per A1; `1.3.0` is the max among same-major stable candidates, `2.0.0` excluded by major); prerelease ordering `beta.10 > beta.9` (numeric) and `beta > alpha` (lexical).
3. **`collectPinnedDeps`**: the 4 dep sections; `workspaces.catalog` with prerelease entries; `overrides` with `catalog:` value (skipped) and literal-diverging value (reported); `patchedDependencies` key parsing + mismatch detection; same dep pinned to two versions in one file (divergence recorded, BOTH entries kept per A3); same dep pinned to different versions in TWO different files (two independent entries, cross-file divergence warning, no collapsing).
4. **`applyTargets`**: single occurrence rewrite; dep in two sections with divergent versions → only the matching section+version rewritten (section-scoping proof); dep name that is a substring of another (`"marked"` vs `"marked-shiki"` — the `"`-anchored regex handles it, assert it); a literal version present in `overrides` equal to a scanned pin → NOT rewritten (A4/A5 regression lock — the rev-1 bug); zero-match → recorded in `missed[]`, content unchanged; catalog block rewrite leaves `overrides`/`devDependencies` untouched.
5. **`resolveRoot`/`CHECK_UPDATES_ROOT`** (small): set `process.env.CHECK_UPDATES_ROOT` in the test, call the exported `resolveRoot()`, assert it returns the env value; unset it, assert it returns the `import.meta.dir/..` join. This exercises the exact production resolver (A5 — `main()`'s module-level `ROOT` is initialized from `resolveRoot()`).

### Step 2 — Rewrite the orchestration in `script/check-updates.ts`

**File:** `script/check-updates.ts`

1. Delete `fetchLatestVersion` (`:58-69`).
2. R2 field cleanup: the `results` shape (`:130`) currently declares BOTH `latest` and `latestInRange` and sets both from the same value (`:154`). Remove `latest` entirely; keep the single field `latestInRange`; update the two report consumer lines that read it (`:180` and `:187` — the group-building map at `:176-182` stores the value under its `latest` key, so `:180` populates and `:187` prints; both switch to `latestInRange`).
3. **Remove the `:150` emission predicate** (A1 emission contract): the caller emits a row whenever `sameChannelVersion(...)` returns non-null — no secondary minor/patch comparison. The old predicate would drop the flagship `4.0.0-beta.65 → 4.0.0-beta.70` row (minor/patch both `0`).
4. Fetch layer → `fetchVersionList` (A2b): raw unfiltered version list, abbreviated Accept header, `"error"` sentinel, logged failures.
5. Collector → `collectPinnedDeps` (A3): per-`(file, name, version, section)` entries, catalog included, divergence collection, no global first-encountered dedup.
6. File discovery (A5): `resolveRoot()` export + module-level `ROOT = resolveRoot()` adjacent to `:19`; root manifest + `Bun.Glob` expansion of `workspaces.packages`; `--all` flag restores the recursive walk with `pkg` added to the `:33` skip list.
7. Fetch loop (A7): dedup by `name` (A3 — `fetchVersionList` is name-keyed; one packument serves all versions of a package), concurrency 8, `failed[]` accumulator.
8. Report: catalog group, divergence warnings, overrides/patchedDependencies mismatch warnings, `Check failures:` section, stable `⚠ [prefix]` texts.
9. Apply (A4/A6/A8): section-scoped `applyTargets` for dep sections + catalog; overrides/patchedDependencies warn-and-skip; flag validation (`--check` xor `--apply`; `--typecheck` requires `--apply`).
10. Exit code: `--check` → `process.exit(results.length > 0 || failed.length > 0 ? 1 : 0)` after the report.
11. `--typecheck` opt-in: after successful apply (+ install if requested), run `bun run --cwd packages/opencode typecheck` via `execSync` (the AGENTS.md "Bulk Dependency Updates" post-apply instruction).
12. Header JSDoc (`:2-13`): document new flags, catalog/coverage, prerelease-channel policy (including the same-base restriction and the emission contract), workspace boundary, and flag interactions.

### Step 3 — Update the plan index

**File:** `_plan/index.md` — add one 5-cell row in the "All Plans" table (matching `_plan/index.md:19-46` format):

```
| [check-updates-hardening](./check-updates-hardening-2026-09-23.md) | 2026-09-23 | Script hardening: catalog/apply/prerelease/boundary | ⬜ PENDING | — |
```

---

## Verification plan

**Constraint honored:** no `--apply` is ever run against the real repo in this work; all apply-behavior proof comes from unit tests on the pure `applyTargets` function plus a throwaway fixture.

1. **Unit tests (deterministic, no network) — exact invocation (rev 2 fix for review item 1):**
   ```powershell
   cd script; bun test check-updates.test.ts
   ```
   Run with `script/` as the working directory so the new `script/bunfig.toml` (`[test] root = "."`) overrides the root `bunfig.toml:4-5` guard that points `[test] root` at the nonexistent `./do-not-run-tests-from-root` — that bunfig guard, NOT the root `test` npm script, is what made root-level `bun test` fail with `Failed to scan non-existent root directory for tests` (review-verified repro). Running from `script/` keeps the spec colocated with the script it tests (matching `script/` being outside every package's `test/` dir) and avoids fabricating a fake package just to host it. Reviewer confirmed this nested-bunfig override works.
2. **Typecheck — gap explicitly accepted (rev 2 fix for review item 7):** `script/tsconfig.json` does not exist and `script/` is in no package typecheck graph (root `tsconfig.json` extends `@tsconfig/bun` and excludes `plugins/**` but does not cover `script/` as a package target; `bun test` and `bun build` do not typecheck). Accepted as-is with rationale: **today's script has the identical gap** — this change does not regress any existing checking — and the runtime execution of every pure function in the Step-1 spec plus `bun run lint` (oxlint, which covers `script/`) provide the practical coverage. Adding a `script/tsconfig.json` solely for one file is a repo-wide convention decision, flagged below as Q3 rather than smuggled into this diff.
3. **Manual dry-run against the real repo (report mode ONLY — safe, zero writes):**
   ```powershell
   bun run script/check-updates.ts
   ```
   Expected observations: file count drops from the old recursive count to root + workspace packages (`github/` and `.opencode/` absent); catalog deps appear under the `[catalog]` group (`effect`, `drizzle-orm`, `drizzle-kit`, `@pierre/diffs` now checked — previously skipped); prerelease pins produce in-channel candidates and EMIT rows (e.g. `effect` reports newest `4.0.0-beta.*`, NOT stable — this requires BOTH the A2b fetch rewiring AND the `:150` removal; if minor/patch-style comparison still gates emission, the `4.0.0-beta.x → 4.0.0-beta.y` row is silently dropped); no crashes on `@solidjs/start` (`https:` ref, skipped) or `@openauthjs/openauth` (`0.0.0-20250322224806` — pinned per widened `isPinned`, compared within its channel space; assert it appears or is reported as no-candidate, NOT silently skipped).
4. **`--check` smoke + flag validation:**
   ```powershell
   bun run script/check-updates.ts --check; echo "exit=$LASTEXITCODE"
   bun run script/check-updates.ts --check --apply; echo "exit=$LASTEXITCODE"   # expect 2, mutual-exclusion error
   ```
   Expected: report printed, non-zero exit if any update/failure exists; the second command exits 2 without scanning.
5. **Apply-path proof on a throwaway fixture (never the real repo).** Fixture layout chosen to match A5's glob discovery (rev 2 fix for review item 5b — a bare root + one stray package.json would NOT be discovered):
   ```
   %TEMP%\opencode-check-updates-fixture\
     package.json              # workspaces: { packages: ["packages/*"] }, catalog with a prerelease entry, overrides, patchedDependencies
     packages\fake\package.json  # dependencies with a pinned dep
   ```
   Run with the A5 env override:
   ```powershell
   $env:CHECK_UPDATES_ROOT = "$env:TEMP\opencode-check-updates-fixture"
   bun run script/check-updates.ts --apply
   Remove-Item Env:CHECK_UPDATES_ROOT
   Remove-Item -Recurse -Force "$env:TEMP\opencode-check-updates-fixture"
   ```
   Inspect fixture files byte-for-byte: only intended `(section, name, from)` tokens changed; `overrides`/`patchedDependencies` untouched; divergence warnings printed.
6. **Negative-control on the real repo:** `git status` after all dry-runs must show only `script/check-updates.ts`, `script/check-updates.test.ts`, `script/bunfig.toml` (and `_plan/index.md` in the commit) — zero modified `package.json` files.

**Rule 3 note:** the current script has zero test coverage; per AGENTS.md ("do NOT refactor if there is no test coverage for the parts being refactored"), Step 1's tests ARE the characterization tests — they lock the pure-logic contract (which is deliberately, slightly changed for prereleases — the changed assertions intentionally lock the NEW policy, same pattern as `chat-ordering-step1` E1). The orchestration glue (fetch/discover/print) is verified by manual dry-run because mocking network/fs there would violate the "avoid mocks; test actual implementation" rule.

## Risks

- **Catalog rewrite inside root `package.json` is the highest-blast-radius write.** Mitigated by version-anchored + section-scoped rewrite (A4) + the fixture apply test (Verification 5) + divergence pre-flight. The `semver` case is the known tricky one: catalog `"7.7.4"` at `package.json:65` vs devDependencies `"^7.8.5"` at `:98` — only the exact `7.7.4` token inside the catalog block matches (covered by test 4).
- **Section-block extraction assumes flat sections** (`[^{}]*`): degrades fail-safe to `missed[]` + warning if a section ever nests an object (documented assumption, A4).
- **Channel extraction heuristic** (`first dot-segment = channel`) mis-buckets exotic prereleases (`1.0.0-beta.19-d95b7a4` → `beta` ✓; `1.0.0-rc.1-fix` → `rc` ✓; a bare `1.0.0-20250322` → channel `20250322`, compares only within that exact namespace — conservative, never cross-bumps, so worst case is "no candidate found," a safe failure).
- **npm packument shape drift** for `@openauthjs/openauth`-style placeholder versions — the `failed[]` reporting turns any silent skip into visible signal.
- **`--all` heuristic leak** (rev 2): the recursive walk is skip-list-based; `pkg` is now covered (`packages/diff-wasm/pkg/`), but future noise dirs can appear. The workspace-glob default is precise; `--all` users accept heuristic scanning (documented in A5).
- **Emission-contract regression risk (rev 3):** removing `:150` and relying solely on `sameChannelVersion` non-null is the behavior-bearing change for prereleases; if an implementer keeps the predicate "for safety," every in-channel prerelease row (minor/patch both unchanged) vanishes silently. Locked by the no-op negative test (`["4.0.0-beta.65"] → null`) and Verification 3's "EMIT rows" observation.
- Rev-1 risk claim corrected: `packages/` is NOT exclusively real workspace packages — it contains `diff-wasm/pkg/` build output; the workspace-glob default handles this correctly and `--all` now skips `pkg`.

## Open questions / human decisions

- **Q1 (policy):** Should catalog beta-pins (`effect`, `drizzle-orm`) ever auto-cross to stable when a stable 4.0.0 ships? Plan default: NO (A1) — cross-channel moves are human decisions. If product wants a `--allow-stable-crossing` escape hatch, add later; not in this diff.
- **Q2 (deferred):** Should `--apply` ever rewrite `patchedDependencies` (regenerating `patches/<name>@<ver>.patch` paths + revalidating the patch)? Deferred per A6 — needs a Bun patch-flow revalidation design. Flag for a future plan if override/patch auto-bumping is ever wanted.
- **Q3 (repo convention, out of this diff):** Should `script/` get a tsconfig and join the typecheck graph? All script files share the gap today; fixing it repo-wide is a separate hygiene decision.

## Deliberately deferred (with reasons)

- **`overrides`/`patchedDependencies` `--apply` rewrite** — see Scope OUT / Q2; detection only here.
- **`resolutions` detection** — dropped; key does not exist in this repo (Scope OUT).
- **`.gitignore`-aware file discovery** — superseded by A5's explicit workspace derivation; `--all` preserves escape hatch.
- **`script/tsconfig.json`** — Q3; the gap is pre-existing, not a regression of this change.
- **Dependency injection for fetch (testable network layer)** — rejected: adds abstraction for one test seam; the pure logic (`sameChannelVersion` over an inline candidate list) carries the correctness risk, and `fetchVersionList` is thin.
- **Resurrecting `fetchLatestVersion` for a "new major available" report** — out of scope (same-major policy is the script's contract; major-bump awareness would change the tool's purpose).
