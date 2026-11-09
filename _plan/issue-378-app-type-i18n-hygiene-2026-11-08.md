# Plan: [app] Type, i18n parity, and local typecheck-cache hygiene (issue #378)

**Branch:** `issue-378-app-type-i18n-hygiene` (checked out) · **Mode:** plan only — no code written.
**Status:** ⬜ PENDING
**Anchor re-verification:** every `file:line` citation below was re-verified against the working tree on **2026-11-09** (plan authored for the issue filed 2026-11-08; the repo AGENTS.md documentation-integrity rule applies). The coder MUST re-verify each anchor immediately before editing.

Supplementary findings read: `_plan/webui-review-findings-2026-11-08.md` (items **A-8** type posture, **A-9** 2-key parity spot check, **A-10** tsgo cache).

---

## Goal

Land the three mandatory acceptance criteria of ozgurulukir/opencode-personal **#378** in `packages/app`, with minimal diffs and no new dependencies:

1. **`@ts-expect-error` hygiene** — every active directive in scope carries an explanatory comment (or is removed as stale). At minimum: `packages/app/src/components/prompt-input.tsx:1359` (currently **bare**) and `packages/app/happydom.ts:6` (already commented — verify only).
2. **Full i18n parity** — `packages/app/src/i18n/parity.test.ts` must assert **full key-set equality** across all **17** locale files, not the current 2-key spot check (`parity.test.ts:20-21`), with drift handling grounded in the system's actual missing-key semantics (decided in Architecture Decision D1).
3. **Typecheck-cache hygiene note** — `packages/app/AGENTS.md` gains a note to delete stale `*.tsbuildinfo` (`node_modules/.ts-dist/tsconfig.tsbuildinfo`) after SDK regenerations, echoing the root AGENTS.md rule (tsgo -b incremental cache can mask errors locally; pre-push can pass on a stale cache while a clean box fails).

Also fix the now-stale `packages/app/AGENTS.md` claim that "`parity.test.ts` only spot-checks specific keys, not full parity" (documentation-integrity rule).

**Explicitly out of scope (deferred):** see *Deferred* section — notably A-13 (ui prod `as any` clusters). Context only, not changed: app prod `as any` = 2 (`file-tabs.tsx:445`, `vite.config.ts:23` — both re-verified).

---

## Verified anchors (re-verified 2026-11-09)

| Claim | Verdict | Verified location / evidence |
| --- | --- | --- |
| `prompt-input.tsx:1359` active `@ts-expect-error` | ✓ **bare, no comment** | `packages/app/src/components/prompt-input.tsx:1359` — between `inputMode="text"` (:1358) and `autocomplete="off"` (:1360) |
| `happydom.ts:6` | ✓ **path drift corrected** | `packages/app/happydom.ts:6` — package **root**, not under `src/`; it is the bun test preload (`bunfig.toml:3`, `package.json:18-20`). **Already has** explanatory comment: `// @ts-expect-error - we're overriding with a simplified mock` |
| `parity.test.ts:20-21` = 2-key spot check | ✓ | `const locales = [...]` (:20, 16 non-en dicts), `const keys = ["command.session.previous.unseen", "command.session.next.unseen"]` (:21); single test :23-31 |
| 17 locale files under `src/i18n/` | ✓ | `en, ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht` (`.ts`, not `.json`) + `parity.test.ts` |
| `package.json:12` | ✓ | `"typecheck": "tsgo -b"` |
| `tsconfig.json:18` | ✓ | `"outDir": "node_modules/.ts-dist"` (include = `["src", "package.json"]` → **`happydom.ts` and `vite.config.ts` are NOT in the tsgo program**) |
| tsbuildinfo on disk | ✓ | `packages/app/node_modules/.ts-dist/tsconfig.tsbuildinfo` (671,043 B) + `.../.ts-dist/e2e/tsconfig.tsbuildinfo` |
| App prod `as any` = 2 (context only) | ✓ | `src/pages/session/file-tabs.tsx:445` (`onScroll={... as any}`), `vite.config.ts:23` (`plugins: [desktopPlugin, sentry] as any`) |
| Baseline `bun typecheck` (packages/app) | ✓ **green, exit 0** | ⇒ `prompt-input.tsx:1359` directive is **active, not stale** (a stale one fails as TS2578) |
| Existing parity test | ✓ **1 pass, 64 expects** | `bun test parity.test.ts` from `packages/app` |

