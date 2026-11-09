# Plan: Replace fixme e2e with a minimal critical-path smoke (issue #381)

## Goal

The `packages/app` e2e suite is a `test.fixme()` stub with zero assertions, yet CI runs it (browser install + ≤30 min matrix) — a green e2e job implies product safety that does not exist. Replace the stub with **one real Playwright spec** that exercises the client critical path (boot → open session → send prompt → optimistic bubble resolves to the server message) against a **mocked opencode transport**, so CI **fails on regression** of what it covers and the job's green status is honest.

**Chosen approach: documented subset with Playwright `page.route` mocks (option 2).** A real backend in CI is infeasible (no harness, no provider credentials, no LLM — see Architecture Decisions). Pure job removal (option 3) is rejected as first iteration: the job infra already exists and a deterministic mocked smoke is cheap and valuable. Full AC (1a) is attempted via mocked transport; if backend-harness limits block any step, the spec documents the limitation in its header (AC 1b) rather than skipping.

## Context / Problem (verified against tree, 2026-11-08)

| Evidence | Location |
| --- | --- |
| Sole e2e body is `test.fixme()` with `type: "todo"` annotation, zero assertions | `packages/app/e2e/todo.spec.ts:3-10` |
| Only files under `e2e/` are `todo.spec.ts` + `tsconfig.json` — **no harness, no fixtures, no mocks** | `packages/app/e2e/` |
| CI e2e job: cache/install chromium → `bun --cwd packages/app test:e2e:local`, `timeout-minutes: 30`, linux+windows matrix, junit upload | `.github/workflows/test.yml:96-166` (run step at :149-154) |
| Playwright `webServer` starts **only Vite** (`bun run dev -- --host 0.0.0.0 --port ${port}`); app pointed at backend via `VITE_OPENCODE_SERVER_HOST/PORT` (default `127.0.0.1:4096`) | `packages/app/playwright.config.ts:28-37` |
| **No second `webServer`, no backend start, no `opencode serve` anywhere in CI or config** | repo-wide: only one `playwright.config.*` exists (app) |
| App shell boots without backend: `entry.tsx` passes `disableHealthCheck` → `ConnectionGate` short-circuits to `true` | `src/entry.tsx:174`, `src/app.tsx:181-183` |
| Global bootstrap still needs REST: `/global/config`, `/provider`, `/path`, `/project` (slow set) plus per-directory `/agent`, `/config`, `/api/session/status`, `/project/current`, `/vcs`, `/command`, `/permission`, `/question`, `/mcp`, session list | `src/context/global-sync/bootstrap.ts:116-124,219-330` |
| Send is gated on `currentModel` + `currentAgent` (connected provider + non-deprecated model + primary agent) else toast blocks | `src/components/prompt-input/submit.ts:160-168` |
| Optimistic path: `optimisticAdd` → `POST /api/session/{id}/prompt_async` → SSE `session.next.prompted` → `resolveOptimistic` **by prompt text** → single projected row | `sendFollowupDraft.ts:108-129`, `sync.tsx:232-244`, `event-reducer.ts:348-383,959-961` |
| SSE: `GET /global/event`; envelope `{ directory, payload }`; `EventSessionNextPrompted = { id, type, properties: { sessionID, timestamp, agent, model, prompt } }` — **`id` on payload top level**; reducer does `event.id ?? ""` | SDK `types.gen.ts:760-765,2876-2891`; `event-reducer.ts:361`; client loop `global-sdk.tsx:136-176` (heartbeat 15s, reconnect 250ms) |
| V2 REST shapes the app reads: `GET /api/session/{id}` → `Session`; `GET /api/session/{id}/message` → `{ items: SessionMessage[], cursor }` (**not** a bare array); `GET /api/session` → `{ items, cursor }`; `GET /provider` → `{ all, default, connected }`; `GET /agent` → agent list | SDK `sdk.gen.ts` (`Session3` class :4327, `promptAsync` :5435 url `/api/session/{sessionID}/prompt_async`, `messages` :5495 url `/api/session/{sessionID}/message`); `types.gen.ts:1723-1729,5380-5390` |
| Timeline hooks: `role`-neutral list at `[data-slot="session-turn-list"]`, rows keyed by `data-message-id` | `src/pages/session/message-timeline.tsx:855,897` |
| Optimistic client id prefix `msg_` (`Identifier.ascending("message")`) | `src/utils/id.ts:3-10,64` |
| Prompt placeholder `prompt.placeholder.simple` = `Ask anything...`; home empty state `home.empty.title` = `No recent projects` | `src/i18n/en.ts:236,519` |
| Routes: `/:dir` (URL-safe base64 of directory) → `/:dir/session/:id?` | `src/app.tsx:317-321`; `base64Encode` in `@opencode-ai/core/util/encode` |
| **Zero `data-testid`** under `packages/app/src` | repo grep |
| Unit suite remains: ~539 `test()` per issue (spot-verified ~508 `test(` + 25 `it(` across `packages/app/src`) — unaffected by this change | issue #381; local count |
| `tsgo -b` typecheck only `include`s `src` — **e2e/ is not typechecked** by `bun run --cwd packages/app typecheck`; `e2e/tsconfig.json` exists but nothing runs it in CI | `packages/app/tsconfig.json:24`, `e2e/tsconfig.json` |
| README e2e section claims “UI tests expect an opencode backend at localhost:4096” and shows a stale `--grep "settings"` example (no settings spec exists) | `packages/app/README.md:32-46` |
| Supplementary findings doc | `_plan/webui-review-findings-2026-11-08.md` (A-1) |
| Prior draft plan on same topic (superseded by this file) | `_plan/app-e2e-smoke-2026-11-08.md` |

