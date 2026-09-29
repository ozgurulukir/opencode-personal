# ClinePass Quota Display in `/usage`

Date: 2026-09-28
Status: REVISED r3 (r1: OQ-2/OQ-4 resolved from docs; OQ-3 re-scoped to scaffolding-only; auth-identity finding recorded; anchors fixed. r2: user-resolution exported as testable pure `parseCurrentUser` — fetchUsage stays null while inert; Step 3 guard hardened for optional `remaining`; open shape item relabeled OQ-5. r3 (post-ship, 4d7ecae): balance shape captured live and mapped — envelope unwrap + `balance / 100` → usd shipped; OQ-5 closed; fetcher no longer inert)
Scope: `packages/opencode` only — new usage fetcher + registry wiring + minor dialog tweak. No server/SDK schema change.

---

## 1. Goal

Add a **ClinePass quota section** to the TUI `/usage` dialog (`opencode.usage` command) so users with a ClinePass API key can see their remaining credit balance alongside the existing Anthropic and ZAI provider reports. The feature must degrade gracefully: no ClinePass auth → no section; endpoint failure → no section (never a broken dialog). **Shipped (4d7ecae):** the balance shape was captured live and the mapping landed — `fetchUsage` now returns a report with a `$X.XX` balance row. Both the `users/me` resolution and the balance mapping ship fully implemented and unit-tested.

**Re-scope note (updated post-ship):** the balance endpoint's *response shape* is not documented in the Cline docs (verified across 5 Context7 queries + reviewer's independent query), so the balance→`UsageLimit` mapping was implemented only against a response captured at implementation time. That capture happened (Step 6.5) and the mapping shipped in `4d7ecae`; both live payloads are envelope-wrapped (`{ data, success }`), which the docs omit.

## 2. Research Findings

### 2.1 Cline API (Context7 `/cline/cline`, 5 queries 2026-09-28; anchors are `github.com/cline/cline/blob/main/docs/...` paths as cited by Context7)

| Item | Value | Doc anchor | Confidence |
|---|---|---|---|
| Base URL | `https://api.cline.bot` | `docs/api/overview.mdx`, `docs/api/authentication.mdx` | High |
| Auth header | `Authorization: Bearer <token>` — "All requests to the Cline API must include an Authorization header with a Bearer token" | `docs/api/authentication.mdx` | High |
| **User-id resolution** | `GET /api/v1/users/me`. Documented: `{ id, email, name, active_account_id }`. **Live-captured (2026-09-28): `{ data: { id, email, organizations: [] }, success: true }` — envelope-wrapped, and no `active_account_id` is present.** | `docs/enterprise-solutions/api-reference.mdx` — "Get Current User Profile" + "Quickstart: Get User Profile"; live capture per Step 6.5 | **High (documented + captured)** |
| **Balance endpoint** | `GET /api/v1/users/{id}/balance` — "Get credit balance"; path param `id` required. **Docs publish no schema; live-captured 2026-09-28: `200 OK`, `{ data: { userId, balance: 8442 }, success: true }`.** | `docs/enterprise-solutions/api-reference.mdx` — "Get User Credit Balance"; live capture per Step 6.5 | Endpoint High / shape **captured (docs undocumented)** |
| Usage history | `GET /api/v1/users/{id}/usages` — "Get usage history". No response schema. It is a history/transaction log, **not** a windowed-quota endpoint. | `docs/enterprise-solutions/api-reference.mdx` — "Get User Usage History" | High (checked and **rejected** for quota display — see OQ resolution below) |
| API-key management | `GET/POST /api/v1/api-keys`, `DELETE /api/v1/api-keys/{key_id}` — keys are first-class credentials on the same `/api/v1` surface | `docs/enterprise-solutions/api-reference.mdx` — "API Keys" | High |
| ClinePass key provenance | "create an API key from **Settings > API Keys** in app.cline.bot"; used as `Authorization: Bearer $CLINE_API_KEY` on `/api/v1/chat/completions` | `docs/getting-started/clinepass.mdx` — "Using ClinePass outside of Cline" (retrieved via Context7 this round) | High |

**OQ resolutions from this research:**

