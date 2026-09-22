# Repository Hygiene Pass — 2026-09-22

Repo: `C:\Github\opencode-personal` · Branch: `main` · Date: 2026-09-22

## Goal
Relocate loose root-level report/analysis markdown into `_plan/`, `_review/`, `_proposal/`; fix a corrupted untracked `.zcodeignore`; untrack accidentally-committed generated artifacts. NO source code changes. NO branch/stash operations.

## Step A — Move root markdown (`git mv`, preserves history)
Run from repo root. All sources exist at root and are tracked (verified).

- `git mv CODE_REVIEW.md _review/CODE_REVIEW.md`
- `git mv _arch-review.md _review/_arch-review.md`
- `git mv subagent-effect-trypromise-report.md _review/subagent-effect-trypromise-report.md`
- `git mv typegraph-exploration-report.md _review/typegraph-exploration-report.md`
- `git mv ai-sdk-updates.md _review/ai-sdk-updates.md`
- `git mv other-package-updates.md _review/other-package-updates.md`
- `git mv permission-improvements.md "_proposal/permission-improvements-superseded-2026-08-15.md"`
    - **Collision note:** `_proposal/permission-improvements.md` ALREADY EXISTS (18,845 B / 426 lines — the superseding full spec). The root file is a DIFFERENT 3,585 B / 82-line file. Do NOT move to the existing name (no `-f` fails; with `-f` it destroys the spec). Use the `-superseded-2026-08-15` name.
- `git mv plan-opencode-memory-reduction-2026-08-02.md _plan/plan-opencode-memory-reduction-2026-08-02.md`
- **Decision — `QWEN3_MODELS.md`: KEEP AT ROOT.** Unreferenced top-level model-support doc; `docs/` holds only `plans/`, so it is not an established reference-doc home. No command.
- **Decision — `STATS.md`: KEEP AT ROOT.** It is a build/CI report-output target — `script/stats.ts:126` (`const file = "STATS.md"`) and `.github/workflows/stats.yml:31` (`git add STATS.md`). Moving it would break the workflow. No command; keep the root reference as-is.
- Remove ad-hoc tracked screenshot: `git rm "Screenshot From 2026-08-25 21-29-49.png"` (root `/*.png` is already gitignored; this file predates the rule). Tracked + unreferenced (verified).

Keep `_plan/`, `_review/`, `_proposal/` folders in place. Do NOT touch README*/AGENTS.md/CLAUDE.md/GEMINI.md/CHANGELOG.md/CONTRIBUTING.md/SECURITY.md/LICENSE/package.json/configs.

## Step B — Cross-reference edits (per-hit dispositions)
Re-run `git grep -F -n "<old-basename>"` and apply the disposition for each hit. Read each cited hit and classify link vs. historical before editing.

UPDATE (genuine path links):
- `CODE_REVIEW.md` -> `_review/CODE_REVIEW.md` in `_plan/fix-code-review-findings-2026-09-22.md` (link references only) and `_plan/verify-arch-review-2026-09-22.md` (link references only).
- `_arch-review.md` -> `_review/_arch-review.md` in `_plan/verify-arch-review-2026-09-22.md` (link references only).
- `.opencode/command/ai-deps.md:24` — text `Write up your findings to ai-sdk-updates.md` -> update the target to `_review/ai-sdk-updates.md` so a future report lands beside the archived one. (Tracked command file, not under `.ua/`; irrelevant to Step D.)

DO NOT MODIFY:
- `docs/plans/2026-09-09-gitnexus-plan-v1-v2-consistency.md:227` — the `typegraph-exploration-report.md` hit is a STATE-MANIFEST entry (`state: untracked`, `untracked_digest: sha256:...`), not a link. Rewriting would corrupt the manifest. Leave unchanged.
- `_plan/fix-code-review-findings-2026-09-22.md:190,294` — quote `?? CODE_REVIEW.md` as an untracked-state fact / instruction to commit. Historical mention; leave unchanged.
- `script/stats.ts:126` and `.github/workflows/stats.yml:31` — `STATS.md` stays at root (Step A), so no change.

