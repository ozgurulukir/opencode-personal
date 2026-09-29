# ClinePass Remaining Quota in `/usage` — Phase 2: the quota endpoint EXISTS

Date: 2026-09-29
Status: RESEARCH COMPLETE — verdict **feasible**. `GET /api/v1/users/me/plan/usage-limits` (Bearer API key) returns per-window `percentUsed` + `resetsAt` for `five_hour` / `weekly` / `monthly`. ZAI-style bars are implementable with **zero type, registry, or dialog changes**.
Scope: `packages/opencode` only — extends the shipped fetcher (`cline.ts`). No SDK regen (no server-side schema change); `packages/app` unaffected.
Supersedes-in-part: `_plan/clinepass-subscription-quota-2026-09-29.md` — its negative verdict (§4 there) is **falsified** by this investigation: its 404 sweep never tried the `/plan/usage-limits` route, which this plan found in the dashboard's own JS bundles. That plan's shipped fallback (micro-USD balance fix, plan row) is already implemented in the tree and is preserved.

---

## 1. Goal

Make `/usage` show the **remaining ClinePass subscription quota** as three windowed bars (5-hour / weekly / monthly) with reset countdowns — the exact data the official dashboard shows — sourced from the endpoint discovered in this investigation, using the already-stored API key. Also retire the now-false "windows are not exposed by the Cline API" note shipped on the balance row.

Method discipline: every claim below cites either a **live capture** (2026-09-29, real key from `auth.json` loaded into a shell variable, never printed; secrets/IDs redacted) or **source** (dashboard JS bundle captured from `app.cline.bot`, or the `cline/cline@main` tarball extracted 2026-09-29 07:33 local). No wire shape is guessed.

**Probe tooling note (disclosed):** the coordinator expected probes via `webfetch` only, but `webfetch` cannot send `Authorization` headers and truncates large JS bundles. All HTTP probes were therefore done with local `curl.exe` — the same methodology as the prior plan (§2 there). The key was read from `auth.json` into a shell variable and never echoed; response bodies contain no credentials (verified before quoting).

---

## 2. Live probe log (2026-09-29, ~06:28–06:35 UTC)

Reproducible skeleton (PowerShell; key read from variable, never inlined/printed):

```powershell
$auth = Get-Content -LiteralPath "$env:USERPROFILE\.local\share\opencode\auth.json" -Encoding UTF8 | ConvertFrom-Json
$key = $auth.'cline-pass'.key
curl.exe -s -i -H "Authorization: Bearer $key" -H "accept: application/json" "https://api.cline.bot/api/v1/users/me/plan/usage-limits"
```

### 2.1 `GET /api/v1/users/me/plan/usage-limits` — THE quota endpoint [CONFIRMED-live]

`Authorization: Bearer <stored cline-pass key>` → **200 OK** (`X-Request-Id: lXNjomgoCOooEKQNWCTZOKqHIpeFsHXB`, `Content-Length: 276` — the JSON below is reformatted for readability; the raw body is these 275 bytes plus a server trailing newline):

```json
{"data":{"limits":[
  {"type":"five_hour","percentUsed":7, "resetsAt":"2026-09-29T09:09:00.361942941Z"},
  {"type":"weekly",   "percentUsed":86,"resetsAt":"2026-09-29T08:53:18.363835999Z"},
  {"type":"monthly",  "percentUsed":91,"resetsAt":"2026-10-13T07:24:39.36560156Z"}
]},"success":true}
```