## Chosen approach (decision grounded in what exists)

**Documented subset with mocked transport — Playwright `page.route` interception of the opencode HTTP + SSE surface, one real critical-path spec.**

Why this and not the alternatives:

1. **Real backend in CI (rejected):** nothing in the repo stands up `opencode serve` for e2e; Playwright config has one `webServer` (Vite). Adding a second would still require a **connected provider + model** for the `submit.ts` gate and a working LLM run for `prompt_async` → `Prompted` (no secrets in CI), plus directory fixtures, port cleanup on a 2-OS 30-min matrix, and Windows path quirks. Out of scope for a “minimal smoke”.
2. **Job removal / disable (rejected for first iteration — AC 3):** discards an already-provisioned job (browser cache, matrix, artifact upload). Only reconsider if mocked SSE proves impossible (Open Question 4). Unit suite (~539) does **not** cover browser boot, optimistic SSE resolve, or DOM projection — removing the job would leave that path uncovered entirely.
3. **Boot-only smoke (fallback, not first choice):** weaker than AC (1a); kept only as the documented degradation path if send/resolve cannot be mocked reliably (see fallback ladder in Step 2).

The spec covers the **client** critical path end-to-end in a real browser; server/persistence/LLM behavior is explicitly out of scope and documented in the spec header (satisfies AC 1b’s “documented subset” clause while attempting AC 1a).

## Steps