Generated-artifact noise (mooted by Step D): the basenames `subagent-effect-trypromise-report.md`, `ai-sdk-updates.md`, `other-package-updates.md`, `plan-opencode-memory-reduction-2026-08-02.md` also appear inside tracked `.ua/*.json` artifacts (e.g. `.ua/knowledge-graph.json`, `.ua/fingerprints.json`). These are NOT edited — Step D untracks `.ua/`, after which they disappear. Therefore the final `git grep` sweep must run AFTER Step D (see Verification), and may only legitimately leave the historical/manifest mentions listed above.

## Step C — Fix `.zcodeignore` (untracked, corrupted)
`.zcodeignore` is 1,372 B vs `.gitignore` 739 B. It is NOT a duplicate of `.gitignore`: it contains `.gitignore`'s 52 lines **plus a second lowercased generic block** plus mojibake header lines (verified invalid UTF-8 bytes).

- Second block patterns — recommendation KEEP ALL (they are the tool's value-add over `.gitignore`): `.git/`, `.hg/`, `.svn/`, `bower_components/`, `jspm_packages/`, `__pycache__/`, `site-packages/`, `venv/`, `coverage/`, `lcov-report/`, `htmlcov/`, `storybook-static/`, `playwright-report/`, `test-results/`, `allure-results/`, `allure-report/`, `cdk.out/`, `*.egg-info/`, `*.dist-info/`, `eggs/`, `wheels/`, `pip-wheel-metadata/`, `cmakefiles/`, `cmake-build-*/`, `bazel-*/`, `pods/`, `deriveddata/`.
- Fix: write `.zcodeignore` as clean UTF-8 WITHOUT BOM, preserving BOTH blocks (`.gitignore` content + the generic block above), stripping only the mojibake header lines.
- Then `git add .zcodeignore` to track it (recommended: it mirrors a committed `.gitignore`). **Judgment call — confirm with requester**; alternative is adding `.zcodeignore` to `.gitignore` as a local tool file.

## Step D — Untrack generated artifacts (ALLOW-LIST ONLY)
Untrack ONLY the two path scopes below. Do NOT run a blanket "untrack anything gitignored" sweep.
- `git rm -r --cached .ua/` — 141 tracked files. On-disk directory is ~30.85 MB (includes untracked/ignored content); the tracked subset is ≈13.5 MB. Contents: `knowledge-graph.json`, `.trash-*/assembled-graph.json`, `fingerprints.json`, `intermediate/`, `batches*.json`, `config.json`, `meta.json`, `.understandignore`.
- `git rm -r --cached packages/opencode/.rubik/` — untracks the ENTIRE tree (both `cache/ast_index.json` (3.41 MB) and `sessions/*.jsonl`), kept on disk.

DO NOT untrack (intentionally tracked despite matching ignore rules):
- `.opencode/opencode.jsonc`
- `.opencode/plugins/tui-smoke.tsx`
- `.opencode/plugins/smoke-theme.json`
- `.opencode/.gitignore`
- `.opencode/themes/.gitignore`
- `.vscode/launch.example.json`
- `.vscode/settings.example.json`
- `packages/diff-wasm/pkg/opencode_diff_rs.js`
- `packages/diff-wasm/pkg/opencode_diff_rs.d.ts`
- `packages/opencode/script/build-node.ts`

Self-consistency check: re-run `git ls-files -i -c --exclude-standard` during execution and confirm EVERY returned path is either in the do-NOT-untrack list above or under `.ua/` / `packages/opencode/.rubik/`. If any path is none of those, STOP and reconcile before proceeding.

Verification of ignore coverage (use `--no-index` while the file is still tracked):
- `git check-ignore --no-index -v packages/opencode/.rubik/cache/ast_index.json` -> expect `.gitignore:48:.rubik/`, exit 0.
- After `git rm -r --cached`, confirm `git check-ignore -v packages/opencode/.rubik/cache/ast_index.json` still matches.

## Step E — `.gitignore` gaps
- Verify root `/*.png` and `/*.diff` rules exist (currently `.gitignore:51`/`:52`).
- Add `.ua/` to root `.gitignore` (`.ua/` is currently NOT ignored — required).
- Leave `packages/opencode/models-snapshot.js` as intentionally gitignored (documented).
- Quirk: `git check-ignore --no-index -v ".ua/"` (trailing slash) returns a phantom match at `.gitignore:49` (a blank line). Do NOT test with the trailing slash; use `git check-ignore --no-index -v .ua` or `.ua/<file>` to prove the new ignore rule.

## Ordering conflict (resolve before executing)
`_arch-review.md` and `CODE_REVIEW.md` are the SUBJECTS of two UNEXECUTED plans — `_plan/verify-arch-review-2026-09-22.md` and `_plan/fix-code-review-findings-2026-09-22.md` — which assume those files live at ROOT and are untracked (their text asserts `?? _arch-review.md` / `?? CODE_REVIEW.md`). Both files are now TRACKED, so those plans' state notes are stale. This hygiene pass moves them into `_review/`.
- Required action: resolve or explicitly abandon those two plans BEFORE this hygiene pass, or accept that they must be re-pathed. Flag to the requester; do not silently invalidate them.

## Verification (run after all steps A–E)
1. `git status --short` — expect staged renames (R), deletions (D), and `.zcodeignore` staged (A).
2. `git ls-files .ua/` -> empty; `git ls-files packages/opencode/.rubik/` -> empty.
3. `git ls-files CODE_REVIEW.md _arch-review.md subagent-effect-trypromise-report.md typegraph-exploration-report.md ai-sdk-updates.md other-package-updates.md permission-improvements.md plan-opencode-memory-reduction-2026-08-02.md` -> all absent; `git ls-files _review/CODE_REVIEW.md _review/_arch-review.md _review/ai-sdk-updates.md _review/other-package-updates.md _proposal/permission-improvements-superseded-2026-08-15.md _plan/plan-opencode-memory-reduction-2026-08-02.md` -> all present.
4. `git ls-files "Screenshot From 2026-08-25 21-29-49.png"` -> empty.
5. `git grep -F -n "<old-basename>"` for every moved basename -> the ONLY remaining old-basename hits are the intentional historical/manifest mentions named in Step B (`docs/plans/2026-09-09-gitnexus-plan-v1-v2-consistency.md:227`, `_plan/fix-code-review-findings-2026-09-22.md:190,294`). Run this AFTER Step D so `.ua/*.json` noise is gone.
6. `git diff --cached --stat` shows ONLY markdown moves / `.zcodeignore` / `.ua`+`.rubik` deletions — no `.ts` source files.

Explicit note: this pass makes NO `.ts`/source behavior changes, so `bun typecheck` is NOT required. Confirm via `git status` that no source file is modified.

## Rollback note
All operations are `git mv` / `git rm --cached` / `git rm` plus markdown text edits; nothing is pushed.
- Undo uncommitted moves/untracks: `git reset --hard HEAD` or `git restore --staged --worktree .`.
- Undo a `git rm --cached` untrack: `git add <path>`.
- Undo the screenshot `git rm`: `git checkout HEAD -- "Screenshot From 2026-08-25 21-29-49.png"`.
- All prior file contents remain in git history.

## Exclusions
EXCLUDE: git branch deletion; git stash operations; dead-code/unused-dependency sweeps; any change to `node_modules` or `bun.lock`.

## Architecture Decisions
- `git mv` preserves rename detection/history; moves stay staged.
- Allow-list untracking (not a blanket sweep) protects the 10 intentionally-tracked files.
- `git rm --cached` removes from index only; disk contents preserved for local tools.
- `.zcodeignore` kept aligned with `.gitignore` plus its generic block; track it as shared tool config (judgment call flagged).
- No source changes -> no typecheck/test burden.
