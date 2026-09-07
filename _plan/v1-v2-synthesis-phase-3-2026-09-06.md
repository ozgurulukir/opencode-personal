# V1/V2 Synthesis — Phase 3 (HTTP API Unification) — 2026-09-06

## Goal

Port the V1 HTTP session surface (`/session/*`) to the V2 API (`/api/session/*`) so the
public contract becomes single. After Phase 1 (brands) and Phase 2 (events), the HTTP
layer is the widest remaining duality.

## Current state (verified 2026-09-06)

| Fact | Anchor |
|---|---|
| V1 group: **28 endpoints** on `/session/*` (plan previously said 22 — corrected) | `groups/session.ts:108-448` |
| V2 group: 6 endpoints on `/api/session/*` — sessions(list), prompt, compact, wait, context, messages | `groups/v2/session.ts`, `groups/v2/message.ts` |
| V2 handlers yield `SessionV2.Service` once, close over it | `handlers/v2/session.ts:66-141` |
| SDK exposes `client.v2.session` (Session3, 6 methods) | `sdk.gen.ts:4537` (class V2), `:4355-4530` (URLs) |
| Consumer call counts (app + TUI, V1 SDK methods): revert ×6, abort ×6, fork ×5, update ×4, unrevert/messages/list/get/command ×3, todo/summarize/diff ×2, unshare/status/shell/share/promptAsync/prompt/predict/delete/create ×1 | grep, 2026-09-06 |
| `SessionTable` columns cover: slug, directory, version, share_url, summary_additions/deletions/files | `session/session.sql.ts:19-46` |
| V2 `Info` is a PARTIAL projection — slug/directory/version/summary/share commented out; `revert` not in table | `v2/session.ts:54-65` |
| V1 `create` is a raw handler (manual body parse → `Session.CreateInput`) | `handlers/session.ts:147-161` |
| V1 `Summary` = `{additions, deletions, files, diffs?}`; `Share` = `{url}`; abort success = `Schema.Boolean` | `session/session.ts:141-150`, `groups/session.ts:250-254` |

## Design decisions

1. **V2 `Info` becomes the full session contract.** Complete the commented-out fields
   (`slug`, `directory`, `version`, `summary`, `share`) and wire them in BOTH `fromRow()`
   and `toV2Info()`. `revert` stays omitted (transient revert state, not a table column —
   revisit in batch 3c with revert/unrevert). `summary.diffs` omitted from the row
   projection (lives in session_diff storage; V1 assembles it separately).
2. **Response-shape policy:** action endpoints keep V1 shapes (`true` / `Schema.Boolean`)
   so consumer migration is a URL-only change. Entity endpoints use V2 shapes
   (`SessionV2.Info`, `SessionMessage.Message`). Domain payloads with no V2 counterpart
   (todo, diff, status map) reuse the existing V1 schemas as-is — schema reuse is fine;
   the goal is ROUTE unification.
3. **Delegation:** new `V2Session.Service` methods delegate to V1 services (bridge pattern
   unchanged — V1 stays the writer). Domain ops with no session-loop semantics (todo,
   diff, share) may be handled by yielding the V1 service directly in the V2 handler.
4. **Errors:** entity endpoints declare `SessionV2.NotFoundError` (already a
   `Schema.TaggedErrorClass`); action endpoints keep `HttpApiError.BadRequest/NotFound`
   parity with V1.
5. **SDK regen after each batch** (`cd packages/sdk/js && bun script/build.ts`), then
   `bun typecheck` in `packages/opencode` AND `packages/app` (delete stale tsbuildinfo).
   Consumer call-site switches happen per-endpoint AFTER the regen lands.

## Batches

### 3a — Info completion + session lifecycle (DONE 2026-09-06)

> **Status: DONE.** V2 `Info` completed (slug/directory/version/summary/share wired in
> `fromRow` + `toV2Info`; `revert`/`summary.diffs` intentionally omitted, documented in
> schema comment). New service methods: `children`, `remove`, `update` (permission-merge
> ported INTO the service — SSOT), `abort`. `SessionV2.NotFoundError` annotated
> `httpApiStatus: 404`. 6 endpoints added to `v2.session` group + handlers.
> **Bonus fix:** both v2 groups were missing `InstanceContextMiddleware` +
> `WorkspaceRoutingMiddleware` (V1 has them) — instance-scoped endpoints (`wait`, `abort`,
> `status`) would 500 with "No context found for instance". Added to `v2.session` AND
> `v2.message`. SDK regenerated (6 new methods on `client.v2.session`).
> Verified: typecheck opencode+app clean; httpapi-session 11/11 (new v2 lifecycle test);
> v2 service tests 31/31; server dir 237 pass / 2 fails both confirmed pre-existing
> (present in Phase 2 baseline). Not committed.