- `type` ∈ {`five_hour`, `weekly`, `monthly`} — matches the dashboard's label map (§3.5).
- `percentUsed` — integer 0–100 in captures (7, 86, 91).
- `resetsAt` — ISO-8601 with **nanosecond** precision; `Date.parse` handles it (truncates to ms).
- **Repeat probe (~7 min later): same shape; `five_hour` ticked 7 → 8** (live usage accruing while probing) and every `resetsAt` drifted sub-second (`09:09:00.361942941Z` → `09:09:00.355833441Z`) — the server recomputes the window boundary per request. Windows are **rolling, anchored to usage times**, not calendar boundaries: `weekly` resets Tuesday 08:53 UTC (not Monday 00:00), `monthly` resets Oct 13 07:24 (= Sep 13 + 30 days, not Oct 1). This contradicts the docs' "calendar week/month" wording (`docs/getting-started/clinepass.mdx:120-124` in the cline tarball); live data wins (repo rule: the code wins).
- **Unauthenticated probe → 401** with a bare error body (no `success:false` wrapper): `{"error":"Unauthorized: Please make sure you're using the latest version of Cline and re-authenticate your Cline account."}` — the shipped non-OK → skip degradation covers this.

### 2.2 `GET /api/v1/users/{id}/usages/daily?startDate=…&endDate=…` [CONFIRMED-live]

