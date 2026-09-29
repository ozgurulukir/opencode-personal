# Plan: Document `/usage` TUI command in docs site (2026-09-29)

## Goal

Add the `/usage` TUI slash command to the docs site, documented **generically** (provider usage/quota info for multiple providers — Anthropic, ZAI, ClinePass — not ClinePass-specific). Docs-only change: no code behavior changes, no CHANGELOG, no README section, no new pages, no sidebar changes.

## Verified facts (from actual files)

1. **English page** — `packages/web/src/content/docs/tui.mdx`
   - `## Commands` section exists (line 58). Entry format: `### <name>` (h3, lowercase, no slash) → 1–2 sentence description → optional `_Alias_`/`[Learn more]`/admonition → ```` ```bash frame="none" ```` code block with the slash command → optional `**Keybind:**` line → `---` separator.
   - Entries are listed in **roughly alphabetical** order (not strict — e.g. `connect` precedes `compact`): connect, compact, details, editor, exit, export, help, init, models, new, redo, sessions, share, themes, thinking, undo, unshare.
   - `/usage` is **NOT listed**. Alphabetical position: after `unshare` (`u-n` < `u-s`), i.e. **last entry** before `## Editor setup` (line 280).
2. **Sidebar** — `packages/web/astro.config.mjs:134`: `tui` is already listed under the "Usage" group (`items: ["tui", "cli", "web", "ide", "github", "gitlab"]`). **No sidebar change needed** — confirmed; this is an existing page.
3. **Turkish counterpart EXISTS** — `packages/web/src/content/docs/tr/tui.mdx` (`## Komutlar`, same `### name` alphabetical format, `**Kısayol:**` instead of `**Keybind:**`). Per `packages/web/AGENTS.md`: prose is translated, code blocks stay byte-identical. Parallel update is **mandatory**.
4. **Implementation** (read for prose accuracy):
   - Registration: `packages/opencode/src/cli/cmd/tui/app.tsx:591-599` — `name: "opencode.usage"`, `title: "View token usage and cost"`, `slashName: "usage"`, `category: "System"`, **no keybind** → docs entry gets **no `**Keybind:**` line**.
   - Dialog (`component/dialog-usage.tsx`) renders two sections:
     - **Provider quota reports** — one block per provider with display name + account email (when available); each limit row shows label (+ tier) — window, a "resets in Xh" countdown, and a color-coded progress bar with % (ok / ≥90% warning / 100% exhausted) or `$X.XX left` for USD credit rows. When no credentials resolve, the section shows "No provider quota data" (graceful degradation; fetch errors are swallowed in `registry.ts`).
     - **Session usage** — cost, message count, total tokens; input/output; cache read/write; reasoning (when > 0); per-model breakdown (msgs, cost, in/out); top-10 tool-call bars.
   - Providers (`provider/usage/`):
     - **Anthropic** (`claude.ts`, OAuth only): "Claude 5 Hour" (5h window), "Claude 7 Day" (7d), plus optional per-tier "Claude 7 Day (Opus)" / "Claude 7 Day (Sonnet)" rows; percent bars with reset countdown.
     - **ZAI** (`zai.ts`, API key): "ZAI Token Quota" (tokens) and "ZAI Request Quota" (requests) under a 7-day quota window, with reset countdown.
     - **ClinePass** (`cline.ts`, API key): "ClinePass Credits (pay-as-you-go)" as `$X.XX left` (no bar, no reset); "5-Hour Limit" / "Weekly Limit" / "Monthly Limit" percent bars with reset times; a plan row (plan name or `Cline Pass (interval)`, `— canceled` suffix when set not to renew, `until Mon D` period end).
   - Credentials come from `auth.json` (`registry.ts`): OAuth for Anthropic, API key for ZAI (`zai` / `zai-coding-plan`) and ClinePass (`cline-pass`).
5. **Style conventions**: no emoji anywhere in the page; terminology already in use: "provider", "session", "conversation". No "subscription"/"quota" jargon overload — keep it user-facing.

## Steps

### Step 1 — English page: add `### usage` entry

**File:** `packages/web/src/content/docs/tui.mdx`
**Why:** `/usage` is a real, unregistered-in-docs slash command; the page promises "Here are all available slash commands".
**Where:** Insert between the `---` closing `### unshare` (line 278) and `## Editor setup` (line 280).

**Before (lines 270–280):**

````mdx
### unshare

