# Plan: README fork highlights section (docs-only)

Date: 2026-09-29
Scope: **DOCS-ONLY** — root `README.md` of `C:\Github\opencode-personal`. No code behavior changes, no build, no tests.

## Goal

Add a concise, user-facing "what this fork adds" section to the root `README.md`, listing the personal fork's notable features/refactors as exactly 12 one-line `-` bullets. Also state the base version the fork is built on. Keep the tone consistent with the existing README: plain, factual, no emojis, no commit SHAs, no internal jargon/persona names.

## Verified facts (evidence for the coder)

### 1. README structure (read from disk, 58 lines total)

- Line 1: `# OpenCode Personal Fork`
- Lines 3–5: two intro paragraphs (fork-vs-upstream disclaimer, `opencode.ai` / upstream repo links).
- Line 7: `## What it can do`
- Lines 9–14: six capability bullets.
- Line 16: paragraph linking the fork documentation site + config/TUI schema links. **This paragraph is the last content of the `## What it can do` section.**
- Line 17: blank line.
- Line 18: `## Get started from source`
- Lines 20–29: source-run instructions (`/connect`, `opencode.json`).
- Lines 31–43: `## Development` (command table).
- Lines 45–54: `## Repository layout` (package table).
- Lines 56–58: `## License`.

The user's rough placement estimate was accurate. Insertion point: **between line 16 (end of `## What it can do` content) and line 18 (`## Get started from source`)**, i.e. replacing the single blank line 17 with `blank + new section + blank`.

### 2. Base version 1.14.48 — CONFIRMED

- `packages/opencode/package.json:3` → `"version": "1.14.48"` (name `opencode`).
- Same `"version": "1.14.48"` in `packages/sdk/js/package.json:4` (`@opencode-ai/sdk`), `packages/app/package.json:3`, `packages/web/package.json:5`, `packages/core/package.json:3`, `packages/plugin/package.json:4`, `packages/ui/package.json:3`.
- No git tags exist in this repo (`git tag --list` empty; `git describe --tags` empty), so the version claim rests on the workspace package versions, which match the upstream OpenCode 1.14.48 source release the fork was cut from.
- Verdict: the phrasing "built on top of the OpenCode 1.14.48 source release" is **verified and safe to assert**. No unverified-claim flag needed.

### 3. Feature sanity checks (paths exist on disk)

`packages/diff-wasm/package.json`, `packages/opencode/src/cli/cmd/tui/component/dialog-usage.tsx`, `packages/opencode/src/v2/session.ts`, `packages/opencode/src/session/prompt.ts` — all present. Full per-item provenance is in the Evidence appendix; the README text itself carries **no SHAs**.

## Steps

1. **Edit `README.md`** (single insertion, nothing else touched):
   - File: `C:\Github\opencode-personal\README.md`
   - Insert the new section (verbatim text below) between the end of the `## What it can do` section (line 16) and the `## Get started from source` heading (line 18).
   - Use the Edit tool with the exact `oldString`/`newString` given under "Verbatim edit" — do NOT rewrite the whole file (repo rule: whole-file writes from stale in-context copies silently revert unrelated sections).
2. **Verify** (see Verification steps): re-read the file, confirm 12 bullets, confirm anchors intact, confirm UTF-8 encoding preserved.
3. **No build, no tests, no typecheck** — README is not consumed by any build target. Do not run `bun typecheck` for this change.

## Verbatim edit

### BEFORE (README.md lines 16–18, exact)

```markdown
See the [fork documentation](https://ozgurulukir.github.io/opencode-personal/) for usage, configuration, providers, and integrations. The generated [config schema](https://ozgurulukir.github.io/opencode-personal/config.json) and [TUI config schema](https://ozgurulukir.github.io/opencode-personal/tui.json) are also published there.

## Get started from source
```

### AFTER (same region with the new section inserted)

```markdown
See the [fork documentation](https://ozgurulukir.github.io/opencode-personal/) for usage, configuration, providers, and integrations. The generated [config schema](https://ozgurulukir.github.io/opencode-personal/config.json) and [TUI config schema](https://ozgurulukir.github.io/opencode-personal/tui.json) are also published there.

## What this fork adds

This fork is built on top of the OpenCode 1.14.48 source release. Notable changes maintained in this repository:

- Provider usage & quotas in `/usage` — Anthropic (Claude), ZAI, and ClinePass (5-hour/weekly/monthly limits, credit balance, and plan info).
- Unified V1/V2 session architecture with a single V2 SDK surface.
- Local semantic workspace search (zvec) with automatic skill matching.
- A Rust/WASM diff engine (`packages/diff-wasm`).
- ACP (Agent Client Protocol) terminal backend support (e.g. Zed).
- TUI enhancements: ghost-text next-prompt suggestions, shell `!` output rendering, and a unified spinner.
- Permission system hardening: MCP tool keys, deny-first evaluation, persisted "always allow", and subagent parity.
- Prompt/session engine refactors: decomposed `prompt.ts` (2146 → 374 lines) and split provider message transforms.
- Auto-compaction improvements: `context_limit` config, summary budget, and metadata preservation.
- Performance work: event-loop starvation fixes, O(1) session summarize, batched DB writes, and embedded-UI caching.
- Monorepo pruning & build/CI hardening: removed unused packages, a personal-fork typecheck workflow, and a hardened dependency-update checker.
- Tooling: multi-skill loading, strict skill validation, and hunk-diff integration with todo autoclose.

## Get started from source
```

### Edit-tool invocation shape for the coder