- **OQ-2 (user-id resolution) — RESOLVED.** `GET /api/v1/users/me` is the confirmed primary path (anchor above). `parseCurrentUser` unwraps the live `{ data }` envelope and also accepts the documented flat shape; map `id` → path param for balance, `email` → `metadata.email`, `active_account_id` → `metadata.accountId` (absent in the live payload, so `accountId` is simply omitted). Fully implemented and unit-tested.
- **OQ-4 (windowed quotas) — RESOLVED by rejection.** `GET /api/v1/users/{id}/usages` was checked: it returns usage *history*, has no documented response schema, and no windowed-quota endpoint exists for individual users anywhere in the docs. The report is a **single credit-balance row**; no token/request windows.
- **OQ-1 (endpoint) — RESOLVED.** `GET /api/v1/users/{id}/balance` is the documented endpoint (no longer a "candidate"). The only open item was its response shape.
- **OQ-3 (balance field names) — NOT DOCUMENTED → plan re-scoped** (see §1 note and Step 1b.4). The mapping step no longer depends on unknown field names.

### 2.2 Auth-credential identity (review action 5) — finding

**Question:** does the ClinePass `CLINE_API_KEY` authenticate `/users/me` + `/users/{id}/balance`, or do they need a separate session/OAuth token?

**Finding (evidence-based, source-level confirmation unavailable):**

- The docs describe **one** auth mechanism for `api.cline.bot`: "All requests to the Cline API must include an Authorization header with a Bearer token" (`docs/api/authentication.mdx`). No second token type is documented anywhere in the retrieved docs.
- ClinePass keys are minted from **Settings > API Keys in app.cline.bot** (`docs/getting-started/clinepass.mdx`) — the same account whose balance the Users endpoints report; API keys are managed under the same `/api/v1` prefix (`/api/v1/api-keys`).
- The enterprise quickstart's `YOUR_AUTH_TOKEN` placeholder is not defined as a distinct token type in any retrieved doc.
- **Source-level confirmation was NOT possible:** every GitHub fetch path (`github.com`, `raw.githubusercontent.com`, `api.github.com`) fails with transport errors in this environment, and Context7 indexes `docs/`, not the extension's `AccountService` source. This is recorded as a limitation, not silently skipped.

**Design consequence:** `supports()` stays **`api_key`-only** (ClinePass users hold API keys, not OAuth tokens — the auth.json `Api` entry is what exists). The fetcher sends the API key as `Authorization: Bearer <key>` on both calls. If `/users/me` rejects it (401/403), the fetcher returns `null` and the section is absent — the failure mode is graceful and observable via a debug log line. Residual risk is tracked in §5 R1.

### 2.3 Repo extension points (all anchors verified against tree 2026-09-28)

- **Fetcher interface**: `packages/opencode/src/provider/usage/types.ts`
  - `UsageProvider` = `{ id, fetchUsage(credential): Promise<UsageReport | null>, supports(credential) }` (`types.ts:57-61`)
  - `UsageUnit` already includes `"usd"` (`types.ts:3`); `UsageAmount` already has `remaining` (`types.ts:14-21`) → **no type changes needed**.
- **Existing fetchers** (pattern to mirror):
  - `claude.ts` — OAuth, `fetch()` without try/catch on the main request (registry guards it), private parse helpers, returns `null` on any failure (`claude.ts:91-174`, export `:176-180`).
  - `zai.ts` — API key, `Authorization: <raw key>` header, own try/catch returning `null` (`zai.ts:77-168`).
- **Registry**: `packages/opencode/src/provider/usage/registry.ts`
  - `providers` array at `registry.ts:14`; `PROVIDER_ID_MAP` at `:17-21`.
  - `readAuthCredentials()` reads `auth.json` (`Global.Path.data/auth.json`) and maps entries; unknown opencode IDs **pass through unchanged** via `PROVIDER_ID_MAP[opencodeId] ?? opencodeId` (`registry.ts:45`) — so an auth entry keyed `cline-pass` already flows to a fetcher with `id: "cline-pass"` with zero map changes.
  - `fetchUsageReports()` wraps each `fetchUsage` in try/catch (`registry.ts:70-73`) → fetcher-level network throws are already contained.