- Complete `SessionV2.Info`: add `slug`, `directory`, `version`, `summary`, `share`;
  wire `fromRow()` + `toV2Info()`.
- New `V2Session.Service` methods: `children`, `remove`, `update`, `abort`
  (`get`/`create` already exist).
- New endpoints on `v2.session` group:
  - `GET  /api/session/:sessionID` → `SessionV2.Info` (error: NotFoundError)
  - `DELETE /api/session/:sessionID` → `true`
  - `PATCH /api/session/:sessionID` → `SessionV2.Info` (payload: title?/permission?/time.archived?)
  - `GET  /api/session/:sessionID/children` → `SessionV2.Info[]`
  - `POST /api/session/:sessionID/abort` → `true`
  - `GET  /api/session/status` → status map (reuse V1 `StatusMap` schema)
- `update` keeps the V1 permission-merge semantics (`Permission.merge(current, payload)`).

### 3b — create + fork + share + summarize + init ✅ (2026-09-07)
- `POST /api/session` (create — typed payload `[HttpApiSchema.NoContent, Session.CreateInput]`;
  handler normalizes the NoContent arm's `void` to `undefined`; goes through
  `SessionShare.Service.create` for V1 auto-share parity, then projects via V2 `get`)
- `POST /api/session/:sessionID/fork` → `SessionV2.Info` (service method; reuses V1 `ForkPayload`)
- `POST/DELETE /api/session/:sessionID/share` → `SessionV2.Info` (handler-level via
  `SessionShare.Service`; unknown errors → `HttpApiError.InternalServerError`; reuses V1
  `InitPayload`/`SummarizePayload` schemas from the V1 group file — SSOT)
- `POST /api/session/:sessionID/summarize` → `true` (service method; captures
  `SessionRevert.Service` via `serviceOption`; mirrors V1 handler orchestration:
  revert cleanup → last-user-agent pick → compaction → loop)
- `POST /api/session/:sessionID/init` → `true` (service method; `promptV1.command` with
  `Command.Default.INIT`; no typed error channel — V1's `mapError(BadRequest)` was dead code)
- Not covered by integration tests: share/unshare happy path (needs real share API),
  summarize/init happy path (needs LLM). Covered: create empty+payload, fork, share→500
  (disabled config), fork/summarize→404 on missing session.

### 3c — domain ops
- `GET /api/session/:sessionID/todo`, `GET /api/session/:sessionID/diff`
- `POST /api/session/:sessionID/revert`, `/unrevert` (decide `revert` field on Info here)
- `POST /api/session/:sessionID/command`, `/shell` (service method exists, HTTP missing),
  `/predict`

### 3d — message/part CRUD + permissions
- `GET /api/session/:sessionID/message/:messageID`, `DELETE` message/part,
  `PATCH part`, `POST /api/session/:sessionID/permission/:permissionID`
- `POST /api/session/:sessionID/prompt_async` (or fold into `prompt` delivery="deferred" —
  decide; the V2 `prompt` already supports deferred delivery, so promptAsync may be
  DELETED instead of ported)

### 3e — consumer migration + V1 shutdown prep
- Switch TUI/app call sites from `client.session.*` to `client.v2.session.*` per endpoint
  (traffic order: abort, revert, fork, update, unrevert, command, todo, summarize, diff…)
- TUI `sync.tsx` → `sync-v2.tsx` migration is the long pole (21 `useSync()` files) —
  likely its own phase (4) before V1 route deletion (5).

## Verification (per batch)

```bash
cd packages/sdk/js && bun script/build.ts     # SDK regen
rm -rf packages/app/node_modules/.ts-dist packages/sdk/js/tsconfig.tsbuildinfo
bun run --cwd packages/opencode typecheck && bun run --cwd packages/app typecheck
cd packages/opencode && bun test test/v2/     # + new handler tests
```

## Risks

| Risk | Mitigation |
|---|---|
| V2 Info shape change (new fields) breaks SDK consumers | Additive fields only; SDK gen is structural; app typecheck catches drift |
| `update` permission-merge semantics drift between V1/V2 handlers | Port the merge INTO the V2 service method — one implementation (SSOT) |
| Widening V2 surface before consumers switch = temporary duplication | Accepted (strangler fig); batches are small and consumer switches follow immediately |
| `status` map shape is instance-wide (no sessionID) — routing/query differences | Reuse V1 `StatusMap` schema verbatim; mount under `/api/session/status` |

## Out of scope

- TUI `useSync()` → `useSyncV2()` migration (21 files) — Phase 4
- V1 route group deletion — Phase 5
- `promptAsync` deletion decision — batch 3d
