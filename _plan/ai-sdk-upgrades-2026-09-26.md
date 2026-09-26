# Plan: AI SDK dependency upgrades (minor/patch, same-major) — `ai@6` line

- **Date:** 2026-09-26
- **Status:** ⏳ PENDING EXECUTION
- **Provenance:** Derived from `_review/ai-sdk-updates.md` (generated 2026-09-26, NOT APPLIED). All `from` values below were verified against the tree on 2026-09-26.

## Goal

Apply ALL 22 minor/patch (same-major) AI SDK dependency upgrades from `_review/ai-sdk-updates.md`. Do NOT cross any major. This is a **version-bumps-only plan**: edits are exact version tokens in two `package.json` files + the resulting `bun install`. No source-code changes are expected. If any bump breaks typecheck/tests, **REVERT that bump and report** — never patch code to accommodate it.

## Scope — exact edits (verify line anchors before editing)

Root `C:\Github\opencode-personal\package.json` — `workspaces.catalog` (current anchor: line 52):

| Package | From | To |
| --- | --- | --- |
| `ai` | `6.0.246` | `6.0.292` |

`C:\Github\opencode-personal\packages\opencode\package.json` — direct pins (current anchors; verify):

| Package | From | To | Line |
| --- | --- | --- | --- |
| `@ai-sdk/alibaba` | `1.0.45` | `1.0.59` | :79 |
| `@ai-sdk/amazon-bedrock` | `4.0.153` | `4.0.183` | :80 |
| `@ai-sdk/anthropic` | `3.0.110` | `3.0.122` | :81 |
| `@ai-sdk/azure` | `3.0.101` | `3.0.126` | :82 |
| `@ai-sdk/cerebras` | `2.0.73` | `2.0.84` | :83 |
| `@ai-sdk/cohere` | `3.0.54` | `3.0.64` | :84 |
| `@ai-sdk/deepinfra` | `2.0.71` | `2.0.82` | :85 |
| `@ai-sdk/gateway` | `3.0.173` | `3.0.202` | :86 |
| `@ai-sdk/google` | `3.0.109` | `3.0.127` | :87 |
| `@ai-sdk/google-vertex` | `4.0.182` | `4.0.205` | :88 |
| `@ai-sdk/groq` | `3.0.59` | `3.0.69` | :89 |
| `@ai-sdk/mistral` | `3.0.57` | `3.0.67` | :90 |
| `@ai-sdk/openai` | `3.0.96` | `3.0.118` | :91 |
| `@ai-sdk/openai-compatible` | `2.0.67` | `2.0.78` | :92 |
| `@ai-sdk/perplexity` | `3.0.53` | `3.0.63` | :93 |
| `@ai-sdk/provider` | `3.0.15` | `3.0.17` | :94 |
| `@ai-sdk/provider-utils` | `4.0.45` | `4.0.54` | :95 |
| `@ai-sdk/togetherai` | `2.0.73` | `2.0.84` | :96 |
| `@ai-sdk/vercel` | `2.0.69` | `2.0.80` | :97 |
| `@ai-sdk/xai` | `3.0.121` | `3.0.136` | :98 |
| `gitlab-ai-provider` | `6.12.1` | `6.18.0` | :136 |

**Total = 1 catalog edit + 21 direct pins = 22 edits, 2 files.**

> `packages/opencode/package.json` line 124 is `"ai": "catalog:"` — DO NOT add/replace a literal `ai` version there; the root catalog edit propagates.

## OUT of scope (do NOT touch)

- `@openrouter/ai-sdk-provider` (2.10.0), `ai-gateway-provider` (3.2.0), `venice-ai-sdk-provider` (2.1.1) — already latest same-major.
- Any MAJOR bump. For every `@ai-sdk/*` package and `ai`, npm `latest` points at a NEWER MAJOR (ai@7, providers 4.x/5.x). Do not use `latest`.
- No source files, no `patches/`, no `patchedDependencies`, no other manifests, no `github/package.json`.
- No `^`/`~` ranges — keep exact pins.

## Architecture Decisions — Apply method

**Decision:** Edit both files directly with explicit, precise per-line edits (all 22), then run `bun install` once from repo root.

**Rationale:** `bun run script/check-updates.ts --apply` CAN apply the catalog bump — its `collectPinnedDeps` scans `workspaces.catalog` and `applyTargets` rewrites the catalog block (check-updates.ts:245-251, :325-338) — so capability is not the issue. The manual edit set is preferred on real merits: it is explicit and auditable (each of the 22 version tokens is a reviewable diff line), it needs exactly one `bun install` operation afterward, and it avoids the script's block-level manifest rewriting/reformatting. A fully manual, explicit edit set is the least-surprising, most auditable path.

**Alternatives considered:**
- *Script-driven apply (`check-updates.ts --apply`):* rejected — the script rewrites dependency blocks wholesale (manifest reformatting risk) and mixes provenance between script-applied and hand-applied hunks, making the diff coarser and less auditable than 22 explicit token edits.
- *Range-based bumps (`^`):* rejected — repo convention is exact pins; ranges would silently absorb future minors.

**Trade-offs:** Manual edits are 22 discrete operations (slower to type, trivial to review via `git diff`); the script path is faster but rewrites whole manifest blocks, so its diff is coarser and carries unrelated-churn risk.

## Steps

### Step 0 — Pre-flight

