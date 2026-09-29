# Plan: Append security-hardening bullet to README "What this fork adds"

Date: 2026-09-29
Scope: docs-only, single-line insertion in root `README.md`. No code changes.

## 1. Goal / Context

Append one bullet summarizing the fork's security hardening work to the existing `## What this fork adds` section in the repo-root `README.md`, placed immediately after the "Permission system hardening" bullet so security/permission items stay grouped. This is an insertion-only docs change; nothing else in the file (or repo) is touched.

## 2. Verified Preconditions (checked against the real README)

- `## What this fork adds` section exists at `README.md:18`.
- Anchor bullet exists at `README.md:28` and is **unique** in the file (grep for `Permission system hardening` returns exactly 1 match), so a single exact-string insertion applies unambiguously.
- Existing list style: leading `- `, single line, no SHA, no emoji, no persona/author names. The new bullet matches this style.
- File is UTF-8; the insertion is pure ASCII, so encoding is preserved by any UTF-8-safe edit.

## 3. Exact Strings (verbatim)

**Anchor string (existing bullet, `README.md:28` — copy exactly, including the straight quotes around `"always allow"`):**

```
- Permission system hardening: MCP tool keys, deny-first evaluation, persisted "always allow", and subagent parity.
```

**New bullet (insert on the line immediately after the anchor — copy verbatim, do not reword, do not wrap, single line):**

```
- Security hardening: SSRF protection in the webfetch tool, strict CORS origin validation, command-injection and path-traversal fixes, read-tool symlink-escape prevention, TUI log-leak prevention, and cryptographically strong dialog IDs.
```

## 4. Edit Instructions (single exact-string insertion)

1. Open root `README.md`.
2. Find the exact anchor string from §3 (it occurs exactly once).
3. Replace the anchor string with: anchor string + `\n` + new bullet (i.e., the new bullet becomes the next line directly after the permission bullet, before the existing "Prompt/session engine refactors" bullet).
4. Save as UTF-8. Do not reflow, rewrap, or reformat any other line.

Resulting region (lines 28–29 after edit):

```
- Permission system hardening: MCP tool keys, deny-first evaluation, persisted "always allow", and subagent parity.
- Security hardening: SSRF protection in the webfetch tool, strict CORS origin validation, command-injection and path-traversal fixes, read-tool symlink-escape prevention, TUI log-leak prevention, and cryptographically strong dialog IDs.
- Prompt/session engine refactors: decomposed `prompt.ts` (2146 → 374 lines) and split provider message transforms.
```

## 5. Verification Steps (after edit)

1. **Re-read the region:** read `README.md` around lines 26–32 and confirm:
   - The new bullet sits on the line immediately after the "Permission system hardening" bullet.
   - The "Prompt/session engine refactors" bullet and all other lines are unchanged and in original order.
   - The new bullet is a single line (no wrapping) and matches §3 verbatim.
2. **Diff check:** run `git diff -- README.md` and confirm:
   - Exactly one added line (the new bullet), zero removed lines, zero context drift.
   - No other file appears in the diff.
3. Optionally re-run the uniqueness grep for the anchor (`Permission system hardening` → still exactly 1 match) to confirm no accidental duplication.

## 6. Out-of-Scope / Non-Goals

- **No `packages/web` security items.** The bullet deliberately excludes any browser-output/share-component security work; it is intentionally non-web.
- No other edits: do not modify, reorder, reword, or wrap any existing line; do not touch any other file.
- No SHA references, emoji, or persona/author names in the bullet.
- No code changes, no SDK regeneration, no typecheck/test runs required (docs-only).