New endpoint (absent from the prior plan's sweep). Date-only ISO dates accepted. Response: per-day, per-model aggregates — `{ date, operation, aiModelTypeName, aiModelName, costUsd, promptTokens, completionTokens }` (16 items for Sep 22–29, e.g. `{"date":"2026-09-22","operation":"chat_completion","aiModelTypeName":"cline-pass","aiModelName":"cline-pass/deepseek-v4.1-flash","costUsd":109048591,"promptTokens":67007970,"completionTokens":826115}`). **No `remaining`/`limit`/`resetAt`/window fields** — aggregation only. Not needed for quota display (the dashboard's usage page uses it for history tables). The `costUsd` unit is ambiguous at these magnitudes (micro-USD would say $109/day for this account's heavy agent usage) — flagged U6; **not load-bearing here**.

Also re-confirmed via the dashboard's generated client (§3.3): `/api/v1/users/{id}/usages` query struct is **`cursor` + `limit` only** — no date filter (matches prior plan §2.1 #11).

### 2.3 `GET /api/v1/users/me/plan` — complete payload [CONFIRMED-live]

Full capture (IDs truncated, no credentials present in body):

```json
{"data":{
  "planHistoryId":"iph-01M2…","userId":"usr-…",
  "plan":{"id":"pln-01KS…","name":"Cline Pass (Monthly)[Internal]","displayName":"Cline Pass (Monthly)",
    "description":"Cline Pass brings agentic coding to programmers around the world. …",
    "type":"individual","interval":"Monthly","pricePerSeatCents":999,"priceId":"price_1Tk5…","maxSeats":1000000,
    "features":{"fee_dollars":0.61,"free_seats":0,"included":["Low cost subscription pricing", …model list…]},
    "entitlements":{"cline_pass":{"enabled":true,"inferenceCapThreshold":{
      "last5HoursUsageCostUSDPerUser":1000000000,
      "last7daysUsageCostUSDPerUser":2500000000,
      "last30daysUsageCostUSDPerUser":5000000000}}},
    "isActive":true,"createdAt":"2026-05-26T09:34:05.877169Z","updatedAt":"2026-09-21T10:11:10.680596Z"},
  "subscriptionId":"sub_…","currentPeriodStart":"2026-09-12T20:07:47Z","currentPeriodEnd":"2026-10-12T20:07:47Z",
  "cancelAt":"2026-10-12T20:07:47Z","canceledAt":"2026-09-14T10:10:39Z"},
 "success":true}
```

- **Sentinel thresholds confirmed unchanged** (1e9 / 2.5e9 / 5e9) — they are no-cap sentinels, not real quotas (prior plan §4.3). The REAL enforcement is invisible; `usage-limits`' `percentUsed` is the only derived signal exposed. No absolute used/limit values exist anywhere on the surface.
- New fields vs the prior capture: `plan.id`, `plan.description`, `plan.priceId`, `plan.maxSeats`, `plan.features` (marketing copy + included-model list). None carry quota data.

---

## 3. Dashboard internals (`app.cline.bot`) — how the endpoint was found [CONFIRMED-source]

Method: downloaded `https://app.cline.bot/dashboard/subscription` (200, 22.7 KB, Next.js App Router shell — no `__NEXT_DATA__`; RSC flight data is streamed, none present for a logged-out curl) plus all **46 referenced `/_next/static/chunks/*.js`** (1.76 MB total) to `%TEMP%\opencode\cline-dashboard\chunks\`, then grepped locally. `webfetch` was unsuitable (no custom headers, bundle mangling).

### 3.1 Endpoint enumeration (grep `api/v1/…` across all chunks)

The generated API client embedded in the bundles exposes the full surface. Quota-relevant routes: `/api/v1/users/me/plan`, `/api/v1/users/me/plan/usage-limits`, `/api/v1/users/me/plan/subscription`, `/api/v1/users/me/plan/resume`, `/api/v1/users/{id}/usages`, `/api/v1/users/{id}/usages/daily`, `/api/v1/users/{id}/balance`, `/api/v1/users/{id}/payments`, `/api/v1/plans`, plus organization-scoped variants (`/organizations/{orgId}/plan`, `/usages`, `/metrics/*` — N/A for this individual account, `organizations: []` per prior plan §2.1 #1). **`plan/usage-limits` is the only per-user windowed-quota route.**

### 3.2 The generated client method (chunk `4081-5846c56218676d3c.js`)

Minified but greppable (citations = chunk filename + unique code anchors; bundles are minified, so no stable line numbers — U5):

```js
async getCurrentUserPlanUsageLimitsRaw(e){let t={};
  this.configuration&&this.configuration.apiKey&&(t.Authorization=await this.configuration.apiKey("Authorization"));
  … new d(await this.request({path:"/api/v1/users/me/plan/usage-limits",method:"GET",headers:t,query:{}},e),
    e=>…({data:…{limits:…n.limits.map(M)},…}))
```

- **Method GET, no query params.** Auth via `Authorization` header **when the client is configured with an apiKey**.
- Response envelope `{ data: { limits: [...] }, success }`; per-item deserializer `M`:

```js
function M(e){…return {percentUsed:…,resetsAt:…,type:…}}   // exactly 3 fields per limit item
```

### 3.3 Dashboard auth wiring — cookies in the browser, Bearer accepted server-side

Client singleton (module `53796` in the same chunk):

```js
let o=new a.Vk6({get basePath(){return(0,i.getRuntimeConfig)().apiBaseUrl},
  credentials:"include",   // ← session cookies sent on every call
  fetchApi:…15s timeout…, middleware:[r.U$]})
```

**No `apiKey` is set** → in the browser the dashboard authenticates via **cookie session** (`credentials:"include"`; login flow routes `api/v1/auth/authorize|callback|token|refresh`), and the generated client's Authorization-header path is unused by it. `apiBaseUrl` comes from `window.__RUNTIME_CONFIG__` (module `43511`), not present in the static shell — but the live Bearer capture (§2.1) proves `https://api.cline.bot` serves the route to API keys directly. **The stored opencode credential is sufficient; no cookie/OAuth session is needed.**

### 3.4 The SWR hook + page gating (chunk `6300-e41d73f83d2ea711.js`, page chunk)

```js
async function f(){return r.ZO.getCurrentUserPlanUsageLimits()}
let p=function(){…return(0,c.Ay)(e?["plans.getCurrentUserPlanUsageLimits"]:null,f,{errorRetryCount:0,…t})}
```

Page component `Q` (subscription page chunk): the hook is **enabled only when a plan exists** (`x=!!u` from the `/users/me/plan` call), and its errors are tolerated: `p = o && !(o instanceof P.OV && (404===o.statusCode||402===o.statusCode))` — **404 (no plan) and 402 (unpaid invoice) are treated as "no limits", not failures**. Data flow: `let w=(f?.data?.limits??[]).map(F).filter(e=>null!==e)` → rendered by section `K` when `x && !j && !N`.

### 3.5 The "5-hour/weekly/monthly" UI — pure server-data rendering (subscription page chunk `app__dashboard__subscription__page-3263dd94aa7c24de.js`)

```js
let Y={five_hour:{label:"5-Hour Limit",bannerLabel:"5-hour limit",order:0},
       weekly:{label:"Weekly Limit",bannerLabel:"weekly limit",order:1},
       monthly:{label:"Monthly Limit",bannerLabel:"monthly limit",order:2}}
function F(e){return e.type&&D(e.type)?{type:e.type,percentUsed:null!=(t=e.percentUsed)?t:0,resetsAt:e.resetsAt}:null}
function M(e){return e>=100?"reached":e>=75?"approaching":"normal"}          // status thresholds
function V(e){return Math.min(100,Math.max(0,Math.round(null!=e?e:0)))}      // clamp+round
function q(e){if(!e.resetsAt)return 0;…new Date(e.resetsAt).getTime()…}      // resetsAt → epoch ms
```

Card `W`: renders `V(percentUsed)` as a progress bar `value:r` + `${r}%` + a client-side **"Resets in Xd Yh Zm"** computed from `resetsAt` vs `Date.now()`. Section `K`: filters known types, sorts by `order`, banner on the first `reached`. **The dashboard computes NO usage client-side — no hardcoded constants, no usage-history math; `percentUsed`/`resetsAt` come straight from the API.** (The only client-side numbers are display thresholds 75/100 and the relative-time formatting.)

---

## 4. Cline client source (`cline/cline@main`, tarball extracted 2026-09-29 07:33) [CONFIRMED-source]

- Exhaustive grep (`--no-ignore`, excluding `node_modules`): **zero hits** for `usage-limits`, `five_hour`, `getCurrentUserPlanUsageLimits`. The dashboard web app is a separate codebase (Vercel-hosted Next.js); **no official CLI/extension client calls the quota endpoint yet** — opencode would be first.
- Extension/CLI remain post-hoc-only: `sdk/packages/llms/src/providers/errors.ts:11` (`CLINE_PASS_LIMIT_MARKER = "clinepass limit"`), `apps/cli/src/utils/cline-pass-errors.ts:35`, `apps/vscode/webview-ui/src/components/chat/ClinePassLimitError.tsx:52`; fixture `apps/vscode/webview-ui/src/components/chat/ErrorRow.test.tsx:290` — *"You have reached your weekly Clinepass limit. The limit resets in 7d…"* (server prose after the 429; "resets in 7d" weakly corroborates rolling windows).
- Docs (`docs/getting-started/clinepass.mdx:120-124`) define the three windows and point users at the dashboard — consistent with §2.1's rolling-window observations except the docs' "calendar week/month" wording, which the live `resetsAt` values contradict.

---

## 5. Feasibility verdict + response→`UsageLimit` mapping

**Verdict: feasible.** One GET with the already-stored Bearer key returns everything a ZAI-style bar needs. No client-side window math, no constants, no fabricated denominators.

```
GET /api/v1/users/me/plan/usage-limits → {"data":{"limits":[{type,percentUsed,resetsAt},…]},"success":true}
per item (known types only, dashboard order five_hour→weekly→monthly):
→ UsageLimit {
    id: "cline-pass:limit:<type>",                    // e.g. "cline-pass:limit:five_hour"
    label: "5-Hour Limit" | "Weekly Limit" | "Monthly Limit",   // dashboard's own labels (§3.5)
    scope: { provider: "cline-pass", windowId: type },
    window: { id: type, label: "", resetsAt: Date.parse(resetsAt) },
                                              // label:"" suppresses the dialog's "— <window>" suffix
                                              // (redundant with the row label); resetsAt still renders
                                              // as " · resets in <Xh>" (dialog-usage.tsx:195-198)
    amount: { used: percentUsed, unit: "percent" },     // resolveUsedFraction percent branch (types.ts:69)
                                                        // → usedFraction = percentUsed/100 → renderBar
    status: buildUsageStatus(percentUsed/100),          // ok/warning/exhausted (types.ts:74-79)
  }
```

- **No dialog changes**: the right-cell ternary (`dialog-usage.tsx:212-218`) hits `renderBar(fraction)` for a defined fraction; the resets suffix (:195-198) renders from `window.resetsAt`; status colors (:189-194) apply. Rendered row: `5-Hour Limit · resets in ~3h` + `[░░░…] 7%` — same content as the dashboard card.
- **No type changes** (`UsageUnit` already has `"percent"`, `types.ts:3`), **no registry changes** (`PROVIDER_ID_MAP` + api_key dispatch already wired, `registry.ts:19-24,54-58`).
- Row order: `[credits, five_hour, weekly, monthly, plan]` — windows between the shipped balance and plan rows.
- **Retire the falsified note**: `parseBalanceLimit`'s `notes` (`cline.ts:107-109`) says windows are "not exposed by the Cline API" — falsified by §2.1. Remove it (the windows now have their own rows).

**Accuracy caveats (all display-only):**
1. `percentUsed` is server-rounded (integer in captures; the dashboard re-rounds via `V`) — bar granularity is 1%.
2. `resetsAt` is recomputed per request (sub-second drift observed, §2.1) — it is the moment the oldest in-window usage ages out (rolling windows), INFERRED from observed values; displayed verbatim as "resets in …", same phrasing as the dashboard's "Resets in …".
3. Status thresholds differ from the dashboard (opencode `buildUsageStatus` warns at ≥90%, dashboard at ≥75%) — cosmetic divergence, accepted; no code change.
4. Unknown `type` values are dropped (dashboard `F` parity); missing `percentUsed` → 0 (dashboard `?? 0` parity).

---

## 6. Architecture reuse (all anchors re-read from the tree this session)

- **`packages/opencode/src/provider/usage/cline.ts`** — the file to extend. Constants :6-9; `parseCurrentUser` :42-53; `parseUserPlan` :71-85; `parseBalanceLimit` :96-111 (**notes to remove :107-109**); `fetchClineUsage` :123-183 (chain: me → balance → plan; insert usage-limits between balance and plan; mirror the plan call's best-effort try/`safeCatch` pattern :147-172); export :185-189 (`supports` api_key-only unchanged).
- **`packages/opencode/src/provider/usage/types.ts`** — `UsageLimit` :30-38; `resolveUsedFraction` percent branch :69; `buildUsageStatus` :74-79. **No changes.**
- **`packages/opencode/src/provider/usage/zai.ts`** — windowed precedent (window `resetsAt` :103-108, per-type rows :110-144); referenced as the pattern, **not modified**.
- **`packages/opencode/src/provider/usage/registry.ts`** — `readAuthCredentials` :36-62 (auth.json at `Global.Path.data`; `type:"api"` + `key` → `{type:"api_key", apiKey}` :54-58), `fetchUsageReports` :65-81. **No changes.**
- **`packages/opencode/src/cli/cmd/tui/component/dialog-usage.tsx`** — `renderBar` :33-41; resets suffix :195-198; notes render :208-210 (stays; the ClinePass balance row simply stops producing notes); right-cell ternary :212-218. **No changes.**
- Tests: `packages/opencode/test/provider/usage/cline.test.ts` — `stubFetch` :15-22; captured-shape suites :188-305 (**:211-213 asserts the note that must be removed**).
- Graph coverage: `check_index_coverage` on all 6 files → `no_recorded_issue` (generation 2026-09-29T06:22:30Z, full mode); every file also read directly this session, so all `file:line` anchors are tree-verified.

---

## 7. Steps

### Step 1 — Fetch + parse the quota endpoint (`cline.ts`)

1. Add `const USER_USAGE_LIMITS_PATH = "/api/v1/users/me/plan/usage-limits"` (:6-9 block) and a label/order map mirroring the dashboard's `Y` (§3.5): `five_hour → "5-Hour Limit"`, `weekly → "Weekly Limit"`, `monthly → "Monthly Limit"`, order 0/1/2.
2. Add exported pure `parsePlanUsageLimits(raw: unknown): PlanUsageLimit[]` (shape: `{ type: string; percentUsed: number; resetsAt?: number }`): unwrap the `{ data: { limits } }` envelope; drop unknown types; `percentUsed` = clamp(0..100) of the finite-number value, else 0; `resetsAt` = `Date.parse` when finite. Non-object/envelope-less input → `[]`.
3. In `fetchClineUsage` (:123-183), after the balance call and before the plan call: `GET USER_USAGE_LIMITS_PATH` best-effort — non-OK → log + skip; throw → `safeCatch` + skip (mirror :147-172). Map parsed items (sorted by the order map) into `UsageLimit` rows per §5 and splice them between `balance` and the plan row.
4. Update `fetchClineUsage`'s JSDoc (:113-122): the chain is now me → balance → usage-limits (best-effort) → plan (best-effort).

**Why:** this is the exact data the dashboard renders (§3.5), obtained with the credential opencode already stores (§3.3, §2.1).

### Step 2 — Retire the falsified note (`cline.ts`)

1. Delete `notes` from `parseBalanceLimit` (:107-109) and update its JSDoc (:87-95) — the "windows are not exposed" claim and the dashboard-pointer rationale are both obsolete.
2. Leave the balance row's id/label/unit conversion untouched (micro-USD fix is independent and stays).

### Step 3 — Tests (`packages/opencode/test/provider/usage/cline.test.ts`; run from `packages/opencode`)

1. **Update** the captured-shape test :211-213: the credits row no longer carries `notes` (assert `toBeUndefined()`), rename the test (drop "dashboard note").
2. **Add** `parsePlanUsageLimits` tests against the §2.1 capture (fixture inline, values representative): extracts 3 items with clamped `percentUsed` + epoch `resetsAt`; unknown type dropped; missing/non-numeric `percentUsed` → 0; invalid `resetsAt` → omitted; missing envelope / non-object → `[]`.
3. **Add** fetcher tests: 4-call chain order `[users/me, {id}/balance, users/me/plan/usage-limits, users/me/plan]`; limits order `[credits, five_hour, weekly, monthly, plan]`; a window row's `amount` is `{used, unit:"percent"}` with `usedFraction` undefined (derived by `resolveUsedFraction`), `window.resetsAt` epoch, `status` set.
4. **Add** degradation tests: usage-limits 500 / 404 / thrown → report keeps `[credits, plan]` (windows skipped, balance+plan intact); empty `limits` array → no window rows.
5. Keep all existing degradation/plan tests green (only the :211-213 note assertion changes).

Fixture policy: pin to the redacted live captures in §2 (envelope shapes are the contract; `percentUsed` values representative).

### Step 4 — Verification

1. `bun typecheck` from `packages/opencode` (never raw `tsc`). No SDK change → no regen; `packages/app` unaffected.
2. `bun test test/provider/usage/cline.test.ts` from `packages/opencode`; then the full package suite per the order-dependence policy (Windows full-suite slowness documented — targeted runs acceptable).
3. `bun run lint` from repo root; grep output for `no-unused-vars` and `: error ` (pre-existing ~268 warnings; none new).
4. Manual smoke: `/usage` in TUI → Cline Pass section shows the credits row, then `5-Hour Limit`/`Weekly Limit`/`Monthly Limit` rows with bars + `resets in …` suffixes (live values at capture: 7% / 86% / 91%), then the plan row.
5. Cross-check: percentages match `app.cline.bot/dashboard/subscription` "Usage Limits" cards for the same account (they render the same endpoint, §3.4-3.5).

---

## 8. Confirmed findings

- **[CONFIRMED-live]** `GET https://api.cline.bot/api/v1/users/me/plan/usage-limits` with `Authorization: Bearer <stored cline-pass key>` → 200 `{"data":{"limits":[{type:"five_hour"|"weekly"|"monthly", percentUsed:int, resetsAt:ISO-nano}]}}` (§2.1, two captures + repeatability probe). This is the windowed-quota surface the prior plan concluded did not exist.
- **[CONFIRMED-live]** Unauthenticated → 401 `{"error":"Unauthorized: …"}` (bare body, no `success` wrapper) (§2.1).
- **[CONFIRMED-live]** `GET /users/{id}/usages/daily?startDate&endDate` (date-only ISO) → per-day/per-model aggregates, no quota fields; `/users/{id}/usages` query struct is `cursor`+`limit` only (§2.2).
- **[CONFIRMED-live]** `/users/me/plan` full payload captured; `inferenceCapThreshold` sentinels (1e9/2.5e9/5e9) unchanged — no real thresholds exposed anywhere (§2.3).
- **[CONFIRMED-source]** The dashboard's subscription page renders `percentUsed`/`resetsAt` **directly from the API** — no client-side computation, no hardcoded usage constants; only display thresholds (75/100) and relative-time formatting are client-side (§3.5).
- **[CONFIRMED-source]** Dashboard client: generated OpenAPI SDK, `credentials:"include"` (cookie session in browser), Authorization-header path supported but unconfigured; the endpoint additionally accepts the Bearer API key (proven live) (§3.2-3.3).
- **[CONFIRMED-source]** `cline/cline@main` has zero references to the endpoint; extension/CLI show only post-hoc 429 prose (§4).
- **[CONFIRMED-live]** Stored credential surface: `auth.json` `cline-pass` entry is `type:"api"` (67-char key, no access/refresh tokens) → `registry.ts:54-58` maps it to the `api_key` credential the fetcher already uses (masked inspection, this session).

## 9. Unknowns / unreachable

- **U1 [INFERRED]** Usage-limits response for plan-less users: the dashboard tolerates 404/402 as "no limits" (§3.4); not directly probed (this account has a plan). Our non-OK → skip degradation covers every status.
- **U2 [INFERRED]** `percentUsed` precision: integers observed; the dashboard re-rounds, suggesting the server may emit fractions. Clamp+derive handles both; bar granularity is 1% either way.
- **U3 [INFERRED]** `resetsAt` semantics: rolling-window boundary recomputed per request (sub-second drift observed; weekly resets Tuesday 08:53, monthly Oct 13 = +30d). Displayed verbatim; no implementation impact. Docs' "calendar week/month" wording contradicted by live data.
- **U4 [UNKNOWN]** Rate-limit behavior of the endpoint under polling — the dialog fetches once per open; no polling planned. Low risk.
- **U5 [UNKNOWN]** Dashboard source is not public — bundle citations are greppable minified anchors (chunk filename + code snippet), not stable line numbers. Re-downloadable via the URLs in §3 if drift is suspected.
- **U6 [UNKNOWN]** `costUsd` unit in `/usages/daily` (micro-USD reading gives $109/day for this account — plausible for its volume but unverified against a dashboard display). Not used by this plan.
- **Unreachable-by-design:** cookie-session dashboard internals beyond what the bundles reveal (no browser session available); OAuth-type Cline auth (the stored credential is API-key only, and none is needed — §3.3).

## 10. Open Questions

- **OQ-1:** Row order — resolved: windows between credits and plan (`[credits, five_hour, weekly, monthly, plan]`, §5). Cosmetic.
- **OQ-2:** Should the weekly/monthly rows also surface the `/usages/daily` history as `metadata` (like ZAI's model-usage blob)? Not needed for the quota verdict; defer until asked.
- **OQ-3:** Upstream-worthiness — opencode would be the first client to consume `plan/usage-limits`; consider flagging the discovery to `cline/cline` so their CLI/extension can adopt it. Out of scope here.