Unshare current session. [Learn more](/docs/share#un-sharing).

```bash frame="none"
/unshare
```

---

## Editor setup
````

**After:**

````mdx
### unshare

Unshare current session. [Learn more](/docs/share#un-sharing).

```bash frame="none"
/unshare
```

---

### usage

Show provider usage and quota information alongside a breakdown of the current session's cost, tokens, models, and tool calls.

Provider limits are shown for Anthropic (Claude), ZAI, and ClinePass accounts when credentials are configured — for example Claude's 5-hour and 7-day windows, ZAI's token and request quotas, or ClinePass's 5-hour/weekly/monthly limits and pay-as-you-go credit balance.

```bash frame="none"
/usage
```

---

## Editor setup
````

### Step 2 — Turkish page: parallel `### usage` entry

**File:** `packages/web/src/content/docs/tr/tui.mdx`
**Why:** Turkish docs parity is mandatory (`packages/web/AGENTS.md`: prose translated, code blocks byte-identical).
**Where:** Insert between the `---` closing `### unshare` (line 284) and `## Editör kurulumu` (line 286).

**Before (lines 276–286):**

````mdx
### unshare

Mevcut oturumun paylaşımını kaldırır. [Daha fazla bilgi](/docs/share#un-sharing).

```bash frame="none"
/unshare
```

---

## Editör kurulumu
````

**After:**

````mdx
### unshare

Mevcut oturumun paylaşımını kaldırır. [Daha fazla bilgi](/docs/share#un-sharing).

```bash frame="none"
/unshare
```

---

### usage

Sağlayıcı kullanım ve kota bilgilerini, mevcut oturumun maliyet, token, model ve araç çağrısı dökümüyle birlikte gösterir.

Sağlayıcı limitleri, kimlik bilgileri yapılandırılmışsa Anthropic (Claude), ZAI ve ClinePass hesapları için gösterilir — örneğin Claude'un 5 saatlik ve 7 günlük pencereleri, ZAI'nin token ve istek kotaları veya ClinePass'in 5 saatlik/haftalık/aylık limitleri ve kullandıkça öde kredi bakiyesi.

```bash frame="none"
/usage
```

---

## Editör kurulumu
````

### Step 3 — Verification

1. **Docs build (primary check — compiles MDX, validates frontmatter):**
   ```powershell
   bun run --cwd packages/web build
   ```
   Must complete with no MDX/frontmatter errors.
2. **Typecheck:** `packages/web/package.json` has **no `typecheck` script**, so `bun turbo typecheck` skips it — a docs-only MDX change cannot break the husky `pre-push` typecheck. The root AGENTS.md `--skipLibCheck` caveat applies only if someone manually runs `astro check`; not required for this change.
3. **Lint:** `bun run lint` (oxlint) does not lint `.mdx`; no expected impact.
4. **Visual sanity (optional):** `bun run --cwd packages/web dev` → open `/docs/tui`, confirm the new entry renders in the command list and anchors resolve.
5. **Parity check:** diff the two files' `### usage` code blocks — the ```` ```bash frame="none" ```` block must be byte-identical between English and Turkish pages.

## Architecture Decisions

- **Single list entry, no dedicated section.** The `## Commands` list is the canonical, alphabetically-ordered catalog ("Here are all available slash commands"). A separate `/usage` section would duplicate it and break the page's established pattern. The 2-paragraph entry carries enough detail (provider list + example windows) without a new `##` section.
- **No sidebar change.** `tui` is already registered in `astro.config.mjs` under the "Usage" group; Starlight auto-derives the page. Adding an entry would be a no-op or a duplicate.
- **No keybind line.** The command registration (`app.tsx:591-599`) defines no keybind; documenting one would be false.
- **Generic, provider-listing prose.** Names all three supported providers (Anthropic, ZAI, ClinePass) with one concrete example each, matching the user decision to document generically. Avoids over-claiming (no exhaustive row-by-row dialog spec, no mention of internal `auth.json` mechanics in the docs — "when credentials are configured" is the user-facing abstraction).
- **Turkish parity is in scope.** `tr/tui.mdx` exists and `packages/web/AGENTS.md` mandates mirrored updates; the code block stays byte-identical, prose is translated.
- **Alternatives rejected:** CHANGELOG entry (no changelog convention in this fork); README feature section (user decision); new `/docs/usage` page (overkill for one command; would need sidebar + tr mirror + nav wiring).

## Open Questions

- None blocking. Optional follow-up (out of scope): the dialog's empty-state string says "requires OAuth auth" although ZAI/ClinePass use API keys — a code-string nit, not a docs issue.