**Both directives confirmed ACTIVE by probe (tsgo reports TS2578 for unused directives — probe verified):**

- `prompt-input.tsx:1359` suppresses: `TS2322: Property 'autocomplete' does not exist on type 'DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>'`. Root cause: solid-js `HTMLAttributes<T>` (`node_modules/solid-js/types/jsx.d.ts:1206-1282`) has **no** `autocomplete`; the prop exists only on `FormHTMLAttributes` (:1460), `InputHTMLAttributes` (:1573), `SelectHTMLAttributes` (:1880), `TextareaHTMLAttributes` (:1951). The HTML spec permits `autocomplete` on `contenteditable` elements and browsers honor it → **genuine library type-coverage gap → comment, not removal.**
- `happydom.ts:6` suppresses: `TS2322: Type '(contextType: string, _options?: unknown) => RenderingContext | null' is not assignable to` lib.dom's **overloaded** `HTMLCanvasElement.getContext` (the `"2d"` overload demands `CanvasRenderingContext2D | null`; the unified mock signature can't satisfy every per-contextId overload). Standalone check: `tsgo --ignoreConfig --noEmit --strict --skipLibCheck --lib dom,esnext --module esnext --moduleResolution bundler --target esnext happydom.ts` → exit 0 **with** directive (no TS2578 ⇒ actively suppressing). Because the file is outside the `tsgo -b` program, package typecheck cannot validate it — use the standalone command above for verification.

---

## Discovered i18n missing-key semantics (grounds D1)

Read from `packages/app/src/context/language.tsx`:

1. **Runtime fallback = silent English.** `base = i18n.flatten({ ...en, ...uiEn })` (:96); each non-English loader merges `{ ...base, ...flatten({ ...localeDict, ...uiLocaleDict }) }` (`merge`, :99-100). A key absent from a locale file is **overlaid by the English value** — no throw, no raw key rendered, invisible to users as drift (they just see English).
2. **Translator**: `i18n.translator(() => dict() ?? base, ...)` (:211) — with the merge, every `en` key is always present, so key-not-found never occurs for en-defined keys.
3. **Type level permits gaps by design (inconsistently):** only **5 of 16** non-English files close with `} satisfies Partial<Record<Keys, string>>` (`de.ts:858`, `no.ts:923`, `tr.ts:931`, `zh.ts:907`, `zht.ts:903`, with `import { dict as en }` + `type Keys = keyof typeof en` at the top). The other **11** (`ar, br, bs, da, es, fr, ja, ko, pl, ru, th`) are **completely untyped** (`export const dict = { ... }`, no import/annotation). `en.ts` itself has no annotation (source of truth). So `tsgo -b` stays green regardless of missing keys; only unknown/typo keys fail typecheck — and only in the 5 guarded files.
4. **Loader boundary is loose:** `Source = { dict: Record<string, string> }` (:30).

**Measured drift (computed against the working tree):**

- `en` = **844** keys; every one of the 16 non-English locales = **818** keys; **extra keys = 0 everywhere**.
- The missing set is **perfectly uniform**: the **same 26 keys** missing from all 16 locales (16 × 26 = 416 missing entries).
- All 26 keys are **live UI strings** (verified call sites, e.g. `settings-general.tsx:141,158,262-263,336,340-389`, `layout.tsx:965,972,2020,2022`, `session.tsx:1104-1105`, `session-composer-region.tsx:271,278`, `status-popover-body.tsx:259,326`, `settings-keybinds.tsx:416`) — i.e. **currently rendering English in all 16 non-English UIs**.
- Provenance: added to `en.ts` in fork mega-commit `c801127e3f`, never propagated (e.g. `git log -S 'settings.general.row.shell.title' -- de.ts` = empty) → **unintentional drift, not intentional omission**.
- Context only (NOT asserted by the expanded test): 1,796 values across locales are string-identical to `en` (proper nouns, "OK"-style labels, etc.) — value-inequality beyond the existing 2-key check is out of scope.