1. **Add mock helpers** — create `packages/app/e2e/mock-api.ts`
   - Why: keep the spec narrative readable; single place for fixtures + route install + handles for assertions.
   - Export `installMockApi(page, opts?)` returning `{ lastPrompt, serverMessageId, promptSent }` (a promise resolved when `prompt_async` is observed).
   - Register `page.route` handlers (match on path suffix; baseUrl is `http://127.0.0.1:4096` from `VITE_OPENCODE_SERVER_*`):
     - `**/global/health` → `{ healthy: true, version: "e2e" }` (harmless even though `disableHealthCheck` short-circuits)
     - `**/global/config` → `{}` (minimal `Config`)
     - `**/provider` → full `ProviderListResponse`: `{ all: [mockProvider], default: { mock: "mock-model" }, connected: ["mock"] }` where `mockProvider` has every field the SDK/`normalizeProviderList` path reads (`source`, `env`, `options`, `models` with a non-deprecated full `Model`: `api`, `capabilities`, `cost`, `limit`, `status`, …). **Pin fixture types to SDK `ProviderListResponses` / `Provider` / `Model` — partial stubs can fail parse/normalize and silently leave `currentModel` undefined (send never leaves the toast).**
     - `**/path` → `{ home, state, config, worktree, directory }` with a stable POSIX fake directory (e.g. `/e2e-project`) so the base64 URL segment is identical on linux and windows CI
     - `**/project` → one `Project` (`id`, `worktree` = fake dir, `time: { created, updated }`, `sandboxes: []`); `**/project/current` → same project id
     - `**/agent` → at least one primary agent (`name: "build"`, `mode: "primary"`, `permission: []`, `options: {}`) so `agent.current()` resolves
     - Instance bootstrap catch-alls as revealed by first local run: `**/config`, `**/vcs`, `**/command` (→ `[]`), `**/permission` (→ `[]`), `**/question` (→ `[]`), `**/mcp` (→ `{}`), `**/api/session?*` list (→ `{ items: [], cursor: {} }`)
     - `GET **/api/session/{id}` → full fixed `Session` (`id: "ses_e2e..."`, `title`, `time`, `directory` = fake dir). **Do not rely on a truthy `{}`** — session loaders only reject null/undefined and a bare object poisons the store.
     - **Route precedence:** Playwright matches last-registered first, and `**/api/session/*` (the `{id}` detail route) also matches `/api/session/status`. Register `GET **/api/session/status` (→ `{}`) **AFTER** the `**/api/session/{id}` detail route so the status route wins; keep this ordering explicit when adding any further first-run catch-alls that share a prefix with a more specific route.
     - `GET **/api/session/{id}/message` → `{ items: [], cursor: {} }` (app reads `messages.data?.items`, **not** a bare array — `sync.tsx:321-325`)
     - `POST **/api/session/{id}/prompt_async` → `204`; **parse the body** (`{sessionID, agent, model, messageID, parts, variant}`) — the prompt text lives in `parts[].text` (join text parts; there is no top-level prompt field), record it on `lastPrompt` so the SSE frame text matches what `resolveOptimistic` compares against; resolve `promptSent`. Support env flag `E2E_FAIL_PROMPT_ASYNC=1` → return **500** and, under that flag, **do not resolve `promptSent` and do not deliver the prompted SSE frame** (negative regression check, Step 7 — see note there for why).
     - `GET **/global/event` → **SSE** (`content-type: text/event-stream`): two-phase — hold the route until `promptSent`, then fulfill with scripted frames. Exact line shape (lock byte-for-byte against `global-sdk.tsx` / reducer during implementation):

       ```
       data: {"directory":"/e2e-project","payload":{"id":"evt_e2e_0001","type":"session.next.prompted","properties":{"sessionID":"ses_e2e_...","timestamp":<ms>,"agent":"build","model":{"id":"mock-model","providerID":"mock","variant":"default"},"prompt":{"text":"<capturedPromptText>"}}}}
       ```

       The **`id` lives on `payload` top level** (next to `type`), not inside `properties`. `handlePrompted` does `event.id ?? ""` (`event-reducer.ts:361`) — omitting it yields `data-message-id=""` and breaks Step D. Use `evt_e2e_0001`, **distinct from** the optimistic `msg_*` id. **`properties.prompt` must be an object with `.text` (not an array of parts)** — `Prompt = { text, ... }` (`types.gen.ts:353-360`), the server emits `prompt: { text: ... }` (`create-user-message.ts:509-514`), and the reducer reads `props.prompt.text` (`event-reducer.ts:370,381`); an array shape makes `props.prompt.text` `undefined` → `resolveOptimistic` never matches → Step D times out. After fulfill the stream closes; client reconnects every 250ms (`global-sdk.tsx:193`) — subsequent SSE requests can be fulfilled with a no-op `sync` frame (`{"directory":"...","payload":{"type":"sync"}}`, skipped at `global-sdk.tsx:155`) or left to reconnect noise; assertions must not depend on a long-lived stream.
   - **Fallback inside `mock-api.ts`** (documented in file header): if `route.fulfill` streaming proves flaky, serve only `**/global/event` from a tiny local `Bun.serve` SSE endpoint started/stopped by the helper (REST stays on `page.route`) — see Open Question 1.

