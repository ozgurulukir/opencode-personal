# Plan: Switch fork release versioning to CalVer `YYYY.M.D`

Date: 2026-09-29 (rev 2 — review fixes; same-day)
Scope: `.github/workflows/release-binaries.yml` + `README.md` + a supersede-pointer in the predecessor plan. **No app source, no installers, no upstream `publish.yml`.** Scope note: the predecessor-pointer step touches `_plan/github-binary-release-2026-09-29.md`, which is outside the strict mandate scope (workflow + README) — included deliberately for SSOT, see Step 5.

**Revision summary (rev 2):**
1. **Major fixed — same-day re-release tradeoff now has shipped artifacts:** a comment block above the `Create draft release` step (Step 3) and a README sentence (Step 4); D5 references both locations.
2. **Minor fixed — validation is now pure bash:** the `bun -e` semver check was replaced by a leading-zero check (`grep -Eq '\.0[0-9]'`) that is provably equivalent on the shape-constrained input (16/16 matrix, including the required `2026.9.9` ACCEPT / `2026.09.29` REJECT). Removes the bun dependency and its misleading-failure mode ("not valid semver" when bun is actually missing).
3. **Minor fixed — dispatch input no longer interpolated into the shell:** bound via `env: RAW` (injection surface removed; pre-existing issue, cheap to fix now).
4. **Minor fixed — D1 provenance softened** (minimatch is a local proxy; GitHub's fnmatch-style semantics agree on the constructs used, differ on `?`/`+` which the pattern avoids) and **D4 completed** with `release-github-action.yml` (branch+path triggered, verified).
5. **Nits:** Risk 3 rephrased (no *functional* local bash — WSL stub exists but is non-functional); Step 5 carries an explicit scope note and a byte-safe (UTF-8 em dash) edit approach, verified by codepoint inspection.

**Plan-file choice: NEW file `_plan/calver-versioning-2026-09-29.md`** (not an in-place edit of `_plan/github-binary-release-2026-09-29.md`). Why: the predecessor plan is a historical record (rev 2) of the implemented release pipeline, including the D1 rationale that mandated `-p.N`; rewriting it would destroy that decision record. This plan supersedes one axis (version scheme) and adds a one-line supersede pointer to the predecessor (Step 5) so no reader follows the stale convention.

---

## Goal

Replace the fork release version scheme **semver + required `-p.N` suffix** (e.g. `1.14.48-p.1`) with **CalVer `YYYY.M.D`** — no leading zeros, no required suffix — e.g. `2026.9.29`, tag `v2026.9.29`. `YYYY.M.D` with no leading zeros is valid semver (`2026.09.29` is not). Keep `OPENCODE_CHANNEL=personal` (DB isolation is version-format-independent — verified below). Preserve the mirror-safety guarantee: a tag sync from upstream (`anomalyco/opencode`, remote configured on this clone) must never mint a fork release.

---

## Verified evidence base (current files on disk, re-grepped today)

| Claim | Evidence |
| --- | --- |
| Tag trigger is `v*-p.*`; comment cites the fork convention | `release-binaries.yml:6-9` |
| `workflow_dispatch` version input description cites `-p.N` | `release-binaries.yml:13` |
| Validation step REQUIRES `-p.N` (`grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+-p\.[0-9]+$'`) | `release-binaries.yml:69-85` (name `:69`, regex `:81`, error `:82`) |
| Dispatch input is interpolated directly into the shell (`v="${{ inputs.version }}"`) — pre-existing injection surface | `release-binaries.yml:73` |
| Release title is dynamic `$tag`; notes contain no `-p.N` wording | `release-binaries.yml:95-98` |
| Version flows to build verbatim, no format validation: workflow env `OPENCODE_VERSION` → `Script.version` returns env verbatim → baked define / user-agent / dist package.json / `gh release upload v${Script.version}` → `InstallationVersion` string constant | `release-binaries.yml:105` → `packages/script/src/index.ts:34-35` → `packages/opencode/script/build.ts:366,376,415,423,434` → `packages/core/src/installation/version.ts:6` |
| Channel `personal` → `opencode-personal.db` is independent of version format | `release-binaries.yml:54`; predecessor plan D3 (`db.ts:30-35` sanitizer keys on channel only) |
| `publish.yml` does NOT fire on tags: push trigger is branches `ci/dev/beta/snapshot-*` + dispatch only; `fetch-tags: true` at `:77` is a checkout-step input, not a trigger; jobs guarded `github.repository == 'anomalyco/opencode'` (`:36` verified; `:73,:117` per predecessor evidence) | `publish.yml:4-10,36,77` |
| `publish-github-action.yml` fires only on `github-v*.*.*` tags — disjoint from `v2026.9.29` (both directions confirmed in the minimatch test below) | `publish-github-action.yml:6-8` |
| `release-github-action.yml` is branch+path triggered (`dev` + `github/**`) — no tag trigger, disjoint from `v2026.9.29` | `release-github-action.yml:3-8` |
| Installers do pure string handling: bash strips `v` (`install.sh:194`), builds URL from the raw string (`:195-196`), `check_version` is a string compare (`:230`); ps1 `TrimStart("v")` (`install.ps1:47`), URL from raw string (`:63`). No format validation anywhere | `install.sh:194-196,222-233`; `install.ps1:47,63` |
| Only README line carrying the old scheme is `:54`; `:20` ("built on top of the OpenCode 1.14.48 source release") is the upstream base version — factual, keep | `README.md:20,54` |
| Docs site (`packages/web`) has zero version-example hits (only `packages/web/package.json:5` upstream base version) | grep `-p\.\d|1\.14\.48` over `packages/web` |
| No git tags exist yet in the fork (`git tag --list` empty); upstream remote `anomalyco/opencode` is configured | `git tag --list; git remote -v` |
| Edit-context lines carry non-ASCII that console output mangles: predecessor plan line 4 has U+2014 (em dash); `README.md:54` has U+2014 ×2 + U+2192 (→). Exact-string edits must be UTF-8-safe (see Step 5) | codepoint inspection via `Get-Content -Encoding UTF8` + `ToCharArray()` |

---

## Steps

### Step 1 — Workflow: trigger + input description (`release-binaries.yml:3-15`)

Why: the trigger must admit CalVer tags and reject mirrored upstream plain-semver tags; the dispatch input must teach the new convention.

```diff
 on:
   push:
     tags:
-      # Fork-version convention only (-p.N suffix). Mirrored upstream tags
-      # (plain semver, e.g. v1.14.48) do NOT match this pattern, so a tag
-      # sync from upstream can never mint a fork release.
-      - "v*-p.*"
+      # Fork-version convention only (CalVer YYYY.M.D, no leading zeros).
+      # Mirrored upstream tags (plain semver, e.g. v1.14.48) do NOT match
+      # this pattern, so a tag sync from upstream can never mint a fork
+      # release. A glob cannot express "1-2 digits" or "no leading zeros",
+      # so malformed CalVer shapes (v2026.09.29, v2026.9, v2026.9.29-rc.1)
+      # also match here and are rejected by the Resolve version step below.
+      - "v[0-9][0-9][0-9][0-9].[0-9]*"
   workflow_dispatch:
     inputs:
       version:
-        description: "Version to release, e.g. 1.14.48-p.1 (fork convention: semver + -p.N suffix; tag v<version> is created if missing)"
+        description: "Version to release, e.g. 2026.9.29 (fork convention: CalVer YYYY.M.D, no leading zeros; tag v<version> is created if missing)"
         required: true
         type: string
```

### Step 2 — Workflow: validation step (`release-binaries.yml:69-85`)

Why: replace the `-p.N` assertion with the mandated CalVer validation (shape, year ≥ 2000, valid semver ⇒ no leading zeros) and keep the "second line of defense against mirrored upstream tags" behavior. Pure bash throughout — no `bun -e`/node dependency (rationale and equivalence proof in D2). The dispatch input is bound via `env:` instead of being interpolated into the shell (removes the pre-existing injection surface; `github.event_name` stays interpolated — it is a trusted GitHub context value, not user input).

```diff
-      - name: "Resolve version (fork convention: semver + required -p.N suffix)"
+      - name: "Resolve version (fork convention: CalVer YYYY.M.D)"
         id: version
+        env:
+          RAW: ${{ inputs.version }}
         run: |
           if [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
-            v="${{ inputs.version }}"
+            v="$RAW"
           else
             v="${GITHUB_REF_NAME#v}"
           fi
           v="${v#v}"
           # Second line of defense against mirrored upstream tags: even if a
-          # plain-semver tag ever reached this workflow, it fails here before
-          # any release is created.
-          if ! grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+-p\.[0-9]+$' <<<"$v"; then
-            echo "::error::Invalid version '$v' - fork releases must be semver with a -p.N suffix (e.g. 1.14.48-p.1)"
+          # plain-semver tag (e.g. v1.14.48) ever reached this workflow, it
+          # fails here before any release is created.
+          if ! grep -Eq '^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}$' <<<"$v"; then
+            echo "::error::Invalid version '$v' - fork releases must be CalVer YYYY.M.D without a suffix (e.g. 2026.9.29); mirrored upstream semver tags (e.g. 1.14.48) are not fork releases"
+            exit 1
+          fi
+          if [ "${v%%.*}" -lt 2000 ]; then
+            echo "::error::Invalid version '$v' - year must be >= 2000 (e.g. 2026.9.29)"
             exit 1
           fi
+          # Valid semver (no leading zeros): 2026.09.29 is NOT valid semver.
+          # The shape check bounds month/day to 1-2 digits, so a leading zero
+          # can only appear as .0X (pure bash, no runtime dependency).
+          if grep -Eq '\.0[0-9]' <<<"$v"; then
+            echo "::error::Invalid version '$v' - not valid semver (no leading zeros; use 2026.9.9, not 2026.09.09)"
+            exit 1
+          fi
           echo "version=$v" >> "$GITHUB_OUTPUT"
```

### Step 3 — Workflow: same-day re-release comment above `Create draft release` (`release-binaries.yml:87`)

Why: mandate item 4 requires the same-day-re-release tradeoff to be documented **in the repo**, not only in this plan. The comment sits directly above the step whose reuse behavior it describes; D5 references this location.

```diff
+      # Same-day re-release: same version = same tag. This step reuses an
+      # existing release, and the build re-uploads assets with --clobber
+      # (packages/opencode/script/build.ts), so the tag keeps pointing at its
+      # original commit. A second cut on the same day overwrites assets rather
+      # than minting a new version/tag.
       - name: Create draft release
```

### Step 4 — README (`README.md:54`)

Why: the only doc page carrying the old scheme (docs site has zero hits; `:20` is the upstream base version and stays). Two changes in the same line: the parenthetical teaching the new scheme, and an appended sentence documenting the same-day re-release behavior (second shipped artifact for mandate item 4; D5 references it).

```diff
-Pass `--version <v>` (bash) or `-Version <v>` (PowerShell) to pin a release (fork versions carry a `-p.N` suffix, e.g. `1.14.48-p.1`), `--binary <path>` / `-Binary <path>` to install a local build (also copy the bundled `libopentui.*` / `opentui.dll` next to the binary in that case), and `--no-modify-path` (bash) to skip the PATH edit. Note: `install.ps1` has **no PATH-skip flag** — it always appends the install directory to your user PATH; remove it manually if unwanted. Windows binaries are unsigned, so SmartScreen may warn — choose "More info" → "Run anyway".
+Pass `--version <v>` (bash) or `-Version <v>` (PowerShell) to pin a release (fork versions are calendar-based, e.g. `2026.9.29`), `--binary <path>` / `-Binary <path>` to install a local build (also copy the bundled `libopentui.*` / `opentui.dll` next to the binary in that case), and `--no-modify-path` (bash) to skip the PATH edit. Note: `install.ps1` has **no PATH-skip flag** — it always appends the install directory to your user PATH; remove it manually if unwanted. Windows binaries are unsigned, so SmartScreen may warn — choose "More info" → "Run anyway". Fork releases are calendar-versioned (`YYYY.M.D`, e.g. `2026.9.29`): re-releasing on the same day reuses the same version and tag and overwrites the release assets; a release on a later day is a new version.
```

**Byte-safe edit note:** this line contains U+2014 (em dash) ×2 and U+2192 (→) — verified by codepoint inspection; console output renders them as `-`/`>`. Perform the edit with the Edit tool's exact-string match (UTF-8-safe read/match); never build the match string from console output. If using PowerShell, verify codepoints first via `Get-Content -Encoding UTF8` + `ToCharArray()`.

### Step 5 — Supersede pointer in the predecessor plan (`_plan/github-binary-release-2026-09-29.md`, after line 4)

**Scope note (explicit):** this step edits `_plan/github-binary-release-2026-09-29.md`, which is outside the strict mandate scope (workflow + README). Included deliberately: the predecessor mandates `-p.N` in D1 (`:84`) and Open Question 1 (`:930`); without a pointer, a reader following the predecessor would reintroduce the stale convention (SSOT).

```diff
 Scope: user-approved option **A** — release workflow + installer scripts + README/docs update. No upstream workflow changes. **No app source-code change** (installer-only isolation).
+
+> **Superseded 2026-09-29:** the fork version scheme is now CalVer `YYYY.M.D` (tag `v<version>`), not semver + `-p.N`. See `_plan/calver-versioning-2026-09-29.md`. The `-p.N` convention below (D1, examples, verification steps) is historical.
```

**Byte-safe edit note:** the context line contains a UTF-8 em dash (U+2014, verified by codepoint inspection) that console output renders as `-` — a match string copied from console output will not string-match the file. Perform the edit with the Edit tool's exact-string match (UTF-8-safe read/match); if using PowerShell, verify codepoints first via `Get-Content -Encoding UTF8`.

### Step 6 — Explicitly NO change (verified, per mandate)

- **`install.sh` / `install.ps1` — no change needed.** Evidence: bash strips a leading `v` (`install.sh:194` `requested_version="${requested_version#v}"`), builds the download URL from the raw string (`:195-196`), and `check_version` is a plain string compare (`:230` `[[ "$installed_version" != "$specific_version" ]]`); ps1 does `$Version.TrimStart("v")` (`install.ps1:47`) and builds the URL from the raw string (`:63`). Neither validates the version format, so `2026.9.29` works as-is. Their usage-text examples still read `1.14.48-p.1` (`install.sh:24,30`, `install.ps1:11`) — stale but harmless (examples only); left untouched per mandate (optional cosmetic follow-up in Open Questions).
- **`script/verify-isolation.sh:53,64,75,80,115`** — fake shim versions (`1.14.48-p.1`) exercise the string round-trip; any string works. No change.
- **App source / `packages/script/src/index.ts` / `build.ts`** — version is consumed verbatim with no format assumptions (evidence table); CalVer is valid semver.
- **Upstream `publish.yml`** — not touched (see Architecture Decision D4).

---

## Architecture Decisions

### D1 — Trigger pattern: `v[0-9][0-9][0-9][0-9].[0-9]*` (live-tested)

GitHub Actions tag filters are fnmatch-style globs (no regex): `[0-9]` is a one-char class, `.` is literal, `*` matches any run (not `/`), full-string anchored. Verified with the `minimatch` npm package as a **local proxy**: GitHub's documented filter semantics agree with minimatch on the constructs this pattern uses (char class, literal dot, trailing `*`), but the two implementations differ on other operators (`?` = zero-or-one, `+` = one-or-more in GitHub's filter cheat sheet) that this pattern deliberately avoids — so the conclusion rests on the agreement over the used constructs, not on blanket equivalence (see Risk 1). 12 cases, results:

| Tag | Glob result | Intended |
| --- | --- | --- |
| `v2026.9.29`, `v2026.10.5`, `v2000.1.1` | MATCH | ✅ trigger |
| `v1.14.48`, `v1.0.0-alpha.5` (mirrored upstream) | no match | ✅ reject |
| `v2026-9-29`, `v20265.9.29`, `v999.9.29`, `github-v1.0.0` | no match | ✅ reject |
| `v2026.09.29`, `v2026.9`, `v2026.9.29-rc.1` | MATCH | ⚠️ glob can't express "1–2 digits"/"no leading zeros" → rejected by the validation step (D2) |

**Conclusion: the trigger pattern alone is NOT sufficient** (proven, not assumed) — it is a coarse first filter whose job is to exclude the common mirrored-upstream shapes; the validation step is the authoritative gate. A tighter alternative, `v20[0-9][0-9].[0-9]*` (years 2000–2099 only), was considered and rejected as unnecessary: validation already enforces year ≥ 2000, and the 4-digit form reads literally as "YYYY". YAML quoting is mandatory (`[` would start a flow sequence otherwise) — kept, as in the current file.

### D2 — Validation: three checks, pure bash, defense in depth

1. **Shape** `^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}$` (POSIX ERE — `[0-9]`, not `\d`, for portability).
2. **Year ≥ 2000** via decimal `[ -lt ]` compare on `${v%%.*}` — also kills zero-padded years (`0026` → 26 < 2000).
3. **Valid semver (no leading zeros)** via `grep -Eq '\.0[0-9]'` — **equivalence argument:** the shape check bounds month/day to 1–2 digits, so a leading zero can only appear as `.0X`; the year component's only possible leading-zero forms (`0XXX`) are already killed by check 2. Hence `\.[0-9]{2,}`-style traps (`2026.10.29` must ACCEPT) cannot occur, and `\.0[0-9]` is exactly the semver no-leading-zeros rule on this constrained input.