- **Dialog**: `packages/opencode/src/cli/cmd/tui/component/dialog-usage.tsx`
  - Imports `fetchUsageReports` directly (`dialog-usage.tsx:8`), fetches via `createResource` (`:71-77`), renders per-report limit rows with `renderBar(resolveUsedFraction(limit))` (`:184-213`).
  - Empty state text at `dialog-usage.tsx:171`: `"No provider quota data (requires OAuth auth)"` — **note: this wording is already inaccurate for API-key providers (ZAI ships today, ClinePass adds another). Out of scope to fix in this plan; do not propagate the claim into new code or docs.**
- **Command registration**: `opencode.usage` / slash `usage` at `packages/opencode/src/cli/cmd/tui/app.tsx:591-599` — **no change needed**; the dialog content is provider-agnostic.
- **Auth storage**: `packages/opencode/src/auth/index.ts` — `auth.json` at `Global.Path.data` (`:10`); `Api` entry = `{ type: "api", key, metadata? }` (`:23-27`). Login flow: `opencode providers login` (`aliases: ["auth"]` at `src/cli/cmd/providers.ts:233`); **`ProvidersLoginCommand` at `providers.ts:291`**, models.dev provider listing/filtering at `:344-369` — `cline-pass` is already selectable since it comes from models.dev.
- **Provider exists in models.dev**: local `models-snapshot.js` contains provider `cline-pass` — `name: "ClinePass"`, `env: ["CLINE_API_KEY"]`, `api: "https://api.cline.bot/api/v1"`, `doc: https://docs.cline.bot/getting-started/clinepass`. So the opencode provider ID is **`cline-pass`** (not `cline`).
- **Graph evidence**: codebase-memory project `C-Github-opencode-personal`, generation `2026-09-28T18:31:42Z` (full mode). `check_index_coverage` on all 8 cited files → `no_recorded_issue` (freshness `metadata_changed`; every file was also re-read directly, so all `file:line` anchors above are tree-verified).
- **No existing `cline` code**: `rg -i cline packages/opencode/src` matches only comment URLs in `tool/edit.replacer.ts:3,5`. This is a fully new integration.

## 3. Steps

### Step 1 — New fetcher module `packages/opencode/src/provider/usage/cline.ts`

**What:** Create `clineUsageProvider: UsageProvider` with `id: "cline-pass"`, mirroring `claude.ts` structure (module-private helpers, self-contained, no barrel — multi-sibling dir rule).

- **Constants:** `CLINE_BASE_URL = "https://api.cline.bot"`, `USER_ME_PATH = "/api/v1/users/me"`, `USER_BALANCE_PATH = "/api/v1/users"` (append `/{id}/balance`).
- **`supports(credential)`** → `credential.type === "api_key" && !!credential.apiKey` (finding §2.2; same shape as `zai.ts:173`).
- **Headers:** `{ accept: "application/json", authorization: \`Bearer ${credential.apiKey}\` }` (per `docs/api/authentication.mdx`).
- **(a) User resolution — fully implemented (documented + live envelope shapes):**
  1. `GET /api/v1/users/me`. Non-OK → `null`.
  2. Parse via an **exported pure helper** `parseCurrentUser(raw: unknown): { id: string; email?: string; accountId?: string } | null`. It unwraps the live `{ data }` envelope (`record.data` when it is an object, else the record itself) and applies `typeof` narrowing on unknown JSON; `active_account_id` → `accountId`. Missing/empty `id` → `null`. Exported (not module-private) so Step 5 can unit-test it directly against both the documented flat shape and the captured envelope shape.