2. **Write the critical-path spec** — create `packages/app/e2e/critical-path.spec.ts`
   - Why: this is the deliverable for AC (1) and (2).
   - Header block comment: **Limitations** — transport is mocked via Playwright routes; no real `opencode serve`, no real LLM, no real SQLite/projector path; unit suite (~539 tests) remains the server/persistence safety net; links issue #381. This is the AC (1b) “documented subset” record.
   - `test.beforeEach`: `installMockApi(page)` + `page.goto("/")`.
   - **Step A (boot):** expect home chrome after mocked bootstrap — primary: empty-state text `No recent projects` (`en.ts:519`, verified in `home.tsx`); secondary (only if the primary is ambiguous): the open-project button. Assert the Vite app actually mounted (not a blank page / connection-error screen). *(Do not rely solely on `getByRole("button", { name: /open project/i })` — that selector was not verified against `home.tsx`.)*
   - **Step B (open session):** direct `page.goto(\`/${base64Encode(fakeDir)}/session/ses_e2e_...\`)` for determinism (document why: avoids command-palette / recent-project click flake). Assert prompt input visible: `getByPlaceholder(/ask anything/i)` (`prompt.placeholder.simple`).
   - **Step C (send):** fill a unique string (e.g. `E2E critical path ${Date.now()}`), press Enter (or click `[data-action="prompt-submit"]`). Wait for optimistic row: `[data-slot="session-turn-list"]` contains the text; capture `data-message-id` matching `/^msg_/`.
   - **Step D (resolve):** wait until a `[data-message-id]` containing that text has id **≠** optimistic id (i.e. `evt_e2e_0001` from the mock). Assert **exactly one** node with that text (no duplicate optimistic+server rows — locks `resolveOptimistic` + `mergeOptimisticPage`).
   - **No `test.fixme` / `test.skip` on the main path.** If a sub-step is genuinely blocked by harness limits during implementation, keep the runnable assertions and extend the header limitation list — never mark the test fixme/skip.
   - Fallback ladder if Steps C/D cannot be made reliable in a timebox: (i) drop only Step D and document “optimistic appears; server resolve needs real SSE — not covered”; (ii) if send itself is blocked, ship boot+open-session only and document. Either still satisfies AC (1b)+(2) as long as the spec **fails when its covered assertions break**. Job removal (AC 3) only if even boot assertions cannot run — not expected.

3. **Delete the placeholder** — remove `packages/app/e2e/todo.spec.ts`
   - Why: the issue asks to *replace* it; leaving a fixme next to a real spec keeps a permanent todo annotation in reports.

4. **Leave `.github/workflows/test.yml` unchanged**
   - Why: job already runs `test:e2e:local` with browser install and artifact upload; once the fixme is gone, AC (2) holds (CI runs a non-fixme spec that fails on regression). Do **not** remove the job (that is AC 3 — not chosen).

5. **Leave `packages/app/playwright.config.ts` unchanged** unless the SSE fallback (tiny local server) is activated
   - Why: Vite `webServer` + `VITE_OPENCODE_SERVER_*` already point the app at `127.0.0.1:4096`; `page.route` intercepts before the network, so nothing must listen on 4096 for REST. Only if SSE via `route.fulfill` fails (Open Question 1), add a second `webServer` entry (Bun script under `e2e/`) bound to `PLAYWRIGHT_SERVER_PORT` and route only `**/global/event` to it.

6. **Docs touch** — edit the E2E section of `packages/app/README.md`
   - Why: README currently implies a real backend at 4096 is required; after this change, document that `test:e2e` uses mocked API routes and does **not** require `opencode serve`. Drop/fix the stale `--grep "settings"` example (no settings spec); point examples at `critical-path`.

