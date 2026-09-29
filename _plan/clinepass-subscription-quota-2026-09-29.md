# ClinePass Subscription Quota in `/usage` — Feasibility Research & Plan

Date: 2026-09-29
Status: RESEARCH COMPLETE — verdict **(b)**: no windowed-quota API exists; honest fallback designed.
Scope: `packages/opencode` only — extends the shipped fetcher (`cline.ts`, commit `4d7ecae`); no registry/dialog plumbing redesign, no SDK change.
Supersedes: `_plan/clinepass-usage-2026-09-28.md` (its OQ-4 "resolved by rejection" was doc-based; this plan re-derives everything from live probes + Cline client source).

---

## 1. Goal

Make `/usage` show the **remaining ClinePass subscription quota** (5-hour / weekly / monthly windows, ZAI-style bars) **if and only if the API exposes it**. A previous doc-based guess (2026-09-28 plan) was falsified by live calls; every claim below is grounded in a live API probe (2026-09-29, real key from `auth.json`, redacted) or the actual Cline client source (`cline/cline@main`, tarball downloaded 2026-09-29). If the API does not expose quota, document non-feasibility honestly and ship an honest fallback.

**Verdict: the API does NOT expose windowed remaining quota** (bounded to the probed surfaces — §2.3). What it exposes is: a pay-as-you-go credit balance, raw usage-history transactions, plan/subscription metadata with (sentinel) window thresholds, and a post-hoc 429 error message. Design consequence: **fallback (b)** — fix a real unit bug in the shipped balance row, relabel it as a credit pool, and surface a dashboard pointer the user can actually see: a rendered `notes` sub-line in the dialog (§6 Step 1.4; `notes` has zero producers among shipped providers, so the render is inert for every other provider). Needs user confirmation before implementation.

---

## 2. Probe log (live, 2026-09-29)

Method: `curl.exe -s -i -H "Authorization: Bearer $key"` where `$key` is read from `C:\Users\ozgur\.local\share\opencode\auth.json` entry `cline-pass` (type `api`, 67 chars) into a shell variable — never printed. All bodies below redacted (key → `sk-REDACTED`, email → `<EMAIL>`, user id → `<USER_ID>`). Base `https://api.cline.bot`.

Reproducible probe skeleton (PowerShell; key read from variable, not inlined):

```powershell
$auth = Get-Content -LiteralPath "$env:USERPROFILE\.local\share\opencode\auth.json" -Encoding UTF8 | ConvertFrom-Json
$key = $auth.'cline-pass'.key
curl.exe -s -i -H "Authorization: Bearer $key" -H "accept: application/json" "https://api.cline.bot/api/v1/users/me"
```

### 2.1 Endpoint sweep