- **(b) Balance call — fully implemented (captured shape, shipped 4d7ecae):**
  3. `GET /api/v1/users/{id}/balance`. Non-OK → `null`.
  4. **Mapping contract (captured live 2026-09-28, shipped 4d7ecae):** the response→`UsageLimit` conversion is implemented in `parseBalanceLimit`, which unwraps the `{ data }` envelope and reads `data.balance` (integer credit count). Observed live 200 response: `{ data: { userId, balance: 8442 }, success: true }`. It maps to:
     - `id: "cline-pass:balance"`, `label: "ClinePass Balance"`, `scope: { provider: "cline-pass" }` — **no `windowId`, no `window`** (a prepaid balance has no reset window; avoids the redundant "Balance — credits"-style suffix in the dialog row).
     - `amount: { remaining: balance / 100, unit: "usd" }` — balance is *remaining* credits; the `/100` integer→USD (cents) conversion is **INFERRED, not documented** (see §5 R2 caveat). No `limit`, so `usedFraction` stays `undefined` and `buildUsageStatus` is not called (no fake percentages).
  5. Return `UsageReport { provider: "cline-pass", fetchedAt: Date.now(), limits, metadata: { email, accountId } }` from the `parseCurrentUser` result. **Empty `limits` → `null`** — if the balance call fails or yields an unparseable payload, `limits` is empty and `fetchUsage` returns `null`, so the dialog simply omits the ClinePass section (graceful degradation). Once the balance mapping landed (4d7ecae), a successful balance call emits the report with the `$X.XX` row.
- **Error handling:** no try/catch around the main fetches (registry `fetchUsageReports` already catches, `registry.ts:70-73` — same as `claude.ts`). No `any`; parse with `typeof`/`Record<string, unknown>` narrowing like `zai.ts:33-47`. A single `log.warn`-style debug line on non-OK `/users/me` is acceptable for the §2.2 residual risk; use `safeCatch` from `packages/opencode/src/util/error.ts:92` if a catch is ever needed — never an empty catch.

**Why:** isolates all Cline-specific knowledge in one sibling module; both the `users/me` resolution and the balance mapping shipped tested (4d7ecae) — the fetcher emits the USD report and the dialog renders its row — while an unparseable payload still degrades cleanly to `null`.

### Step 2 — Registry wiring `packages/opencode/src/provider/usage/registry.ts`

**What:**
- `import { clineUsageProvider } from "./cline"` + re-export line (mirroring `:4-5,8-9`).
- Append to `providers` array (`:14`): `[claudeUsageProvider, zaiUsageProvider, clineUsageProvider]`.
- Add explicit `"cline-pass": "cline-pass"` to `PROVIDER_ID_MAP` (`:17-21`) for discoverability — functionally redundant (pass-through at `:45`) but documents intent, matching how `anthropic: "anthropic"` is listed.

**Why:** dispatch is fully data-driven; this is the only wiring required.

### Step 3 — Dialog rendering for USD balance `packages/opencode/src/cli/cmd/tui/component/dialog-usage.tsx`

