# V1/V2 Synthesis — Phase 4: TUI sync unification + remaining read migrations

Date: 2026-09-07

**Status:** ✅ EXECUTED (reviewed 2026-09-22) — landed in `9d9fe54` (event bridge, unified TUI sync, v2 read/prompt migration; the bridge itself was later deleted in `39313b8` per Phase 5). Matches the COMPLETE header below.
Status: COMPLETE — 4a done, 4b done, 4c done, 4d done; post-implementation audit recorded 2026-09-08.

> This document preserves the Phase 4 historical plan and batch snapshots. Phase 5 supersedes the temporary event-bridge and ACP decisions noted below.
Depends on: Phase 3 (complete — commits `cb7fbd990`..`d6330086f`, build verified)

## Batch status (updated 2026-09-07)

- **4a — DONE (historical bridge implementation; superseded by Phase 5e-2).** Event bridge (`src/v2/event-bridge.ts`) translated all 7 lifecycle
  events; wired into `project/bootstrap.ts`. Two bridge bugs found and fixed by the new
  test: (1) the 7 bridged events had no projectors, so `SyncEvent.run` threw
  "Projector not found" — no-op projectors added in `session/projectors-next.ts`;
  (2) the bridge subscribed via a lazily-scheduled stream fiber and ran translations
  without instance context — replaced with a synchronous `subscribeAllCallback`
  subscription (PubSub buffers), captured instance context re-provided per translation,
  and a serialized promise queue for ordering. V2 `shell` service + endpoint now accept
  `agent`/`model`/`messageID` (payload reuses V1 `ShellPayload`). SDK regenerated.
  Bridge test: `test/server/httpapi-session.test.ts` "bridges V1 session lifecycle
  events to the V2 event stream" (all 7 events, payload-mapping assertions).
- **4b — DONE.** All 12 HTTP client `get`/`list`/`create`/`shell` sites migrated to
  `client.v2.session.*` (census: 5 get, 3 list, 3 create, 1 shell across
  `packages/opencode/src/cli` + `packages/app/src/context`). `list` sites unwrap
  `.data.items`; `run.ts --continue` and the app session fetch pass explicit
  `limit: 100` because the v2 route defaults to 50 while the V1 service default was
  100. Test fixture `sync-undefined-messages.test.tsx` grew the `/api/session/:id`
  route (3e lesson: mocks must follow the migrated paths).
- **4c — DONE (2026-09-07).** Unified sync context shipped as a file swap, not an adapter:
  - `sync.tsx` is now the ONE context (`useSync` + `useSyncV2` alias export). `sync-v2.tsx`
    deleted; `app.tsx` mounts a single `<SyncProvider>`; `session-v2.tsx` imports the alias.
  - Session-metadata slices (`session`, `session_status`, `session_diff`, `todo`,
    `permission`) switched from V1 events to bridge vocabulary (`session.next.updated/
    deleted/status/todo/diff/permission.asked/permission.replied`). V1 handlers removed.
  - `messages` slice (V2 `SessionMessage[]` per session) + all `session.next.*`
    message-stream handlers moved from sync-v2 verbatim, with `eventTime()` normalizing
    timestamps (ISO string over SSE / millis / DateTime object → millis).
  - Non-session slices (`question`, `message`/`part` V1 slices, `lsp`, `vcs`,
    `server.instance.disposed`) unchanged, still V1-event-fed.
  - `listSessions()` → `v2.session.list` (items unwrap, id sort); `session.message.sync`
    → `v2.session.messages`; `session.sync()`'s `messages` call stays V1 (feeds V1 slices).
  - Zero consumer edits (same import path + hook name).
  - Bridge payloads are typed `unknown` in the SDK (bridge passes V1 shapes) — handlers
    cast to `PermissionRequest`/`Todo[]`/`Session`/`SessionStatus`/`Snapshot.FileDiff[]`.
  - v2 list `start` filter fixed to `time_updated` (V1 parity — the TUI 30-day window is
    last-updated based; `time_created` would hide long-lived active sessions).
  - 4b leftovers migrated: `copilot.ts` get, `run.ts` get, app `notification.tsx` get,
    app `layout.tsx` get + 3 lists (explicit `limit: 100` per app convention).
  - Fixture `sync-fixture.tsx` handles v2 paths (`/api/session`, `/api/session/status`,
    `/api/session/{id}` + todo/diff/messages); records both `/session` and `/api/session`.
  - Known wire-format inconsistency (phase 5): `sync.run` publishes raw DateTime values,
    so V2 event `timestamp` arrives as an ISO string over SSE while the schema declares
    millis (`V2Schema.DateTimeUtcFromMillis`). Normalized consumer-side via `eventTime()`;
    root fix is encoding at publish in `SyncEvent.process()`.
  - Post-Phase-5 note: the `session.next.*` vocabulary remains, but lifecycle producers
    now emit it natively; it no longer depends on the bridge described by this snapshot.