7. **Verification** (run from package dirs; never root `bun test`)
   - `bun run --cwd packages/app typecheck` — only covers `src` (unchanged).
   - **`bunx tsgo -p packages/app/e2e/tsconfig.json`** — must exit 0 (e2e is otherwise never typechecked; CI won’t catch type errors in the spec either).
   - `bun run lint` from repo root; grep output for `: error ` and unexpected new `no-unused-vars` on new files.
   - `bunx playwright install chromium` (once, if not cached).
   - `bun run --cwd packages/app test:e2e:local` — full Playwright run; must exit 0 with `critical-path` passing (not skipped/fixme).
   - **Negative regression check (proves AC 2):** `E2E_FAIL_PROMPT_ASYNC=1 bun run --cwd packages/app test:e2e:local` → spec must **fail**. Under the flag the mock returns **500** on `prompt_async` **and must not resolve `promptSent` / must not deliver the prompted SSE frame** — otherwise the mocked `session.next.prompted` would still fire and Step D could pass (on the failure path the optimistic row is added then removed within one route round-trip at `sendFollowupDraft.ts:110` → `:131-135`, so a server row could still appear). With no prompted frame, Step D times out deterministically. Step C's transient optimistic-row race under the flag is acceptable because overall failure is then guaranteed. Keep the flag in `mock-api.ts` for reuse; run once locally, not in CI.
   - `bun run --cwd packages/app test:unit` — still green (no `src/` changes expected).
   - If `tsgo` reports stale-cache ghosts after any SDK touch: delete `packages/app/node_modules/.ts-dist/*.tsbuildinfo` and re-run.

## Architecture Decisions

| Decision | Choice | Rationale | Alternatives |
| --- | --- | --- | --- |
| Transport | Playwright `page.route` mocks (REST + SSE) | No backend harness or credentials exist; harness already only starts Vite; deterministic; fails on **client-path** regressions (boot wiring, optimistic resolve, projection) | Real `opencode serve` as 2nd webServer — needs provider auth + LLM + fixtures, flaky on 2-OS matrix (rejected); hybrid REST-mock + real server — complexity without AC benefit |
| Scope | Documented subset covering full **client** critical path incl. optimistic→server resolve | Matches AC (1a) attempt with AC (1b) documented limits; stronger than boot-only; unit suite already covers reducers in isolation | Boot-only smoke (weaker, kept as fallback); full backend (rejected) |
| Deferral | **Not chosen** — keep CI e2e job | Job infra exists; mocked smoke is cheap; removing it is last resort | AC (3) remove/disable — only if even boot-level assertions cannot run (Open Question 4) |
| Selectors | Roles, placeholders, `data-slot` / `data-message-id` — **no new `data-testid` unless a selector is otherwise impossible** | Zero existing testid convention in `packages/app/src`; issue doesn’t require production attribute changes | Adding `data-testid` — acceptable narrow fallback for the submit control if role/placeholder is ambiguous |
| File layout | New `critical-path.spec.ts` + `mock-api.ts`; delete `todo.spec.ts` | Separates fixtures from narrative; replace not append | Overwrite `todo.spec.ts` in place — muddies review diff |
| Session navigation | Direct `page.goto` to encoded session URL | Avoids palette/recent-project flake and extra mock surface | Home → click recent project — more “user-like”, can add later |
| CI workflow | Unchanged | AC (2) satisfied once fixme removed; job already wired | Delete job (AC 3) — not chosen |

## Concrete file changes

| Path | Action |
| --- | --- |
| `packages/app/e2e/mock-api.ts` | **Create** — typed fixtures (full SDK shapes), route install, SSE script, `lastPrompt` / `serverMessageId` / `promptSent` handles, `E2E_FAIL_PROMPT_ASYNC` flag, SSE fallback note |
| `packages/app/e2e/critical-path.spec.ts` | **Create** — one `test` (boot → open → send → optimistic → resolve) + header limitation comment |
| `packages/app/e2e/todo.spec.ts` | **Delete** |
| `packages/app/README.md` | **Edit** — E2E section: mocked API, no `opencode serve` required; fix stale `--grep "settings"` example |
| `packages/app/playwright.config.ts` | **No change** unless SSE fallback needs a 2nd `webServer` |
| `.github/workflows/test.yml` | **No change** (job stays; now meaningful) |
| `packages/app/src/**` | **No production code changes** |