**Why pure bash instead of `bun -e`:** the original mandate suggested a `semver.valid`-equivalent via `bun -e`/node "if already available"; review feedback flagged that a missing/broken bun would surface as a misleading "not valid semver" error. Since the shape check already constrains the input, the bash check is provably equivalent and removes the runtime dependency entirely. **Evidence: 16/16 matrix** — `2026.9.29`, `2026.9.9`, `2026.10.5`, `2026.10.29`, `2026.0.29`, `2000.1.1` ACCEPT; `1.14.48`, `2026.123.1`, `2026.9.29-rc.1`, `2026.9`, `2026.9.29.1` REJECT(shape); `1999.12.31` REJECT(year); `2026.09.29`, `2026.9.09`, `2026.01.1`, `2026.10.05` REJECT(leading-zero). Includes the review-required pair: `2026.9.9` ACCEPT / `2026.09.29` REJECT.

### D3 — Version flow needs zero app-source changes

`OPENCODE_VERSION=2026.9.29` → `Script.version` verbatim (`packages/script/src/index.ts:34-35`) → baked define, user-agent, dist package.json, and `gh release upload v2026.9.29` (`build.ts:434` — matches the release tag exactly) → `InstallationVersion` string constant. Nothing parses or validates the format downstream; `--version` prints it. Channel `personal` and DB isolation are untouched.