**What:** In the per-limit row renderer (`:184-213`), add a branch: when `limit.amount.unit === "usd"` **and** `resolveUsedFraction(limit)` is `undefined` **and** `limit.amount.remaining !== undefined`, render the remaining balance as text (e.g. `` `$${limit.amount.remaining.toFixed(2)} left` ``) instead of the `renderBar` output (which would show an empty `[░░░…] —` bar). The third guard condition is required because `remaining` is optional (`types.ts:17`) — under strict null checks `amount.remaining.toFixed(2)` fails typecheck without it and would throw `undefined.toFixed` at runtime. Keep it inline in the existing row JSX — single-use, no extracted helper (repo rule: don't extract single-use helpers). This branch is wire-shape-independent (it renders whatever `UsageLimit` exists) and is now live: the shipped fetcher (4d7ecae) emits a USD report with `remaining`, so the branch renders the ClinePass balance row.

**Why:** a credit balance has no fraction; the current bar renderer communicates nothing for it.

### Step 4 — Gating (no code expected)

**What:** Verify — do not implement — that gating already works:
- No `cline-pass` entry in `auth.json` → `readAuthCredentials()` yields no credential → no fetcher call → no report → dialog shows the existing empty-state text. Entry appears **only when Cline auth exists**.
- The `/usage` command itself stays unconditional (consistent with Anthropic/ZAI behavior).

**Why:** the registry's credential-driven dispatch already provides provider-id gating. Adding TUI-side auth checks would duplicate state.

### Step 5 — Tests `packages/opencode/test/provider/usage/cline.test.ts` (new directory)

**What:** Follows the `test/provider/` convention (siblings: `provider.test.ts`, `models.test.ts`). Run from `packages/opencode` (root-test guard). **Updated post-ship (4d7ecae): the balance shape was captured, so captured-fixture tests asserting the observed shape were added (4 tests: envelope unwrap + balance mapping).**

Allowed assertions:
- `supports()`: accepts api_key with key; rejects oauth / missing key.
- `parseCurrentUser()` directly (pure, no fetch mock needed): documented flat shape `{ id, email, name, active_account_id }` → `{ id, email, accountId }`, and the captured envelope shape `{ data: { id, email, organizations: [] }, success: true }` → `{ id, email }`; missing `id` → `null`; non-object input → `null`. `fetchUsage`-level assertions on `metadata.email` / `metadata.accountId` are now reachable (the balance mapping landed) and are covered alongside the captured-fixture tests added in 4d7ecae.
- Degradation: `/users/me` non-OK → `null` (fetchUsage); `parseCurrentUser` missing `id` → `null`; balance non-OK → `null`; balance payload not matching the captured contract → `null`.
- Behavioral names, e.g. `"ClinePass fetcher resolves the user id from /users/me before fetching balance"`.

Now tested (4d7ecae): a fixture test pinned to the observed balance response asserts the `UsageLimit` field values for the balance row (Step 1b.4 contract).

**Why:** locks the documented contract and every degradation path without inventing a wire format.

### Step 6 — Verification

1. `bun typecheck` from `packages/opencode` (never raw `tsc`). `packages/app` is unaffected (no SDK change → no regen, no `@opencode-ai/sdk` contract change; skip `packages/app` typecheck and SDK build).
2. `bun test test/provider/usage/cline.test.ts` from `packages/opencode`, then full package suite (order-dependence policy).
3. `bun run lint` from root; grep output for `no-unused-vars` and `: error ` (warnings are pre-existing; verify no new ones).
4. No SDK regen (`./packages/sdk/js/script/build.ts` not needed — nothing in `openapi.json` changes).
5. **Balance-shape capture — DONE (2026-09-28).** Captured with a real key:
   - `GET /api/v1/users/me` → `{ data: { id, email, organizations: [] }, success: true }` (envelope-wrapped; the documented flat `{ id, email, name, active_account_id }` shape is NOT what the live API returns, and there is no `active_account_id` in the live payload).
   - `GET /api/v1/users/{id}/balance` → `200 OK`, `{ data: { userId, balance: 8442 }, success: true }`.
   This confirms the §2.2 auth finding (the API key IS accepted on the Users endpoints) and finalized the Step 1b.4 parser. Shipped in `4d7ecae` (`fix(usage): unwrap ClinePass API envelope and map balance correctly`): `parseCurrentUser` unwraps the `{ data }` envelope, `parseBalanceLimit` implements the captured balance shape, and the report maps `balance / 100` → `$84.42`.
6. Manual smoke: `/usage` in TUI — ClinePass section appears only with auth and shows the `$X.XX left` balance row (mapping landed, 4d7ecae).

## 4. Architecture Decisions

| Decision | Rationale | Alternatives considered |
|---|---|---|
| New sibling `cline.ts` in `provider/usage/` | Matches existing one-file-per-provider layout; no barrel in multi-sibling dirs | Extend `zai.ts` (wrong cohesion); generic "openai-compatible quota" abstraction (premature — only one such provider) |
| Provider/usage id `cline-pass` (not `cline`) | Matches models.dev provider ID and auth.json key; registry pass-through (`registry.ts:45`) means zero mapping surprises | Map `cline-pass → cline` (adds a rename with no benefit) |
| Two-call chain `users/me` → `users/{id}/balance` | `users/me` yields the id (+ email) in one call (§2.1) — `active_account_id` is optional and absent in the live payload; balance requires the id as a path param | Guessing an id-less balance route (undocumented); caching the id in auth.json metadata (stale-identity risk, extra migration) |
| Balance as `UsageLimit.amount.remaining` with `unit: "usd"`, no fraction, no window | Types already support it (`types.ts:3,14-21`); honest representation — a prepaid balance has no denominator or reset window | Synthesize `limit: 100` percent (fabricates data); add a new `UsageEntryKind` (type churn for one field) |
| Balance mapping against the captured shape (shipped 4d7ecae) | Response shape was captured live (envelope `{ data: { balance }, success }`); the parser maps the observed shape rather than a guess. The `/100` USD conversion remains inferred (docs publish no unit) | Ship inert-but-wired scaffolding (the pre-capture plan; superseded once the real shape was observed) |
| `supports()` stays api_key-only | Docs document a single Bearer surface; ClinePass keys come from the same account/API-prefix (`/api/v1/api-keys`); OAuth tokens don't exist for ClinePass in opencode's auth.json | Add oauth branch speculatively (no such credential exists to test) |
| No try/catch around main fetches in fetcher | `fetchUsageReports()` already catches per-provider (`registry.ts:70-73`); mirrors `claude.ts` | Wrap everything like `zai.ts` (double guarding, hides the registry contract) |
| Client-side fetch, not server route | Dialog imports `fetchUsageReports()` directly today (`dialog-usage.tsx:8`); no SDK/server change keeps the diff minimal | Expose via HTTP API + SDK (needs regen, touches app package, no consumer) |
| Gating via registry credential dispatch | Single source of truth for "which providers have reports" | TUI-side auth check (duplicates auth.json reading) |

**Conventions honored:** no `any` (narrow with `Record<string, unknown>` + type guards); functional array methods; inline single-use helpers; `const`/early returns; JSDoc on the fetcher (the two-call chain + gated mapping is non-obvious behavior worth documenting); no new dependencies (plain `fetch`, same as siblings).

## 5. Risks

1. **API key may not authenticate the Users endpoints — RESOLVED.** Step 6.5's live capture returned `200 OK` on both `/users/me` and `/users/{id}/balance` with the API key, confirming the single-Bearer-surface reading in §2.2. (The original MEDIUM risk predated the capture; extension-source confirmation was impossible at plan time.)
2. **Balance response shape — RESOLVED, one caveat open.** Shape captured live (Step 6.5) and mapped in `4d7ecae`. **Still unverified:** the `/100` integer→USD (cents) conversion is INFERRED — the docs publish no unit, and it has NOT been checked against the Cline dashboard's displayed balance. If the dashboard shows a different figure, the divisor is wrong and only `parseBalanceLimit` needs adjusting.
3. **`/users/me` may be enterprise-gated — RESOLVED.** Despite sitting in the Enterprise API reference, the live call returned 200 for a ClinePass key (Step 6.5).
4. **Extra latency on dialog open (LOW).** Two sequential HTTP calls per `/usage` open via `createResource` — same cost profile as existing providers; no caching added (YAGNI).
5. **Env-only users (LOW).** `CLINE_API_KEY` set without an auth.json entry won't produce a report (registry reads auth.json only, `registry.ts:34`). Accepted limitation; possible follow-up to extend `readAuthCredentials()` with env fallback for all providers.
6. **Dialog empty-state wording (COSMETIC, out of scope).** `dialog-usage.tsx:171` says "(requires OAuth auth)" — inaccurate for API-key providers (ZAI today, ClinePass next). Noted so it is not propagated; fixing it is a separate one-line change if desired.

## 6. Open Questions

- ~~OQ-5 (balance response shape + key acceptance)~~ — **RESOLVED** (fix commit `4d7ecae`). The live capture (Step 6.5) settled both: the API key is accepted on the Users endpoints (`200 OK`), and the balance shape is `{ data: { userId, balance }, success: true }` → mapped to `{ remaining: balance / 100, unit: "usd" }`. Remaining sub-caveat: the `/100` USD conversion is inferred, not documented (see §5 R2).
- ~~OQ-2 user-id resolution~~ — **RESOLVED**: the docs show `{ id, email, name, active_account_id }`, but the live 200 payload is envelope-wrapped `{ data: { id, email, organizations: [] }, success: true }` with no `active_account_id`; `parseCurrentUser` accepts both shapes (§2.1).
- ~~OQ-3 balance field names~~ — **RESOLVED as "undocumented"** → plan re-scoped to scaffolding-only (§1, Step 1b.4); **superseded by `4d7ecae`** (balance shape captured live and mapped).
- ~~OQ-4 windowed quotas~~ — **RESOLVED by rejection**: `GET /api/v1/users/{id}/usages` is a usage-history endpoint with no documented schema and no window semantics; no windowed-quota endpoint exists for individual users in the docs. Single credit-balance row only.