Only `parity.test.ts` touches locale files in tests (no other test impact).

### The 26 keys (en values — translation source of truth)

| # | key | en value |
| --- | --- | --- |
| 1 | `command.project.previous` | Previous project |
| 2 | `command.project.next` | Next project |
| 3 | `session.child.promptDisabled` | Subagent sessions cannot be prompted. |
| 4 | `session.child.backToParent` | Back to main session. |
| 5 | `dialog.mcp.toggle` | Toggle {{name}} MCP |
| 6 | `session.review.noUncommittedChanges` | No uncommitted changes yet |
| 7 | `session.review.noBranchChanges` | No branch changes yet |
| 8 | `status.popover.server.switch` | Switch to {{name}} |
| 9 | `sidebar.empty.title` | No projects open |
| 10 | `sidebar.empty.description` | Open a project to get started |
| 11 | `settings.general.section.advanced` | Advanced |
| 12 | `settings.general.row.shell.title` | Terminal Shell |
| 13 | `settings.general.row.shell.description` | Choose the shell used for your terminal. Compatible shells are also used for agent tool calls. |
| 14 | `settings.general.row.shell.autoDefault` | Auto (Default) |
| 15 | `settings.general.row.shell.terminalOnly` | terminal only |
| 16 | `settings.general.row.showFileTree.title` | File tree |
| 17 | `settings.general.row.showFileTree.description` | Show the file tree toggle and panel in desktop sessions |
| 18 | `settings.general.row.showNavigation.title` | Navigation controls |
| 19 | `settings.general.row.showNavigation.description` | Show the back and forward buttons in the desktop title bar |
| 20 | `settings.general.row.showSearch.title` | Command palette |
| 21 | `settings.general.row.showSearch.description` | Show the search and command palette button in the desktop title bar |
| 22 | `settings.general.row.showTerminal.title` | Terminal |
| 23 | `settings.general.row.showTerminal.description` | Show the terminal button in the desktop title bar |
| 24 | `settings.general.row.showStatus.title` | Server status |
| 25 | `settings.general.row.showStatus.description` | Show the server status button in the desktop title bar |
| 26 | `settings.shortcuts.edit` | Edit {{title}} shortcut |

---

## Steps (execute in this order)

### Step 1 — `@ts-expect-error` hygiene (acceptance criterion 1)

**File: `packages/app/src/components/prompt-input.tsx`** — replace the bare directive at **:1359** (one line):

```tsx
// @ts-expect-error - solid-js HTMLAttributes<HTMLDivElement> has no `autocomplete` (only Form/Input/Select/Textarea attrs do); valid on contenteditable per the HTML spec and honored by browsers
```

- Directive + explanation on the **same line** (matches `happydom.ts:6` style; TS reads text after the marker).
- Do NOT remove the directive and do NOT remove the `autocomplete="off"` attribute: removal of the directive is a compile error (probe-verified), and the attribute is intentional (autofill suppression on the contenteditable editor).

**File: `packages/app/happydom.ts`** — **verify only, no change** (comment at :6 already satisfies the rule; directive probe-verified active). Optional (not required, keep minimal): strengthen the comment to name the mismatch, e.g. `// @ts-expect-error - simplified mock's unified signature can't satisfy lib.dom's per-contextId getContext overloads`.

Re-verify both with `bun typecheck` (Step 5). Note the self-verification nuance: removing an unnecessary directive errors **only for files inside the tsgo program** — true for `prompt-input.tsx` (under `src/`), NOT for `happydom.ts` (package root) → use the standalone tsgo command from the anchors table for the latter.

### Step 2 — Translate the 26 missing keys into all 16 non-English locales (acceptance criterion 2 enabler)

**Files (16):** `packages/app/src/i18n/{ar,br,bs,da,es,fr,ja,ko,no,pl,ru,th,tr,zh,zht}.ts` — **+26 lines each = 416 new lines total**. `en.ts` unchanged (source of truth).

For each file, add exactly the 26 keys from the table above with natural translations:

- **Preserve placeholders exactly:** `{{name}}` (keys 5, 8) and `{{title}}` (key 26) — consumed by `i18n.resolveTemplate`; a mangled placeholder breaks interpolation silently.
- **Key 15 (`shell.terminalOnly`)** is an inline lowercase fragment appended in parentheses at `settings-general.tsx:158` — translate as a short lowercase fragment matching en's style (e.g. de: `nur Terminal`), not a full sentence.
- **Mirror each file's existing terminology/tone** — style anchors already translated in every locale: `settings.general.row.showSessionProgressBar.*`, `command.session.previous/next`, `sidebar.*`, `settings.shortcuts.*`. E.g. de uses "Sitzung" for session, fr uses "session", etc. Descriptions (13, 17-25) mention "desktop title bar"/"desktop sessions" — translate the copy **as-is**; rewriting en copy is out of scope.
- **Placement is cosmetic** (plain object literal): insert each key adjacent to its section siblings in that file (e.g. `command.project.previous/next` near `command.project.open`; `show*.title/description` near `showSessionProgressBar.*`; `settings.general.section.advanced` near other `settings.general.section.*`; `sidebar.empty.*` near other `sidebar.*`; `session.review.*`, `session.child.*`, `dialog.mcp.*`, `status.popover.*`, `settings.shortcuts.*` near their siblings). For the 5 `satisfies`-guarded files (`de,no,tr,zh,zht`) insert **before** the closing `} satisfies Partial<Record<Keys, string>>` line.
- **Encoding:** files are UTF-8 with non-ASCII content — edit via the Edit/Write tools, **never** PowerShell `Set-Content` (repo known-issue: PS 5.1 mangles UTF-8).
- Guardrail: after edits, every locale must have **844** keys, and each of the 5 guarded files must still satisfy `Partial<Record<Keys, string>>` (all 26 keys exist in `en`, so no type error).

### Step 3 — Expand `parity.test.ts` to full key-set equality (acceptance criterion 2)

**File: `packages/app/src/i18n/parity.test.ts`** (currently 32 lines; all 17 dicts already imported — imports unchanged):

1. Convert the flat `locales` array (:20) into a **name → dict record** so failures identify the locale, e.g. `const locales = { ar, br, bs, da, de, es, fr, ja, ko, no, pl, ru, th, tr, zh, zht } as const` (16 entries; `en` remains the reference).
2. Adapt the existing test's loop to `Object.values(locales)` — **keep the existing 2-key value-inequality test intact** (characterization discipline: we expand, not replace).
3. Add a second test asserting **full key-set equality of every locale against `en`** (this covers all 17 files: en as reference + 16 compared). Reference shape (failure output lists the locale and exact missing/extra keys in one assertion):

```ts
test("every locale has exactly the same key set as en", () => {
  const enKeys = Object.keys(en).sort()
  const enKeySet = new Set(enKeys)
  const drift = Object.fromEntries(
    Object.entries(locales)
      .map(([name, dict]) => {
        const keys = new Set(Object.keys(dict))
        return [name, {
          missing: enKeys.filter((k) => !keys.has(k)),
          extra: [...keys].filter((k) => !enKeySet.has(k)),
        }]
      })
      .filter(([, v]) => v.missing.length > 0 || v.extra.length > 0),
  )
  expect(drift).toEqual({})
})
```

- Sorted key arrays / Sets ⇒ insertion order across files is irrelevant.
- Assert **both directions** (`missing` + `extra`); data shows `extra = 0` everywhere today, so this is safe and catches locale-side typos the `satisfies` guard misses in the 11 untyped files.
- Do **not** assert value-inequality beyond the existing 2 keys (1,796 legitimately en-identical values would fail) and do **not** assert placeholder parity (optional hardening, see Deferred).

### Step 4 — `packages/app/AGENTS.md` updates (acceptance criterion 3 + doc integrity)

**File: `packages/app/AGENTS.md`** — two exact edits:

**(a) New section** inserted after the `## Tool Calling` block (:32-34) and before `## i18n` (:36):