### D4 — Upstream/tag-adjacent workflows: no conflict, not modified

- **`publish.yml`** fires on branch pushes (`ci/dev/beta/snapshot-*`) and dispatch only — **no tag trigger** (`:4-10`; the `tags:` hit at `:77` is a checkout `fetch-tags` input). Its jobs are additionally guarded to `anomalyco/opencode` (`:36` verified). Pushing `v2026.9.29` therefore cannot fire it, and it cannot mint fork releases.
- **`publish-github-action.yml`** fires only on `github-v*.*.*` tags (`:6-8`) — disjoint from CalVer tags in both directions (minimatch-tested).
- **`release-github-action.yml`** fires on push to branch `dev` limited to paths `github/**` (`:3-8`) — no tag trigger, disjoint from `v2026.9.29`.

**Mitigation is tag-pattern divergence, already achieved by D1; none of the three files is modified** (mandate).

### D5 — Same-day re-release tradeoff (documented in the repo, not only here)

Same version = same tag: re-releasing on the same day reuses the existing release (workflow reuses it at `:92-93`) and re-uploads assets with `--clobber` (`build.ts:434`); the tag keeps pointing at its original commit. A different day = a new version/tag. If a same-day second cut is ever needed, a suffix (e.g. prerelease `2026.9.29-2`) could be added later by relaxing the validation regex — deliberately **not** added now (mandate: no required suffix).