- `oldString`: the three lines quoted in BEFORE (line 16 paragraph + blank line + `## Get started from source`).
- `newString`: the AFTER block above (line 16 paragraph + blank + new section + blank + `## Get started from source`).
- The `oldString` is unique in the file (the docs-link paragraph appears once; `## Get started from source` appears once), so a single non-`replaceAll` edit is safe.

## Architecture Decisions

1. **Placement — after `## What it can do`, before `## Get started from source`.** The fork-specific additions read naturally right after the generic capability list and before setup instructions. Alternative (top of file, after intro) was rejected: it would bury the upstream disclaimer and push "how to run" further down.
2. **Base-version line — in the new section's intro, not the existing intro paragraph.** The sentence directly frames the additions listed beneath it ("built on X … notable changes:"). The existing intro paragraphs (lines 3–5) establish the fork-vs-upstream relationship and affiliation disclaimer; mixing a version stamp there conflates two concerns. It also keeps this change a single localized insertion. The wording "the OpenCode 1.14.48 source release" (rather than "OpenCode 1.14.48") matches reality: the fork carries the upstream source at that version, and no prebuilt release is published (README line 20 says so explicitly).
3. **Bullets verbatim from the approved list, `-` markers, one line each, exactly 12.** Code-like tokens keep the backticks the user's list already used (`/usage`, `packages/diff-wasm`, `!`, `prompt.ts`, `context_limit`) — consistent with existing README conventions (`AGENTS.md`, `opencode.json`, `/connect`).
4. **No SHAs, no internal persona/agent names, no docs-site/i18n items, no extra security items** beyond item 7, which the user explicitly included. No numbered list — markdown `-` bullets only.
5. **Encoding note:** the new text introduces non-ASCII characters (em dash `—`, arrow `→`). The Edit tool preserves UTF-8 — do not round-trip the file through PowerShell 5.1 `Set-Content`/`Get-Content` without `-Encoding UTF8` (documented mojibake risk in repo Notes). If an ASCII-only variant is ever preferred, swap `—` → `-` and `→` → `to`; not required for this change.

## Verification steps (for the coder/reviewer)

1. Re-read `README.md` after the edit:
   - Exactly one `## What this fork adds` heading, positioned between `## What it can do` and `## Get started from source`.
   - Exactly 12 `-` bullets under it, in the order given above, each a single line.
   - The intro sentence under the heading contains "OpenCode 1.14.48 source release".
2. Anchors that must remain byte-identical (do not disturb):
   - Line 1: `# OpenCode Personal Fork`
   - Lines 3–5: both intro paragraphs (upstream links, `opencode.ai`).
   - Line 7: `## What it can do` and its six bullets (lines 9–14).
   - Line 16: the fork-documentation paragraph with its three links (`fork documentation`, `config schema`, `TUI config schema`).
   - `## Get started from source` heading and everything after it (lines 18–58 pre-edit).
3. Markdown render check: no build needed (the root README is not part of the `packages/web` Astro build). Eyeball the GitHub preview: heading levels consistent (`##`), bullets render as a list, backticked inline code renders, no broken link syntax introduced (the edit adds no links).
4. Encoding check: `git diff` shows only the inserted block (context lines unchanged); confirm the em dashes/arrows are not mojibake in the diff output.

## Open Questions

None blocking. Two minor reviewer options, both defaulting to "no":
- Whether to also mention the base version in the line-5 intro paragraph — decided against (see Architecture Decisions #2).
- ASCII-only variant of the bullets — decided against; UTF-8 is standard for the repo's markdown.

---

## Evidence / provenance (appendix — SHAs live here, NOT in the README)

Per-item commit evidence supplied by the user (not re-verified commit-by-commit in this planning pass; feature paths spot-checked on disk as listed above):

1. `/usage` providers & quotas: `d3c10b84a`, `4e007ca21`, `140eaa271`, `3400131ba`
2. V1/V2 session architecture + V2 SDK surface: `cb7fbd990`, `9d9fe54bc`, `83304e137`
3. Local semantic workspace search (zvec) + skill matching: `1b6b843ad`, `77c0ed160`, `6a9be4c3f`
4. Rust/WASM diff engine: `2550d5e82`, `d83ad7c3c`
5. ACP terminal backend: `56dd7dd7d`, `c21ae6501`
6. TUI enhancements (ghost text, `!` output, unified spinner): `9a2655ac2`, `aee464362`, `70ff28fb6`
7. Permission hardening (MCP keys, deny-first, persisted allow, subagent parity): `b19c07c41`, `e8a9e7bb1`, `dc1e8e673`, `8ffdaac94`
8. Prompt/session engine refactors: `c3355e186`, `69d16edef`
9. Auto-compaction improvements: `121609180`, `3d4685aee`, `de83d2f27`
10. Performance work: `9d8af93e8`, `728b5b648`, `23cd618b2`, `020297f99`
11. Monorepo pruning & build/CI hardening: `da04681dd`, `56b75ca1b`, `a271521a8`, `c25068db4`
12. Tooling (multi-skill, strict validation, hunk-diff + todo autoclose): `d5497f0c1`, `b796a61a0`, `6c855ac76`

Base-version evidence: `packages/opencode/package.json:3`, `packages/sdk/js/package.json:4`, `packages/app/package.json:3`, `packages/web/package.json:5`, `packages/core/package.json:3`, `packages/plugin/package.json:4`, `packages/ui/package.json:3` — all `"version": "1.14.48"`; `git tag --list` empty (no tags in fork).