```md
## Type checking

- `bun typecheck` runs `tsgo -b` (incremental; build info at `node_modules/.ts-dist/tsconfig.tsbuildinfo`). After regenerating the SDK (`packages/sdk/js/script/build.ts`) — or whenever type errors look stale or suspiciously absent — delete `*.tsbuildinfo` under `node_modules/.ts-dist/` and re-run `bun typecheck`. The incremental cache can mask errors locally: pre-push passes on this box while a clean checkout fails (echoes the root AGENTS.md SDK-regen rule).
```

**(b) Fix the stale i18n claim** in the `## i18n` bullet (:38). Replace the trailing clause

> `...; parity.test.ts only spot-checks specific keys, not full parity.`

with

> `...; parity.test.ts enforces full key-set equality against en for every locale (plus the targeted value checks), so a missing key fails the test.`

Keep the rest of the bullet (common.* namespace guidance) untouched. Use exact-string replacement, not a whole-file write (repo rule).

### Step 5 — Verification (run from `packages/app` unless noted)

1. **Targeted parity test:** `bun test parity.test.ts` → expect **2 pass** (new key-set test + existing 2-key test).
2. **Negative control (transient, restore before commit):** delete one key (e.g. `settings.shortcuts.edit`) from one locale (e.g. `ar.ts`), re-run → must fail and name `ar` + the key; restore the key (or `git checkout -- src/i18n/ar.ts` if no other edits yet). Proves the test actually bites.
3. **Typecheck:** `bun typecheck` from `packages/app` → exit 0 (also proves `prompt-input.tsx:1359`'s commented directive still suppresses correctly and nothing regressed). Re-check both directives: `rg -n "@ts-expect-error" packages/app` → both hits carry explanatory text.
4. **Stale-cache simulation (criterion 3 evidence):** `Remove-Item packages\app\node_modules\.ts-dist\*.tsbuildinfo -Force` then `bun typecheck` from `packages/app` → must rebuild from scratch and still exit 0. (tsgo regenerates the file on the next run — expected.)
5. **Full unit suite:** `bun run test:unit` from `packages/app` (repo rule: full suite after changes). Record a **baseline run before Step 1** and compare — repo known-issue: order-dependent failures exist; distinguish pre-existing flakes from regressions.
6. **Lint:** `bun run lint` from repo root (oxlint) → no `: error` in changed files; grep output for `no-unused-vars` in the changed files (warnings are pre-existing repo-wide, a passing run alone proves nothing).
7. **Diff review:** `git diff --stat` → expect exactly: `prompt-input.tsx` (1 line), 16 locale files (+26 each), `parity.test.ts`, `packages/app/AGENTS.md`. No `bun.lock`, no `en.ts`, no unrelated churn. (Pre-push runs `bun turbo typecheck` across all packages; only `packages/app` changed — the `diff-wasm` wasm caveat affects `packages/opencode`, not this change.)

### Step 6 — Optional (not required)

- Add an `_plan/index.md` row for this plan (convention says "new plan → add a row", but the index has not been synced for any 2026-10/2026-11 plan — sync has lapsed; follow whatever convention the next plan author settles on).

---

## Architecture Decisions

**D1 — Parity drift: translate the 26 keys; NO allowlist (chosen).**
Grounding: the runtime falls back to English *silently* (`language.tsx:96-100`), the type layer *permits* gaps (`satisfies Partial` / untyped), and the drift is (a) **uniform** across all 16 locales, (b) **unintentional** (single fork commit `c801127e3f` touched `en` only), (c) **live** — real settings/sidebar/review/shortcut strings currently rendering English in non-English UIs, and (d) squarely against the documented convention (`packages/app/AGENTS.md`: new keys go in all 17 locale files). Because nothing crashes, this is hygiene — but an allowlist of 26 keys × 16 locales would institutionalize the gap for live strings and neuter the test's purpose (future drift on those keys would hide behind the same entries). Translating makes full equality achievable with a clean, allowlist-free test.
*Rejected alternative:* allowlist-with-comment in the test — only appropriate for intentionally-omitted keys (e.g. locale-inapplicable copy); none of the 26 qualify.

**D2 — Test design: key-SET equality only, bidirectional, single aggregated assertion.**
Criterion is key-set equality; value-inequality (beyond the existing 2 keys) and `{{param}}` placeholder parity are deliberately not asserted (1,796 en-identical values are legitimate; placeholder checks are useful hardening but expand scope). Aggregating drift into one `expect(drift).toEqual({})` yields failure output that names the locale *and* the keys — strictly more debuggable than 16 × 2 silent array compares.

**D3 — `prompt-input.tsx:1359`: comment, don't fix, don't remove.**
The attribute is valid HTML on contenteditable and intentional; the bug is solid-js's type surface (no `autocomplete` on `HTMLAttributes<HTMLDivElement>`), i.e. exactly the "genuine library type bug" class the repo rule permits — with the mandatory explanatory comment. Removal = TS2322 (probe-verified); dropping the attribute = behavior change (out of scope).

**D4 — `happydom.ts:6`: verify-only.**
Already commented; probe-verified active. No change keeps the diff minimal. It stays outside the tsgo program (adding root files to tsconfig would also pull in `vite.config.ts` and potentially surface unrelated errors — scope creep).

**D5 — Keep locale-file typing as-is (5 guarded / 11 untyped).**
Unifying `satisfies Partial<Record<Keys, string>>` across all 16 files would be nice hardening but is a separate concern; the expanded test now enforces completeness at runtime for all files regardless. Noted as optional follow-up.

**D6 — Single PR on the existing branch; no new dependencies; no SDK regen.**
App-only, test-only, and doc-only changes — no server schema/config change, so `packages/sdk/js` regeneration is unnecessary.

---

## Deferred (out of scope — do NOT implement here)

- **A-13 (findings):** reducing ui prod `as any` clusters — `packages/ui/src/components/line-comment.tsx` (10), `scroll-view.tsx` (9), `file-media.tsx` (6). Optional follow-up only; no steps in this plan.
- **Context only, unchanged:** app prod `as any` = 2 (`file-tabs.tsx:445`, `vite.config.ts:23`); app test `as any` = 24 (mostly `sendFollowupDraft.test.ts`, findings A-13-adjacent note).
- Optional hardenings not in scope: `{{param}}` placeholder-parity assertion; value-inequality assertions beyond the original 2 keys; adding `happydom.ts`/`vite.config.ts` to the tsconfig program; unifying `satisfies Partial` across all 16 locale files (D5).
- Findings items outside #378 (A-1..A-7, A-11, A-12, W-*) — untouched.

---

## Risks / Open Questions

- **R1 — Translation quality (16 languages, agent-generated).** Mitigation: mirror sibling-key terminology per file; preserve placeholders; reviewer spot-checks at least the description strings (13, 17-25). *Open:* does the team want a native-speaker review pass before merge, or is agent translation + spot-check acceptable for these low-risk settings strings?
- **R2 — Full-suite order-dependent flakiness** (repo known-issue). Mitigation: record baseline before Step 1; compare failures, don't chase pre-existing flakes.
- **R3 — Negative control transiently edits a locale file.** Restore/`git checkout` before commit; `git diff --stat` gate in Step 5.7 catches strays.
- **R4 — `happydom.ts` invisible to `bun typecheck`.** Its directive can't be validated by the package build; standalone tsgo command documented in the anchors table. *Open:* worth a follow-up to include root config/preload files in the program (would also cover `vite.config.ts`)?
- **R5 — `_plan/index.md` sync has lapsed** for 2026-10/11 plans; adding a row is optional (Step 6).
- **R6 — Comment line length** exceeds prettier's 120-char printWidth — prettier does not reflow comments; acceptable (happydom precedent). Do not let a format pass split the directive from its explanation.

---

## Execution order summary

1. Baseline: `bun typecheck` + `bun run test:unit` (packages/app) — record results.
2. Step 1 — comment `prompt-input.tsx:1359` (verify `happydom.ts:6`, no edit).
3. Step 2 — add 26 keys × 16 locale files.
4. Step 3 — expand `parity.test.ts` (keep existing test).
5. Step 4 — `packages/app/AGENTS.md` (new Type checking section + fix stale parity claim).
6. Step 5 — verification battery (targeted test → negative control → typecheck → tsbuildinfo delete + re-typecheck → full suite vs baseline → lint → diff gate).
7. Commit only after Step 5 is green (pipeline: plan → code → review → commit).