**Shipped documentation (this decision's in-repo artifacts):** a comment block directly above the `Create draft release` step (`release-binaries.yml`, Step 3) and a README sentence (`README.md:54`, Step 4). This D5 section is the decision record; those two are the operational documentation the shipped outcome carries. If a future edit removes either artifact, D5 must be updated with it.

---

## Verification plan (exact commands; the first three were executed during research)

1. **YAML parse of the workflow** (tested — works against the current file):
   ```powershell
   bun -e "const fs=require('fs'); const yaml=require('yaml'); const d=yaml.parse(fs.readFileSync('.github/workflows/release-binaries.yml','utf8')); const t=d['on'] ?? d.true; console.log(JSON.stringify({tags:t.push.tags, desc:t.workflow_dispatch.inputs.version.description},null,2))"
   ```
   Expect: `tags` == `["v[0-9][0-9][0-9][0-9].[0-9]*"]`; `desc` contains `2026.9.29` and no `-p.`.
2. **Trigger-pattern check** (tested — 12/12 as table D1):
   ```powershell
   bun -e "const {minimatch}=require('minimatch'); const pat='v[0-9][0-9][0-9][0-9].[0-9]*'; const cases=[['v2026.9.29',true],['v2026.10.5',true],['v2000.1.1',true],['v1.14.48',false],['v1.0.0-alpha.5',false],['v2026.09.29',true],['v2026-9-29',false],['v20265.9.29',false],['v999.9.29',false],['v2026.9',true],['v2026.9.29-rc.1',true],['github-v1.0.0',false]]; let f=0; for(const [t,w] of cases){const g=minimatch(t,pat); if(g!==w)f++; console.log((g===w?'PASS':'FAIL'),t,'match='+g)}; console.log(f===0?'ALL PASS':'FAILURES: '+f)"
   ```
   (The three `true`-expected over-matches — `v2026.09.29`, `v2026.9`, `v2026.9.29-rc.1` — document the glob limitation; each must then fail check 3.)
3. **Validation-logic check** — demonstrates `2026.9.29` passes while `1.14.48` and `2026.09.29` fail, now mirroring the pure-bash step exactly (tested — 16/16, see D2):
   ```powershell
   bun -e "const shape=v=>/^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}$/.test(v); const leadingZero=v=>/\.0[0-9]/.test(v); const validate=v=>{ if(!shape(v)) return 'REJECT(shape)'; if(Number(v.split('.')[0])<2000) return 'REJECT(year)'; if(leadingZero(v)) return 'REJECT(leading-zero)'; return 'ACCEPT' }; for (const v of ['2026.9.29','2026.9.9','2026.10.29','1.14.48','2026.09.29','2026.9.09','2026.10.05','1999.12.31']) console.log(v,'->',validate(v))"
   ```
   Expect: `2026.9.29 -> ACCEPT`, `2026.9.9 -> ACCEPT`, `2026.10.29 -> ACCEPT`, `1.14.48 -> REJECT(shape)`, `2026.09.29 -> REJECT(leading-zero)`, `2026.9.09 -> REJECT(leading-zero)`, `2026.10.05 -> REJECT(leading-zero)`, `1999.12.31 -> REJECT(year)`.
4. **End-to-end on the runner** (post-implementation; also covers the no-functional-local-bash limitation, see Risk 3):
   - `gh workflow run release-binaries -f version=2026.9.29` → green; release `v2026.9.29` published; `opencode-personal --version` prints `2026.9.29`.
   - Negative: `gh workflow run release-binaries -f version=2026.09.29` → the "Resolve version" step fails with the leading-zero error, no release created.
   - Tag path: push `v2026.10.1` → workflow fires; confirm a mirrored `v1.14.48` (if ever synced) does not fire it.

---

## Risks & uncertainties

1. **Glob engine semantics (minimatch proxy vs GitHub's fnmatch-style filters).** The local proof used `minimatch`; GitHub's documented semantics agree on the constructs used (`[0-9]`, literal `.`, trailing `*`) but differ on `?`/`+`, which this pattern avoids. The docs page could not be fetched from this box (transport errors), so the agreement claim rests on the documented cheat-sheet semantics plus the local test — low residual risk. **Mitigation:** defense in depth — even a worst-case over-matching glob engine cannot mint a bad release because validation (D2) is the authoritative gate; the first dispatch run is the real end-to-end proof.
2. **Trigger cannot fully express CalVer** (leading zeros, missing day, suffixes) — proven by test, not assumed. Mitigated by D2.
3. **No *functional* local bash on this Windows box:** the only `bash.exe` on PATH is the non-functional WSL stub at `%LOCALAPPDATA%\Microsoft\WindowsApps\bash.exe` (`execvpe(/bin/bash) failed: No such file or directory`), and git-bash is not installed. The step logic was verified via a construct-identical JS simulation (ERE, decimal compare, leading-zero regex). The real bash script is smoke-tested on the ubuntu runner in verification step 4.
4. **Same-day re-releases** reuse the tag/version (D5) — accepted tradeoff, now documented in the repo (Step 3 + Step 4); suffix possible later.
5. **`2026.0.29` (month 0) passes validation** — it satisfies the mandated spec (shape + year + semver; `0` is valid semver and contains no leading zero). Month/day range hardening is out of scope per "do not deviate"; listed as an Open Question.
6. **Upstream divergence residual:** if upstream ever adopted date-shaped tags `vYYYY.M.D`, they would collide with the trigger — same class of residual as the old scheme ("upstream adopts `-p.`"); recorded, no action.
7. **No existing tags** in the fork (`git tag --list` empty) — no migration of old `v*-p.*` tags/releases is needed.

---

## Open Questions

1. Optional cosmetic follow-up (deferred, per mandate): update the stale usage examples `1.14.48-p.1` in `install.sh:24,30`, `install.ps1:11`, and the fake versions in `script/verify-isolation.sh` to CalVer examples. Purely cosmetic; string-compare behavior is format-agnostic.
2. Optional hardening (deferred): reject calendar-invalid month/day (`2026.0.29`, `2026.13.1`) in the validation step. Excluded now to keep the check exactly as specified.
3. First version number: any `YYYY.M.D` of the release day (e.g. `2026.9.29` or `2026.10.1`) — no back-references to the upstream base `1.14.48` are needed, since CalVer is self-describing.