| # | Endpoint | Status | What it revealed |
|---|----------|--------|------------------|
| 1 | `GET /api/v1/users/me` | 200 | Profile only. `{ data: { id: "<USER_ID>", email: "<EMAIL>", displayName: "Ozgur", termsAcceptedAt, clineBenchConsent: false, organizations: [], createdAt, updatedAt }, success: true }`. **No plan/limit/quota fields.** [CONFIRMED-live] |
| 2 | `GET /api/v1/users/me/plan` | 200 | **The richest payload found.** `{ data: { planHistoryId, userId, plan: { name: "Cline Pass (Monthly)[Internal]", displayName: "Cline Pass (Monthly)", type: "individual", interval: "Monthly", pricePerSeatCents: 999, entitlements: { cline_pass: { enabled: true, inferenceCapThreshold: { last5HoursUsageCostUSDPerUser: 1000000000, last7daysUsageCostUSDPerUser: 2500000000, last30daysUsageCostUSDPerUser: 5000000000 } } }, isActive: true }, subscriptionId: "sub_…", currentPeriodStart: "2026-09-12T20:07:47Z", currentPeriodEnd: "2026-10-12T20:07:47Z", cancelAt: "2026-10-12T20:07:47Z", canceledAt: "2026-09-14T10:10:39Z" }, success: true }`. Thresholds are **sentinel "no-cap" values** (see §3.2). No current-usage field. [CONFIRMED-live] |
| 3 | `GET /api/v1/plans` | 200 | Plan catalog (4 plans), same `entitlements.cline_pass.inferenceCapThreshold` shape on the two Cline Pass plans. Catalog only — not user state. [CONFIRMED-live] |
| 4 | `GET /api/v1/users/{id}/balance` | 200 | `{ data: { userId: "<USER_ID>", balance: 8442 }, success: true }` — re-captured fresh; matches the 2026-09-28 capture. Unit is **micro-USD (1e-6 USD)**, not cents (§3.1). [CONFIRMED-live] |
| 5 | `GET /api/v1/users/{id}/usages?limit=5` | 200 | `{ data: { items: [ { id: "usg-…", userId, createdAt: "2026-09-29T05:09:48.130623Z", creditsUsed: 0, costUsd: 497421, operation: "chat_completion", aiInferenceProviderName: "openrouter", aiModelName: "cline-pass/glm-5.3-flash", promptTokens: 90741, completionTokens: 2433, totalTokens: 93174, cachedTokens: 82112, generationId: "gen-…", metadata: { is_byok: false, is_stream: true, raw_model: "z-ai/glm-5.3-flash", session_id: "sess-…" } }, …5 items ], nextToken: "usg-…", total: 0 }, success: true }`. Raw history; **no window/limit fields**. [CONFIRMED-live] |
| 6 | `GET /api/v1/users/{id}/usages?limit=1000` | 200 | **Server caps the page at 200 items**; `nextToken` non-empty; `total: 0` (unreliable — always 0). 100 records covered only ~8 hours of this user's history. [CONFIRMED-live] |
| 7 | `GET /api/v1/users/{id}/usages?limit=5&cursor=<nextToken>` | 200 | Cursor pagination works; page 2 continues exactly where page 1 ended (descending `createdAt`). **No date-range filter param exists** (see #11). [CONFIRMED-live] |
| 8 | `GET /api/v1/users/{id}/usages` (bare, as the Cline client calls it) | 200 | Default page = 10 items, `nextToken` present. [CONFIRMED-live] |
| 9 | `GET /api/v1/users/{id}/payments` | 200 | `{ data: { items: [ { id: "pymt-…", amount: 1060, type: "plan", status: "completed", metadata: { provider: "stripe", event_type: "invoice.paid", seats: "1", subscription_id: "sub_…" } }, …3 items ] } }`. `amount: 1060` for a `pricePerSeatCents: 999` plan → **payments are in cents** ($10.60 invoice). All payments are subscription invoices; no credit top-ups. [CONFIRMED-live] |
| 10 | `GET /api/v1/users/me/remote-config` | 200 | `{ data: null, success: true }` — no config, no limit info. [CONFIRMED-live] |
| 11 | `GET /api/v1/users/me/usages` and `GET /api/v1/users/me/balance` (alias forms) | 400 | `{"data":{"ID":"usr-…","Cursor":"","Limit":0},"error":"Invalid request format","success":false}` — the 400 echo reveals the **entire query struct: `{ ID, Cursor, Limit }` only. No date/startTime/endTime/window param exists.** (The echoed `ID` is a freshly minted ULID default, not the real user id.) [CONFIRMED-live] |
| 12 | 404 sweep: `/api/v1/rate-limits`, `/ratelimits`, `/limits`, `/subscription`, `/plan`, `/quota`, `/usage`, `/usage/limits`, `/usages`, `/users/me/subscription`, `/users/me/limits`, `/users/me/usage`, `/users/me/rate-limits`, `/me`, `/user`, `/account`, `/credits`, `/billing/subscription`; on the `{id}` surface: `/usage-summary`, `/usage/summary`, `/usage-limits`, `/rate-limit`, `/limits`, `/subscription`, `/plan`, `/usage` | 404 | `{"error":"Not Found","success":false}` for every candidate quota/summary/limits route. **No windowed-quota endpoint exists on the Bearer surface.** [CONFIRMED-live] |
| 13 | `GET /api/v1/organizations` | 405 | `Allow: OPTIONS, POST` — creation route, not a listing. `organizations: []` for this user anyway. [CONFIRMED-live] |
| 14 | `OPTIONS /api/v1/users/{id}/usages` | 204 | `Allow: OPTIONS, GET` — read-only surface. [CONFIRMED-live] |
| 15 | `POST https://app.cline.bot/api/subscription` route family with Bearer key | 200 (HTML) | Returns the Next.js app shell — the dashboard API is **cookie-session auth, not Bearer**. Not accessible with an API key. [CONFIRMED-live] |

### 2.2 Header inspection (the decisive check)

**Quota/metadata endpoints** (all probes above used `-i`; representative header set from `GET /users/me` and `GET /users/{id}/balance`):

```
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self'; … report-uri /csp-report; report-to csp-endpoint
Content-Type: application/json
Reporting-Endpoints: csp-endpoint="/csp-report"
Strict-Transport-Security: max-age=31536000; includeSubDomains
Vary: Origin
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-Request-Id: ZZQEurGuOdylKJmZnMtVJXHeamZnkXmb
Date: Tue, 29 Sep 2026 05:21:31 GMT
Content-Length: 83
Via: 1.1 google
Alt-Svc: h3=":443"; ma=2592000,h3-29=":443"; ma=2592000
```

**Normal inference call** — `POST /api/v1/chat/completions`, body from file (PS 5.1 mangles inline JSON args — pass via `--data-binary "@file"`), `{"model":"cline-pass/glm-5.3-flash","messages":[{"role":"user","content":"Reply with exactly the word OK and nothing else."}],"max_tokens":64,"stream":false}` → **200 OK**. Redacted response capture:

```
HTTP/1.1 200 OK
Content-Security-Policy: default-src 'self'; … report-uri /csp-report; report-to csp-endpoint
Content-Type: application/json
Reporting-Endpoints: csp-endpoint="/csp-report"
Strict-Transport-Security: max-age=31536000; includeSubDomains
Vary: Origin
X-Content-Type-Options: nosniff
X-Frame-Options: SAMEORIGIN
X-Request-Id: QHAvyXNDeGaHpJTkChBPgOfUELcsFqEs
Date: Tue, 29 Sep 2026 05:18:09 GMT
Content-Length: 1271
Via: 1.1 google
Alt-Svc: h3=":443"; ma=2592000,h3-29=":443"; ma=2592000
```

Body (redacted): `{"data":{"choices":[{"finish_reason":"stop","message":{"content":"OK",…}}],"created":1790659088,"id":"gen-…","model":"z-ai/glm-5.3-flash","usage":{"completion_tokens":56,…,"cost":0.0000313,…}},"success":true}`.

**Finding: there are NO `x-ratelimit-*`, `anthropic-ratelimit-*`, `x-quota-*`, or any window/quota headers on inference OR metadata responses.** [CONFIRMED-live — full header dumps captured for both]

Note: two earlier inference attempts returned `500 {"error":"empty response content"}` (max_tokens=16 with a yes/no prompt produced empty content) — a request-shape quirk, not a quota signal; no quota headers on those either.

### 2.3 Scope of the negative verdict — tried vs not-tried

| Surface | Tried? | Result |
|---|---|---|
| Bearer REST under `https://api.cline.bot/api/v1` — full endpoint sweep (§2.1 #1-14: profile, plan, plans, balance, usages + pagination/params, payments, remote-config, 20+ candidate quota/summary/limits routes, OPTIONS) | Yes | No quota surface — 404/400/405 as logged |
| Response headers of metadata endpoints (`users/me`, `balance`, `usages`, `plan`) | Yes | No `x-ratelimit-*`/quota headers (§2.2) |
| Response headers of a real inference call (`POST /chat/completions` → 200) | Yes | No `x-ratelimit-*`/quota headers (§2.2) |
| Dashboard API via Bearer key (`app.cline.bot/api/*`) | Yes (auth wall only) | Next.js HTML app — cookie-session auth; internals not probed |
| Official client source (`apps/vscode`, `apps/cli`, `apps/cline-hub`, `sdk/`) — exhaustive grep | Yes | No quota fetch/display anywhere (§3) |

**NOT tried — each an explicit [UNKNOWN]:**
- OAuth-type authentication against `api.cline.bot` (the stored `cline-pass` credential is type `api`; the OAuth token flow's API surface was never probed)
- GraphQL endpoints (none discovered; none probed)
- Alternate base hosts (any Cline API host other than `api.cline.bot`)
- Undocumented/admin endpoints beyond the swept name set
- Richer `/users/me` variants beyond the swept set (e.g. `?expand=`-style params)
- Cookie-authenticated dashboard session API internals (only the auth wall was confirmed, §2.1 #15)

---

## 3. Cline client source findings (`cline/cline@main`, tarball 2026-09-29)

The repo is now a monorepo: `apps/vscode`, `apps/cli`, `apps/cline-hub`, `sdk/packages/*`, `docs/`. GitHub was unreachable via the webfetch tool (transport errors) but fully reachable via `curl.exe`; the source was downloaded (`codeload.github.com/cline/cline/tar.gz/refs/heads/main`, 38.6 MB) and grepped locally.

### 3.1 The balance unit is micro-USD (1e-6 USD) — the shipped `/100` mapping is a 10,000× bug

Three independent client sources agree (the Cline codebase names this unit "microcredits"; this plan says micro-USD — same thing, 1 unit = $0.000001):

- `apps/cline-hub/src/webview/src/components/views/settings/account-view.tsx:341-346` — `formatCreditBalance(value)` = `new Intl.NumberFormat(…).format(value / 1_000_000)` rendered with a `$` prefix. Call sites: overview balance card :537 and :542 (`displayedBalance` / `balance.balance`), usage-tab rows :648 (`tx.creditsUsed`), billing-tab rows :700 (`tx.credits`). The billing-tab `tx.credits` path is wired but unpopulated in the captured data — live payment records carry only `amount` (cents), no `credits` field (§2.1 #9). [CONFIRMED-source]
- `apps/vscode/webview-ui/src/utils/format.ts:39-41` — `export function formatCreditsBalance(microcredits: number): number { return microcredits / 10000 }` with docstring `formatCreditsBalance(50000) // returns 5.0000 (credits)` — i.e. 1 credit = 10,000 stored units = $0.01, so the stored unit = $0.000001 = 1e-6 USD. [CONFIRMED-source]
- `apps/vscode/webview-ui/src/components/chat/CreditLimitError.tsx:52` — comment: *"We have to divide because the balance is stored in microcredits"* — the codebase's own name for the micro-USD unit. [CONFIRMED-source]

Consequence: live `balance: 8442` [CONFIRMED-live] is 8442 micro-USD = 0.8442 credits = **$0.008442**. The shipped `cline.ts:55` (`remaining: balance / 100`) renders `$84.42 left` — **wrong by 10,000×**. [INFERRED from the three sources + live value; arithmetic] Cross-check available to the user: the app.cline.bot dashboard "Credits Balance" card should show ≈$0.01 / 0.8442 credits for this account. [UNKNOWN until user checks — flagged in §8 R1]

### 3.2 No client ever reads the window thresholds

`rg "inferenceCapThreshold"` and `rg "last5Hours|last7days|last30days"` across the entire repo → **zero hits**. The thresholds seen live in `entitlements.cline_pass.inferenceCapThreshold` are enforced server-side only; no Cline client fetches or displays them. [CONFIRMED-source — exhaustive grep of the tarball]

### 3.3 The complete account-service surface has no quota method

`sdk/packages/core/src/account/cline-account-service.ts` exposes exactly: `fetchMe` (`/api/v1/users/me`), `fetchRemoteConfig` (`/api/v1/users/me/remote-config`), `fetchFeaturebaseToken`, `fetchBalance(userId)` (`/api/v1/users/{id}/balance`), `fetchUsageTransactions(userId)` (`/api/v1/users/{id}/usages` → `{items}`), `fetchPaymentTransactions(userId)` (`/api/v1/users/{id}/payments`), `fetchUserOrganizations`, `fetchAvailableSubscriptionPlans({type})` (`/api/v1/plans?type=…`), `fetchCurrentUserPlan()` (`/api/v1/users/me/plan`), `fetchOrganization`, `fetchOrganizationBalance`, `fetchOrganizationUsageTransactions`, `switchAccount` (PUT `/api/v1/users/active-account`). **No fetchQuota / fetchLimits / fetchRateLimits method exists.** [CONFIRMED-source]

Types (`sdk/packages/core/src/account/types.ts`): `ClineAccountBalance = { balance: number; userId: string }`; `ClineAccountUsageTransaction` carries `costUsd: number`, `creditsUsed: number`, `createdAt`, token counts — no window fields; `UserCurrentPlan = { plan?, planHistoryId?, subscriptionId?, currentPeriodStart?, currentPeriodEnd?, cancelAt?, canceledAt? }` (entitlements untyped). [CONFIRMED-source]

### 3.4 The only limit signal is a post-hoc 429 message

- `sdk/packages/llms/src/providers/errors.ts:7-9` — markers `CLINE_PASS_LIMIT_PREFIX = "you have reached your"`, `CLINE_PASS_LIMIT_MARKER = "clinepass limit"`, `CLINE_PASS_LIMIT_SUFFIX = "please try again later."`; `extractClinePassLimitMessage` (:138-142) slices the message text. **No reset-timestamp parsing exists for ClinePass** (only the free-model limit has `extractClineFreeModelLimitResetTime`, which parses prose like "Try again in 23h 59m"). [CONFIRMED-source]
- `apps/cli/src/utils/cline-pass-errors.test.ts:54-56` — fixture: `"Error: You have reached your 5-hour Clinepass limit. The limit resets in 5h, please try again later."` — the reset hint is **server-generated prose delivered only after the limit is hit**, not a structured field. [CONFIRMED-source]

### 3.5 The official UI shows a flat transaction list, not windows

`apps/cline-hub/.../account-view.tsx` usage tab (lines ~605-660): renders `usageTransactions.map(...)` as a table (Model / Tokens / Credits / Time) — **no window aggregation, no limit bars, no "X% used"**. The overview tab shows only the Credits Balance card. [CONFIRMED-source]

### 3.6 Docs corroborate (secondary evidence, not load-bearing)

`docs/getting-started/clinepass.mdx:118-124`: "ClinePass measures usage against three limits: **5-hour rolling window**, **Weekly** (calendar week), **Monthly** (calendar month). To check your current usage, visit your Cline dashboard." — the docs themselves concede there is no API for it. [CONFIRMED-source]

---

## 4. Feasibility verdict

**(b) — Non-feasible as specified.** On the surfaces probed — Bearer-authenticated REST under `https://api.cline.bot/api/v1` (full endpoint sweep, §2.1), the response headers of both metadata and inference calls (§2.2), and the complete official client source (§3) — no endpoint, JSON shape, or header set yields windowed *remaining* quota. The not-tried surface set (OAuth flow, GraphQL, alternate hosts, admin routes, dashboard session internals) is enumerated as explicit [UNKNOWN]s in §2.3:

1. **No quota endpoint** — exhaustive 404 sweep (§2.1 #12) + the client's complete service surface (§3.3). [CONFIRMED-live + CONFIRMED-source]
2. **No quota headers** — inference and metadata responses carry none (§2.2). [CONFIRMED-live]
3. **Thresholds exist but are sentinels** — `inferenceCapThreshold` = `{ last5Hours: 1000000000, last7days: 2500000000, last30days: 5000000000 }`. Unit [UNKNOWN] (field name says USD; sibling fields `costUsd`/`balance` are micro-USD despite "USD" names — if micro-USD, the caps are $1000/5h, $2500/7d, $5000/30d; if USD, $1B+). **Sentinel either way**: a $9.99/mo plan with a $1000-per-5h cap is a de-facto no-cap, and any ZAI-style bar would permanently read ~0%. [CONFIRMED-live values, INFERRED sentinel reading, UNKNOWN unit]
4. **Current windowed usage is not exposed** — only raw history (`/usages`, cursor-paginated 200/page, no date filter, `total` always 0). A client-side aggregate (sum `costUsd` by `createdAt` windows) is *possible* but is an approximation of an unexposed quota: expensive (30-day window can span dozens of pages), and against sentinel thresholds it produces a meaningless bar. **Rejected per the task's "iff the API exposes it" rule.**
5. **Reset timestamps are not exposed** — windows are rolling/calendar (§3.6); the only reset hint is 429 prose after the fact (§3.4). [CONFIRMED-source]

What IS exposed and honest to show: the pay-as-you-go credit balance (correctly unit-converted), and plan/subscription metadata (name, interval, period end, canceled state) from `/users/me/plan`.

### Response→`UsageLimit` mapping (fallback — no usedFraction, no fabricated windows)

**Balance row (fix + relabel):**

```
GET /api/v1/users/{id}/balance → { data: { userId, balance: 8442 }, success: true }
→ UsageLimit {
    id: "cline-pass:credits",
    label: "ClinePass Credits (pay-as-you-go)",
    scope: { provider: "cline-pass" },              // no windowId — no reset window exists
    amount: { remaining: balance / 1_000_000, unit: "usd" },   // 8442 micro-USD → $0.008442
    notes: ["Subscription usage windows (5h/weekly/monthly) are not exposed by the Cline API — check app.cline.bot/dashboard/subscription"],
                                                    // ^ rendered as a muted sub-line by the dialog (Step 1.4) — the dashboard pointer's delivery path
  }
```

- `usedFraction` stays `undefined` (a prepaid pool has no denominator) → `resolveUsedFraction` (`types.ts:63-72`) returns `undefined` → the dialog's USD-remaining branch renders `$0.01 left`. No fake percentages — same honest shape as shipped, corrected unit.
- The `notes` entry is what makes the dashboard pointer reach the user: `dialog-usage.tsx` renders `limit.notes` as a muted sub-line under the row label (Step 1.4). Today `notes` has zero producers across shipped providers (grep: only the field declaration at `types.ts:37`), so this render is inert for every other provider.
- Rounding note: the dialog's `toFixed(2)` renders $0.008442 as "$0.01" — cent-level precision, matches the dashboard's own 2-decimal credit display. [INFERRED, cosmetic]

**Optional plan row (Tier 2, needs user confirmation):**

```
GET /api/v1/users/me/plan → { data: { plan: { displayName: "Cline Pass (Monthly)", interval: "Monthly", … }, currentPeriodEnd: "2026-10-12T20:07:47Z", canceledAt: "2026-09-14T10:10:39Z" }, success: true }
→ UsageLimit {
    id: "cline-pass:plan",
    label: "Cline Pass (Monthly)",                  // or "Cline Pass (Monthly) — canceled" when canceledAt && !isActive-period-over
    scope: { provider: "cline-pass" },               // NO scope.tier — the label already carries the interval; dialog-usage.tsx:188 appends "(tier)" and would render "Cline Pass (Monthly) (Monthly)"
    window: { id: "period", label: "until Oct 12" }, // from currentPeriodEnd
    amount: { unit: "unknown" },                     // no numeric amount exists
  }
```

This renders via the existing row renderer as `Cline Pass (Monthly) — until Oct 12` + an empty bar — the empty bar is noise, so Tier 2 requires the one-line dialog branch in Step 3b. Tier 1 ships without it.

**Explicit open question (the (a)-shaped gap):** no first-party endpoint returns `{ used, limit, resetsAt }` per window. If Cline ever ships one (or if the cookie-auth dashboard API is deemed in-scope to reverse), the ZAI mapping is the template: `buildAmount` percentage→usedFraction (`zai.ts:49-70`), window + `nextResetTime → resetsAt` (`zai.ts:103-108`), per-type rows (`zai.ts:110-144`). Until then, any bar would be fabricated. [UNKNOWN — external to this plan]

---

## 5. Architecture reuse (all anchors re-verified against the tree 2026-09-29)

- **`packages/opencode/src/provider/usage/types.ts`** — `UsageUnit` :3 (`"usd"` exists; no new unit needed); `UsageWindow` :7-12 (`resetsAt` optional — unused here); `UsageAmount` :14-21 (`remaining`, `usedFraction` optional); `UsageLimit` :30-38 (**`notes?: string[]` already exists** — carries the dashboard pointer); `UsageReport` :40-45; `UsageProvider` :57-61; `resolveUsedFraction` :63-72; `buildUsageStatus` :74-79. **No type changes.**
- **`packages/opencode/src/provider/usage/zai.ts`** — the windowed precedent: `buildAmount` :49-70 (percentage→usedFraction clamp), window construction :103-108 (`resetsAt` from `nextResetTime`), per-type mapping :110-144, export :170-174. Referenced as the template for a future real quota endpoint; **not modified**.
- **`packages/opencode/src/provider/usage/registry.ts`** — `providers` :16, `PROVIDER_ID_MAP` :19-24 (`"cline-pass": "cline-pass"` already present), `readAuthCredentials` :36-62 (auth.json at `Global.Path.data`), `fetchUsageReports` :65-81 (per-provider try/catch). **No changes** — dispatch and gating already work.
- **`packages/opencode/src/provider/usage/cline.ts`** — the file to extend: constants :4-6, `parseCurrentUser` :24-35 (exported, tested), `parseBalanceLimit` :45-57 (**:55 `remaining: balance / 100` is the bug**), `fetchClineUsage` :68-102 (two-call chain, graceful `null`), export :104-108.
- **`packages/opencode/src/cli/cmd/tui/component/dialog-usage.tsx`** — `renderBar` :33-41; per-limit rows :184-217; **USD-remaining branch :210-212** (`limit.amount.unit === "usd" && fraction === undefined && limit.amount.remaining !== undefined` → `` `$${remaining.toFixed(2)} left` `` else `renderBar(fraction)`); resets rendering :195-198 (inert here — no `resetsAt`). **Tier 1 adds one render: `limit.notes` as a muted sub-line** (Step 1.4, mirroring the resets `<span>` pattern at :205-207; inert for all other providers — zero `notes` producers today, grep-verified). **Tier 2 adds one branch** (empty right cell for text-only rows).
- Tests: `packages/opencode/test/provider/usage/cline.test.ts` (stubbed-fetch pattern :15-22; captured-shape fixtures :129-172; **:150 asserts the wrong unit** `toBe(84.42)`).
- Graph coverage: `check_index_coverage` on all 5 files → `no_recorded_issue` (generation 2026-09-29T04:38:37Z, full mode); every file also re-read directly this session, so all `file:line` anchors are tree-verified.

---

## 6. Steps

### Step 1 — Fix the unit + relabel the balance row (`cline.ts`) — **BLOCKED on R1**

**Gate:** do not implement until R1 (§8.5) passes. If the dashboard Credits Balance card shows ≈$84.42, the shipped ÷100 is correct and this step inverts to a no-op (keep the row, keep ÷100, drop the "bug" framing).

1. `parseBalanceLimit` (:45-57): change `amount: { remaining: balance / 100, unit: "usd" }` → `remaining: balance / 1_000_000` (micro-USD → USD; §3.1). Update the JSDoc (:37-44): replace the "$0.01-per-credit (inferred)" claim with the three-source micro-USD citation, and fix the inline claim at :40-42 ("integer credit count … renders as `$<balance>/100 left`") to state micro-USD and the ÷1_000_000 conversion.
2. Relabel: `id: "cline-pass:credits"`, `label: "ClinePass Credits (pay-as-you-go)"`.
3. Add `notes: ["Subscription windows (5h/weekly/monthly) are not exposed by the Cline API — check app.cline.bot/dashboard/subscription"]` (field exists, `types.ts:37`; rendered by the dialog per Step 1.4 — this is the dashboard pointer's delivery path, not dead payload).
4. `dialog-usage.tsx` — render `limit.notes` as a muted sub-line: inside the left `<text>` node of the per-limit row (:201-208), after the resets `<Show>` (:205-207), add `<Show when={limit.notes?.length}><span style={{ fg: theme.textMuted }}>{"\n" + limit.notes.join("\n")}</span></Show>` — the exact pattern already proven in-file for `resets` (:205-207). If the embedded newline does not render as a sub-line in the TUI `<text>` node, fall back to a sibling muted `<text>` row under the label (restructuring the row box into a column); the §8.4 manual smoke is the acceptance check either way. Inert for every other provider (zero `notes` producers; grep-verified). No dialog test harness exists today (`test/**/*dialog-usage*` → none), so this is covered by typecheck + the §8.4 manual smoke.
5. Keep the two-call chain, envelope unwrap, graceful-`null` degradation, and `supports()` api_key-only exactly as shipped.

**Why:** the row's *value* is currently false by 10,000×; the relabel states what the number is and is not, and the rendered notes line gives the user the only honest path to their subscription windows. This is the honest fallback the task prescribes.

### Step 2 — Gating (no code)

Unchanged from shipped behavior: no `cline-pass` auth entry → no credential → no report → section absent; endpoint failure → `null` → section absent (`registry.ts:65-81` + `cline.ts:68-102`). Verify only.

### Step 3 (Tier 2 — OPTIONAL, needs user confirmation) — Plan row

1. `cline.ts`: add exported pure `parseUserPlan(raw: unknown): { displayName?: string; interval?: string; periodEnd?: number; canceled?: boolean } | null` unwrapping the `{ data }` envelope; fetch `GET /api/v1/users/me/plan` (no user-id round-trip needed — `me` works on this route, §2.1 #2) best-effort after the balance call; append the plan `UsageLimit` (mapping in §4) when parseable.
2. `dialog-usage.tsx` (:209-213): extend the right-cell ternary with one branch — when `fraction === undefined && limit.amount.unit !== "usd"`, render an empty string instead of `renderBar(fraction)` (kills the meaningless `[░░░…] —` for text-only rows). Single-line change; ZAI/Anthropic rows unaffected (they always have fractions).
3. If the user declines Tier 2, ship Tier 1 only — it is self-contained.

**Why:** plan name + period end is real, cheap (one extra call), and gives the subscriber the only subscription context the API offers. Flagged optional because it adds a dialog branch and a third HTTP call.

### Step 4 — Rejected alternative (documented, do not implement)

Client-side windowed aggregation (sum `/usages` `costUsd` over rolling-5h / calendar-week / calendar-month, divide by `inferenceCapThreshold`) — rejected because thresholds are sentinels (§4.3), pagination is unbounded for the 30-day window (§2.1 #6-7), reset timestamps don't exist (§4.5), and it would present an approximation as a quota. Revisit only if Cline ships a real quota endpoint.

---

## 7. Tests (`packages/opencode/test/provider/usage/cline.test.ts`)

Run from `packages/opencode` (root-test guard). Reuse the existing `stubFetch` pattern (:15-22).

1. **Update** the captured-shape assertion :150: `remaining` → `toBe(0.008442)` (8442/1e6) and `id`/`label` → the new `"cline-pass:credits"` / `"ClinePass Credits (pay-as-you-go)"`.
2. **Update** the JSDoc-adjacent test names to say "micro-USD" (behavioral naming).
3. **Add**: `notes` carries the dashboard-pointer string on the balance limit (fetcher-side half; the render half is verified by the §8.4 smoke — no dialog test harness exists).
4. **Add** (Tier 2 only): `parseUserPlan` against the captured `/users/me/plan` envelope (redacted fixture inline in the test): extracts `displayName`, `interval`, `currentPeriodEnd` → epoch ms, `canceledAt` presence; missing envelope → `null`; non-object → `null`. And a `fetchUsage` test asserting the plan limit is appended after the balance limit and the dialog-branch precondition (`unit: "unknown"`, no fraction).
5. Keep all existing degradation tests green (they assert `null` paths, unaffected by the unit change).

Fixture policy: pin fixtures to the redacted live captures embedded in §2.1 (envelope shapes are the contract; values like `8442` are representative).

---

## 8. Verification

1. `bun typecheck` from `packages/opencode` (never raw `tsc`). No SDK change → no regen; `packages/app` unaffected.
2. `bun test test/provider/usage/cline.test.ts` from `packages/opencode`; then the full package suite (order-dependence policy; note Windows full-suite slowness — targeted runs acceptable per `test/AGENTS.md`).
3. `bun run lint` from repo root; grep output for `no-unused-vars` and `: error ` (pre-existing ~268 warnings; verify none new).
4. Manual smoke: `/usage` in TUI → ClinePass section shows `ClinePass Credits (pay-as-you-go)  $0.01 left` with the muted sub-line `Subscription windows (5h/weekly/monthly) are not exposed by the Cline API — check app.cline.bot/dashboard/subscription` under the row (live balance 8442). This smoke is also the acceptance check for the Step 1.4 notes render.
5. **User confirmation gate (before implementation):** verify the corrected value against the app.cline.bot dashboard "Credits Balance" card (expect ≈$0.01 / 0.8442 credits), and confirm whether Tier 2 (plan row) is wanted.

---

## 9. Confirmed findings vs risks/unknowns

**Confirmed:**
- [CONFIRMED-live, bounded to probed surfaces — see §2.3 for the tried/not-tried table] No windowed-quota endpoint on the Bearer REST surface under `https://api.cline.bot/api/v1` (404 sweep §2.1 #12); no quota headers on inference or metadata responses (§2.2). Not-tried surfaces (OAuth flow, GraphQL, alternate hosts, admin routes, richer `/users/me` variants, dashboard session internals) are explicit [UNKNOWN]s (§2.3).
- [CONFIRMED-live] `/users/me/plan` returns plan + sentinel window thresholds + subscription period/cancel dates; `/users/{id}/balance` returns `balance: 8442`; `/users/{id}/usages` is cursor-paginated history (200/page cap, no date filter, `total` always 0) with `creditsUsed: 0` on every record.
- [CONFIRMED-source] Balance/credits unit is micro-USD (1e-6 USD; the Cline codebase names it "microcredits"): `account-view.tsx:341-346` (÷1e6→$, call sites :537/:542/:648/:700), `format.ts:39-41` (÷10,000→credits), `CreditLimitError.tsx:52` ("stored in microcredits"). Shipped `cline.ts:55` ÷100 is a 10,000× bug.
- [CONFIRMED-source] No Cline client reads `inferenceCapThreshold` (exhaustive grep, §3.2); the account service has no quota method (§3.3); the only limit signal is post-hoc 429 prose (§3.4); the official UI shows a flat transaction list (§3.5).
- [CONFIRMED-source] `docs/getting-started/clinepass.mdx:118-124` defines the three windows and points users at the dashboard for current usage.

**Risks / unknowns:**
- **R1 [UNKNOWN]** — the corrected display ($0.01) contradicts the shipped $84.42; the user should eyeball the dashboard Credits Balance card before merge. The three-source unit evidence is strong but the dashboard check is the ground truth.
- **R2 [UNKNOWN]** — `inferenceCapThreshold` unit (USD vs micro-USD). Sentinel either way; does not affect the fallback. Matters only if a real quota endpoint ever ships.
- **R3 [INFERRED risk]** — the API is undocumented and has already diverged from docs (envelope wrapping); captured shapes may drift. Mitigation: graceful `null` degradation (shipped) + fixtures pinned to captures.
- **R4 [UNKNOWN]** — the cookie-auth dashboard API (`app.cline.bot/api/*`) might expose windowed usage to a logged-in session; it is not accessible via API key [CONFIRMED-live §2.1 #15] and no official client uses it. Out of scope; recorded as the only conceivable remaining path to (a).
- **R5 [INFERRED, cosmetic]** — `toFixed(2)` rounds sub-cent balances ($0.008442 → "$0.01"); balances < $0.005 render "$0.00". Accepted; matches the dashboard's 2-decimal convention.
- **R6** — dialog empty-state text "(requires OAuth auth)" (`dialog-usage.tsx:171`) remains inaccurate for API-key providers; pre-existing, out of scope.

## 10. Open Questions

- **OQ-1 (user confirmation required):** Ship Tier 1 only, or Tier 1 + Tier 2 (plan row + one-line dialog branch)? Recommendation: Tier 1 mandatory (bug fix), Tier 2 optional.
- **OQ-2:** Dashboard Credits Balance cross-check (R1) — resolves the last doubt on the unit correction.
- **OQ-3:** Will Cline ship a first-party quota endpoint? Unknowable from here; if yes, the ZAI mapping (`zai.ts:49-70,103-144`) is the ready template and this plan's Step 4 becomes implementable.