1. `git status` — must be clean; else stop and report.
2. Record current HEAD SHA for rollback.
3. Confirm the 22 `from` values on disk match this plan (if any drifted, stop and report).

### Step 1 — Apply the 22 exact version-token edits

1. Edit root `package.json` (1 catalog entry) and `packages/opencode/package.json` (21 pins) per the tables above.
2. Add a row for this plan to `_plan/index.md` (chronological table; MANDATORY — the index carries an explicit "new plan → add a row" rule).
3. `git diff --stat` must show ONLY `package.json`, `packages/opencode/package.json`, and `_plan/index.md`. No source files.

### Step 2 — `bun install` from repo root

1. Run `bun install` once from repo root.
2. Audit `git diff bun.lock`: keep only hunks attributable to the 22 bumps (version + integrity changes).
3. Remediate unrelated churn (configVersion removal, integrity stripping, formatting) hunk-by-hunk: restore ONLY the non-bump hunks back to their HEAD state — take just those hunks from `git show HEAD:bun.lock`, NOT the whole file — and keep every hunk attributable to the 22 bumps. NEVER hand-edit integrity hashes; revert whole hunks back to their HEAD state instead. Then re-run `bun install` to confirm the reverted hunks do not regenerate.
4. Note the known accepted-noise `ghostty-web#main` github: ref drift if it appears.

### Step 3 — Verification

1. **Typecheck (primary):** `bun run --cwd packages/opencode typecheck` (tsgo). This is the largest blast radius.
   - Note the pre-push hook runs `bun turbo typecheck` across all packages.
2. **`packages/app` guard (unconditional):** `packages/app` imports `@opencode-ai/sdk` (not the raw AI SDK) → likely unaffected, but run it as a cheap guard: delete `packages/app/node_modules/.ts-dist` (stale tsgo -b build-info can mask errors), then run `bun run --cwd packages/app typecheck`.
3. **Targeted tests** — each from `packages/opencode` (NEVER repo root — root `bun run test` is a blocked guard). Always pass `--timeout 30000` (matches the package's `test` script at `packages/opencode/package.json:10`; bare `bun test` defaults to 5s and can spuriously time out heavier cases). Verify each path exists; drop/rename any that don't:
   - `bun test --timeout 30000 test/provider/provider.test.ts`
   - `bun test --timeout 30000 test/provider/transform.test.ts`
   - `bun test --timeout 30000 test/session/llm.test.ts`
   - `bun test --timeout 30000 test/session/usage.characterization.test.ts`
   - `bun test --timeout 30000 test/server/httpapi-provider.test.ts`
4. **Optional full package suite:** `bun run --cwd packages/opencode test`. Known pre-existing flakes are NOT regressions (from AGENTS.md):
   - `usage.characterization.test.ts:76`
   - the permission `reply - reject …` flake
   - ModelsDev snapshot `get() returns {} when disk empty`
   - `session.system > skills output is sorted`
   - Isolate any new failure with `bun test <file>` before attributing it to a bump.
5. **Report-only check:** `bun run script/check-updates.ts` — the 22 targets should no longer be flagged as upgradable (unless the registry advanced past the pinned target; if so, that is expected drift, not a failure — the approved targets are authoritative). Because the `ai` bump targets a catalog entry, `check-updates.ts` will display it under the `[catalog] package.json` group — expected, not a failure.

**Expected observations / failure vs noise:**
- Typecheck passing with zero new errors = success. New `TS2307` on `diff-wasm` = unrelated missing WASM artifacts (run `bun run build:wasm` in `packages/diff-wasm`), not a bump failure.
- Targeted tests passing = success. Any of the four known flakes above failing = noise unless reproducible in isolation with the new versions.
- `check-updates.ts` still flagging a target = registry drift, not failure.

### Explicitly NOT required / NOT done

- SDK regeneration (`packages/sdk/js/script/build.ts`): NOT needed — provider-library bumps do not change the server OpenAPI-visible schema/config contract. If a generated SDK type error appears, report it as a surprise; do not regen reflexively.
- No source-code changes.
- No major-version bumps.
- The 3 no-op packages listed in OUT of scope.

### Rollback

- **Full:** `git checkout -- package.json packages/opencode/package.json` then `bun install` (restores both manifests; `bun.lock` returns via the reinstall — if needed restore `git show HEAD:bun.lock` first).
- **Per-package:** revert the single version token to its `from`, `bun install`, re-run the failing verification. Report the reverted package + failure mode; do NOT patch code.

## Risks

- `@ai-sdk/provider-utils` and `@ai-sdk/provider` are foundational (every provider consumes them) — highest-leverage bump; typecheck covers.
- `@ai-sdk/openai` / `anthropic` / `google` / `google-vertex` / `amazon-bedrock` / `azure` / `gateway` carry behavioral changes — targeted provider/transform/llm tests cover.
- `gitlab-ai-provider` is a MINOR bump (6.12.1 → 6.18.0) with behavioral changes — no dedicated test; typecheck + smoke.
- Lockfile churn (known) — mitigated by hunk audit.
- Registry drift: targets were approved against a 2026-09-26 snapshot; if the registry advanced, keep the approved targets.

## Incidental

- Add this plan to `_plan/index.md` — MANDATORY (the index carries an explicit "new plan → add a row" rule); performed in Step 1.

## Open Questions

- None blocking. All `from` anchors verified 2026-09-26; re-verify on-disk values at execution time (Step 0).