## AC → step mapping

| AC | How satisfied |
| --- | --- |
| (1a) Real spec: boot → open session → send → optimistic resolves to server message | Steps 1–2 (mocked transport, real browser + real client reducers) |
| (1b) OR documented subset + limitation in spec file | Header comment in `critical-path.spec.ts`; fallback ladder if a step is harness-blocked |
| (2) CI runs spec and fails on regression (not fixme/skip) | Step 3 removes fixme; step 4 keeps job; step 7 negative check (`E2E_FAIL_PROMPT_ASYNC=1` must fail) |
| (3) Deferral (remove/disable CI job) | **Not taken** — documented as rejected alternative |

## Open Questions

1. **SSE via `page.route.fulfill`** — may not hold a long-lived stream well; client aborts after 15s without events (`HEARTBEAT_TIMEOUT_MS`, `global-sdk.tsx:107-115`) and reconnects every 250ms. Mitigation: two-phase route (hold until `promptAsync` observed, then fulfill scripted frames; follow-up requests get no-op `sync` frames). Fallback: tiny local SSE server as second `webServer` (Step 5). **Resolve during implementation before widening scope.**
2. **Exact SSE line schema** — must match `GlobalEvent { directory, payload }` and `EventSessionNextPrompted` byte-for-byte. Checklist: (a) payload `id` present — missing → `data-message-id=""` → silent no-resolve (spec timeout); (b) **`properties.prompt` is an object with `.text` (`Prompt = { text, ... }`), not an array of parts** — reducer reads `props.prompt.text` (`event-reducer.ts:370,381`), so a wrong shape makes `resolveOptimistic` never match → Step D times out; (c) captured text from `prompt_async` body `parts[].text` must equal the `prompt.text` fed to the frame (text-matched resolve). Re-read `global-sdk.tsx` event loop + `event-reducer.ts handlePrompted` once more while writing the mock; lock with the Step D id assertion.
3. **Bootstrap call set** — first local run will reveal extra endpoints (todo, diff, skills, …). Strategy: explicit fixtures for config/provider/path/project/agent/session/prompt/event; **unknown GET → 200 `{}` / `[]` catch-all** behind `page.route` so the app doesn’t toast-stall. Revisit after first green run.
4. **If even boot assertions cannot run** (unexpected platform blocker) → fall back to AC (3): remove/disable the e2e job in `test.yml` with a comment that the unit suite (~539 tests) remains the automated safety net. **Do not remove the job in the first iteration.**
5. **Windows CI matrix** — POSIX fake directory in fixtures keeps the base64 URL segment stable across both OSes; verify once on the windows runner artifact.
6. **Stale `tsgo` buildinfo** — if local typecheck disagrees with CI, delete `packages/app/node_modules/.ts-dist/*.tsbuildinfo` and re-run (known masking issue).

## Out of Scope

- Real `opencode serve`, LLM calls, provider OAuth, SQLite/projector integration.
- Permission dock, settings, multi-server, reconnect specs (issue lists them as uncovered; one critical path only — future issues).
- Changing `submit.ts`, `sync.tsx`, `event-reducer.ts`, or any production app logic.
- Removing/gating the CI e2e job (AC 3) — rejected for first iteration.
- Regenerating the JS SDK (no server schema changes).
- Adding `data-testid` across the app (only if a single control is unselectable).
- Typechecking `e2e/` in CI (nice-to-have; local `tsgo -p e2e/tsconfig.json` in Step 7 is enough for this issue).

## Local verification command block (copy-paste)

```powershell
# from repo root
bun run --cwd packages/app typecheck
bunx tsgo -p packages/app/e2e/tsconfig.json
bun run lint
bunx playwright install chromium
bun run --cwd packages/app test:e2e:local
# negative: must FAIL (prompt_async 500) — proves AC (2)
$env:E2E_FAIL_PROMPT_ASYNC = "1"; bun run --cwd packages/app test:e2e:local; $env:E2E_FAIL_PROMPT_ASYNC = $null
bun run --cwd packages/app test:unit
```