- **4d — DONE (2026-09-07; ACP decision superseded by Phase 5d).** Executed per the census + decisions above:
  - V2 sync `prompt` payload extended with `agent?`/`model?`/`variant?`/`messageID?`
    (D1); V2 service prompt input takes the V1 model shape + `variant`/`messageID`
    straight through. `toPromptModel` kept (still used by `summarize` + subagent's
    inner prompt); `v2/AGENTS.md` model-reshape notes updated.
  - Migrations: `run.ts` → v2 sync `prompt` (D3, files → `FileAttachment` reshape);
    TUI `prompt/index.tsx` → v2 `promptAsync` (D2, zero reshape, dropped the redundant
    `...selectedModel` top-level spread); acp `summarize` + `abort` → v2.
  - **4b regression fixed (found by the full server suite):** v2 endpoints declared
    `SessionV2.NotFoundError` whose wire body (`{_tag, sessionID}`) carries no
    `message`, so the SDK's `wrapClientError` fell back to "GET … → 404" and
    `validate-session` (migrated to `v2.session.get` in 4b) printed the raw HTTP line
    instead of "Session not found: ses_…". All 11 v2 endpoints now declare
    `ApiNotFoundError` and handlers map via a `withNotFound` helper
    (`handlers/v2/session.ts`) producing the V1 body (`data.message`). `httpapi-sdk`
    went from 2 fail → 16/16 pass (this also fixed "matches generated SDK instance
    event stream").
  - Verification: typecheck both packages clean (stale tsbuildinfo cleared); tests —
    `test/v2/` 32/32, `httpapi-session` 12/12, `httpapi-sdk` 16/16, `cli/cmd/run` +
    `cli/cmd/tui` 336/336, app `test:unit` 469/469. Full `test/server/` run retains
    only the documented pre-existing pair (`provider HttpApi > serves OAuth authorize
    response shapes`, `v2 SDK error shape > 404 with responseStyle data…`) plus
    provider parallel-load 5s-timeout flakes (AGENTS.md Known Issues class).
  - At the time of Phase 4, acp `prompt` + `command` remained on V1 (D4). Phase 5d
    subsequently migrated both to V2 and pairs the response with the final assistant
    message for usage reporting.

#### 4d census (historical snapshot, verified 2026-09-07; later superseded by Phase 5)

Remaining V1 session-domain HTTP client calls (grep `client.session.|sdk.session.` minus
`v2.`, excluding server-internal + Effect-service callers):

| # | Site | Call | Response read? | Decision |
|---|---|---|---|---|
| 1 | `cli/cmd/run.ts:643` | `session.prompt` (sync) | none | → v2 sync `prompt` |
| 2 | `acp/agent.ts:908` | `session.prompt` (sync) | `.data?.info` → `buildUsage(msg)` needs final **assistant** msg tokens | **STAYS V1** (see D4) |
| 3 | `tui/component/prompt/index.tsx:1295` | `session.prompt` (fire-and-forget `.catch`) | none | → v2 `promptAsync` |
| 4 | `acp/agent.ts:934` | `session.command` | `.data?.info` usage | **STAYS V1** (v2 command returns NoContent) |
| 5 | `acp/agent.ts:955` | `session.summarize` | none | → v2 `summarize` |
| 6 | `acp/agent.ts:977` | `session.abort` | none | → v2 `abort` |
| 7 | `run/stream.transport.ts:562` | `session.messages` | feeds `bootstrapSubagentCalls` (V1 WithParts) | **STAYS V1** (Phase 5 model adoption) |
| 8 | `run/session.shared.ts:156` | `session.messages` | `createSession(WithParts[])` | **STAYS V1** |
| 9 | `tui/context/sync.tsx:790` | `session.messages` | feeds V1 `message`/`part` slices | **STAYS V1** (4c decision) |
| 10 | `app/context/sync.tsx:301` | `session.messages` | feeds V1 slices | **STAYS V1** |
| 11 | `app/pages/layout.tsx:745` | `session.messages` | prefetch reads `x-next-cursor` header + `.info` | **STAYS V1** (v2 cursor is body-based) |

Internal Effect-service callers (`tool/task.ts`, `cli/cmd/github.ts`,
`session/loop/command.ts`) use V1 `SessionPrompt.prompt` directly — not HTTP migration
targets. Already-v2 prompt sites: `dialog-workspace-create.tsx`, `stream.transport.ts:1015`,
app `sendFollowupDraft.ts`.

#### 4d decisions (ADR-style)

- **D1 — extend the V2 sync prompt payload** with `agent?`/`model?`
  (`{providerID, modelID}`)/`variant?`/`messageID?`. All real sync callers pass
  agent+model+variant; "set on session first" was rejected (3 extra round-trips per
  prompt + switch races). The V2 service prompt input changes `model` from
  `Modelv2.Ref` to the V1 shape (consistent with `shell`) and gains
  `variant?`/`messageID?` — straight pass-through to V1, `toPromptModel` removed
  (prompt was its only caller). `promptAsync` already reuses the full V1
  `PromptPayload` — untouched.
- **D2 — TUI prompt → `promptAsync`**: same V1 payload shape (zero reshape);
  forked loop means a TUI disconnect no longer aborts the run; errors surface as
  `SessionEvent.Error` events instead of being swallowed by `.catch(() => {})`.
- **D3 — run.ts → v2 sync `prompt`**: blocking semantics preserved
  (`DefaultDelivery = "immediate"` runs the V1 loop synchronously); response ignored.
  Parts reshape: V1 `FilePart {url, filename, mime}` → V2 `FileAttachment {uri, mime, name}`.
- **D4 — acp prompt + command stay V1**: ACP must return usage synchronously and reads
  the final assistant message (`msg.tokens`) from the prompt/command response. The V2
  sync prompt returns the projected **User** message (no tokens); v2 command returns
  NoContent. Phase 5 item: extend the V2 sync prompt response (final assistant message)
  or restructure ACP usage reporting via `sendUsageUpdate` data.
- **D5 — messages sites stay V1**: all 5 feed V1 `MessageV2.WithParts` consumers
  (RunSession reducers, V1 sync slices, header-based prefetch pagination). Migration
  requires the V2 message model adoption (Phase 5 engine work — V2 `SessionMessage`
  cannot express step-start/snapshot/subtask parts yet).

#### 4d steps

1. Server: extend v2 sync prompt payload + service input; remove `toPromptModel`;
   fix stale `v2/AGENTS.md` references.
2. SDK regen (`packages/sdk/js/script/build.ts`).
3. Migrate run.ts (D3) + TUI prompt (D2) + acp summarize/abort.
4. Typecheck both packages; tests: `test/v2/ test/server/ test/cli/cmd/run/
   test/cli/cmd/tui/` + app `test:unit`.
5. Update this file's batch status.

## Post-implementation audit (2026-09-08)

- Phase 4 is complete. Its bridge-based 4a implementation was intentionally replaced by native lifecycle emission in 5e-2; `v2/event-bridge.ts` and its bootstrap wiring are deleted.
- The 4d ACP “stay V1” decision was intentionally reversed in 5d. The historical census is retained for traceability, not as the current consumer census.
- The 4c V1-shaped app/TUI compatibility slices were later completed through the Phase 5 app adapter batch; the V2 event vocabulary remains the source stream.
- The wire-format compatibility normalizer remains necessary for legacy/replay paths even after publish-time timestamp encoding; removing `eventTime()` is therefore not an unverified cleanup.

## Goal

Make the TUI/app consume ONLY the V2 surface for session-domain data, so Phase 5 can
delete V1 HTTP routes, V1 bus events, and (after engine re-homing) V1 service files.

## Current state (post Phase 3)

- V2 HTTP surface complete: 31 session endpoints + `GET /api/session/:sessionID/message`
  (messages, in the `v2.message` group).
- Consumer calls: 63 action sites migrated to `client.v2.session.*` (batch 3e). Still on V1:
  `prompt` (~55 sites), `messages` (5), `shell` (1), `get`/`list`/`create` (~27).
- TUI sync: `context/sync.tsx` (536 lines) is a mega-store fed by 19 V1 event types with
  ~20 data slices and 22 `useSync()` consumer files. `context/sync-v2.tsx` (307 lines) holds
  only `messages: {sessionID: SessionMessage[]}` fed by the 26 `session.next.*` V2 events,
  with 1 consumer (`feature-plugins/system/session-v2.tsx`).
- Both event vocabularies flow over the SAME SSE stream (`useEvent()` filters by
  directory/workspace) — new V2 events reach the TUI without transport changes.

## Gap analysis

### 1. V2 events missing (block sync migration)

| V1 event | V2 equivalent needed for |
|---|---|
| `session.updated` | session metadata slice (title/time/revert/share/permission/model/agent) |
| `session.deleted` | session removal from store |
| `session.status` | `session_status` slice (busy/idle/retry) |
| `todo.updated` | `todo` slice |
| `session.diff` | `session_diff` slice |
| `permission.asked` / `permission.replied` | `permission` slice |

NOT in scope (non-session domains, no V1/V2 duality): `question.*`, `lsp.updated`,
`vcs.branch.updated`, `server.instance.disposed` — these stay on the V1 event vocabulary
indefinitely (they are shared infrastructure, not duplicated session logic).

### 2. Message model reshape (block sync + messages migration)

V1 `MessageV2.WithParts` (info + `parts[]`) → V2 `SessionMessage` (typed `content[]`
items). 18 consumers read `sync.data.part[messageID]`, 13 read `sync.data.message`.

### 3. Endpoint/payload gaps (block read migrations)

- `prompt`: V1 `{parts, agent?, model?, variant?, messageID?, noReply?, tools?, format?, system?}`
  → V2 `{prompt: {text, files?, agents?}, delivery?}`. Fields with NO V2 home:
  `model`/`variant`/`agent` (V2 switches via `switchAgent`/`ModelSwitched`), `noReply`
  (≈ `delivery: "deferred"`), `tools`/`format`/`system` (deprecated or dropped).
- `shell`: V2 service accepts `{command}` only; V1 callers pass `agent` (required in V1).
- `list`: V2 response is `{items, cursor}` vs V1 bare array.
- `get`/`create`: structurally compatible — mechanical path swap.

## Batches

### 4a — Server prerequisites (events bridge + shell parity)

- **V1→V2 event bridge** (one module, e.g. `src/v2/event-bridge.ts`): subscribe to the V1
  bus and re-emit the 7 missing event types as V2 `EventV2` definitions
  (`session.next.updated`, `session.next.deleted`, `session.next.status`, `session.next.todo`,
  `session.next.diff`, `session.next.permission.asked`, `session.next.permission.replied`).
  Strangler style: zero edits inside V1 services; the bridge is the ONLY translation point.
  Payload schemas reuse V1 event properties (typed via `EventV2.define`).
- **V2 `shell` service + endpoint**: accept `agent?`/`model?` (V1 `ShellInput` parity);
  keep deriving agent from the session when omitted.
- Emit points to verify in the bridge: `session.update` (title/permission/archive),
  `revert`/`unrevert` (revert field), `share`/`unshare`, `SessionStatus.set`, todo writes,
  `Session.Event.Diff`, permission ask/reply, session remove.
- SDK regen + `httpapi-session` test extensions for the new events' side effects.

### 4b — Mechanical read migrations (get / list / create / shell)

- `get`/`create` (~27 sites): path swap only (responses structurally compatible).
- `list` (~22 sites): path swap + `.data` → `.data.items` reshape; audit each site for
  cursor usage (V2 pagination is cursor-based; V1 used `start`/limit headers).
- `shell` (1 site): after 4a, pass `agent` through.
- ast-grep sweep like 3e, with the receiver-type guarantee from typecheck.

### 4c — TUI sync unification (the long pole)

- Extend `sync-v2.tsx` with slices: `session`, `message`, `part`, `todo`, `session_diff`,
  `session_status`, `permission` — fed by the 4a bridge events + existing `session.next.*`
  message-stream events.
- **Adapter-first**: expose V1-shaped derived views (`data.part[messageID]` maps built from
  V2 `SessionMessage.content`) so the 21 consumers migrate with minimal edits; per-file
  adoption of the native V2 model follows as cleanup, not as a blocker.
- Migrate the 22 `useSync()` files to `useSyncV2()`; keep `question.*`/`lsp`/`vcs`/
  instance slices accessible (they stay V1-event-fed — either keep a slim `useSync` for
  them or move those slices into sync-v2 fed by the same V1 events; decide at
  implementation, prefer moving them into sync-v2 so there is ONE context).
- Migrate the 5 `messages` call sites (response model reshape, same batch as the model
  adoption in their files).
- Delete `sync.tsx` at the end of 4c (or reduce it to the non-session slices if kept).

### 4d — prompt migration (~55 sites)

- Field-mapping decisions first (one ADR-style note in this file):
  - `agent`/`model`/`variant` at prompt time → set on the session first
    (`switchAgent`/model switch) or extend the V2 prompt payload — decide by census of
    what the 55 sites actually pass.
  - `noReply: true` → `delivery: "deferred"` (verify the deferred worker wiring first;
    if unwired, keep promptAsync for those sites).
  - `tools`/`format`/`system` → likely dropped (deprecated in V1) — confirm no caller
    passes them.
- Then mechanical per-site reshape: `parts[]` → `{text, files, agents}` extraction
  (text parts join, file parts → `files`, agent parts → `agents`).
- Response change: `WithParts` → `Message` — audit sites that read the response.

## Verification (per batch)

```bash
cd packages/sdk/js && bun script/build.ts     # when endpoints/events change
rm -rf packages/app/node_modules/.ts-dist packages/sdk/js/tsconfig.tsbuildinfo
bun run --cwd packages/opencode typecheck && bun run --cwd packages/app typecheck
cd packages/opencode && bun test test/v2/ test/server/ test/cli/cmd/run/ test/cli/cmd/tui/
cd packages/app && bun run test:unit
# full build (user-run) at batch boundaries
```

Typecheck passing is the receiver-type guarantee for ast-grep sweeps (3e lesson).
Test mocks that stub `client.session.*` must grow `v2.session` branches (3e lesson).

## Risks

| Risk | Mitigation |
|---|---|
| Event bridge drift (V1 payload changes not mirrored) | Bridge is the single translation point with typed schemas; SDK regen catches shape drift |
| V2 message model reshape breaks part-reading consumers | Adapter-first derived views; per-file native adoption as follow-up cleanup |
| `prompt` field mapping is lossy (`tools`/`format`/`system`) | Census before mapping; extend V2 payload only if a real caller needs it |
| `list` cursor semantics differ from V1 `start` pagination | Audit each of the ~22 sites; V1 `start` → V2 cursor translation where needed |
| `noReply` → `delivery: "deferred"` needs the deferred worker | Verify `runDeferred` wiring before switching those sites; keep promptAsync otherwise |
| sync migration destabilizes the TUI | Batch per file group (dialogs → routes → context), build + manual TUI smoke between groups |

## Out of scope (Phase 5 preview)

- Engine re-homing: `session/loop/*` + `processor.ts` + `compaction.ts` behind `V2Session`
  (original Phase 4 item — deletion-enabling cleanup, fits Phase 5).
- V1 route/event/service deletion, legacy JSON `Storage.Service` removal, backfill tooling.
- `packages/web` SDK docs (10 locale mdx files) — documentation task.
