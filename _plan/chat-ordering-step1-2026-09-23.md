# Plan: Step 1 — Single authoritative message-ordering key (`id`), V1 AND V2

**Date:** 2026-09-23
**Status:** ✅ APPROVED (2026-09-23, gate: @review)
**Provenance:** Focused execution plan extracted from `_plan/chat-ordering-2026-08-14.md` (🟡 PARTIAL, rev 2026-09-23). That plan remains the research record; its "Step 1 unimplemented — current verified anchors (2026-09-23)" block and the "Rev 2026-09-23 — Step 1 premise refresh" note are the source of truth this plan builds on. A one-line pointer to this file was added to the old plan.

**Repo state at planning time:** branch `main`, HEAD `2c19ce5ded5d41f774c455215a47a8a0576f0fd6`, clean tree. All anchors below were re-read from the tree at this HEAD (the old plan's body anchors are pre-synthesis and stale — do not use them).

---

## Goal

Make message ordering derive from a single authoritative key — the monotonic message `id` — across every V1 and V2 read path, eliminating the `id`-created-time vs `time_created`-insert-time skew divergence class (old plan §2.1/§2.3). `id` encodes creation time (`MessageID.ascending`); `time_created` measures DB insert time. Under concurrency (tools, subagents, compaction) the two disagree, and any consumer assuming one key while the server orders by the other sees intermittent reordering.

## Scope decision

**IN — Step 1 only (provenance plan's Step 1, executed as E1–E5 below): V1 + V2 id-only ordering, cursor updates, handler `time` optional, characterization tests.** This is the single change that removes the divergence class; everything else in the old plan is either obsolete, deferred, or does not reduce risk for this diff.

**OUT — Step 2a (TUI 100-cap hardening): OBSOLETE — the cap no longer exists.** Re-verified against the tree at HEAD `2c19ce5`: `packages/opencode/src/cli/cmd/tui/context/sync.tsx` contains no `length > 100`, no `shift()` on messages, no `limit: 100` on the message load (initial load is `sdk.client.v2.session.messages({ sessionID })` at `sync.tsx:493` and `:511`, no limit param). A grep for the exact cap patterns `length > 100|shift\(\)|limit: 100` across all of `packages/opencode/src/cli/cmd/tui/` returns **zero hits** — there is no message cap anywhere under the TUI tree. The V2 store rewrite removed the ring cap. The step guards a phantom — it must not be resurrected.

**OUT — Step 2b (scrollback pagination): DEFERRED, gated on product decision Q1.** No implementation here. Note for Q1: the cap removal also undermines 2b's original premise (silent truncation of >100-message sessions no longer occurs), so Q1 may resolve to "no action needed" — but that is a product call, not this plan's.

**OUT — Step 4 (V2 in-memory projector id-sort): excluded — not on a production path.** Verified: `memory()` in `packages/opencode/src/v2/session-message-updater.ts:20` has **zero callers in `src/`**; the only importer of the module in production is `session/projectors-next.ts:4`, which uses `SessionMessageUpdater.update` with a SQL-backed adapter, not `memory()`. The raw `push` at `session-message-updater.ts:85-87` (verified current) only affects the test-only memory adapter. Sorting it would churn `test/v2/session-message-updater.test.ts` for no user-visible effect. Revisit only if a production adapter ever feeds out-of-id-order events.

**OUT — Step 3 (V2 `messages()` vs `context()` doc clarification): excluded — no risk reduction for this diff.** The E1 characterization tests already lock the `context()` inclusive-`gte` window contract and the `messages()` full-history behavior; adding JSDoc/OpenAPI prose in the same diff would touch `groups/v2/message.ts` descriptions and needlessly reopen the Q2 SDK-regen question. Doc polish can ride a later pass.

**OUT — Step 5 (`filterCompacted` guard/doc): excluded — unrelated to the ordering key.** `filterCompacted`'s reorder is model-consumption order, independent of the DB tie-break key; its characterization tests (`test/session/messages-pagination.test.ts:662-1165`) already lock it, and no consumer bug was found in this audit.

## Verified anchors (all verified against HEAD `2c19ce5`)

### V1 — `packages/opencode/src/session/message-v2.ts`
- `Cursor` schema, `time` required — `message-v2.ts:153-156` (module-private, not exported)
- `decodeCursor` — `message-v2.ts:159`
- `older()` tuple predicate — `message-v2.ts:185-186`
- `page()` — `message-v2.ts:511-546`: orderBy `desc(time_created), desc(id)` at **:521**, `.reverse()` at **:539**, `cursor.encode({ id, time })` at **:544**
- `stream()` — `message-v2.ts:548-560` (consumes `page()`, no own ordering)
- `messagesForSummary()` orderBy `time_created, id` — `message-v2.ts:628`

### V1 — `packages/opencode/src/session/session.ts`
- `Session.messages` — `session.ts:711-716`: limit path → `MessageV2.page(...).items` at **:713**; no-limit path → `Array.from(MessageV2.stream(...)).reverse()` at **:715**. Both inherit `page()` ordering; both become id-ascending automatically.

### V2 — `packages/opencode/src/v2/session.ts`
- Service `Interface.messages` cursor, `time: number` required — `v2/session.ts:117-121` (`time` at **:119**)
- `list()` (sessions) cursor `:107-111` and orderBy `:470-471` — **untouched by this plan**
- `messages()` boundary `(time_created, id)` tuple — `v2/session.ts:483-498` (`boundary` var at :483; `gt(time_created, ...)` at :486, `lt(time_created, ...)` at :493)
- `messages()` orderBy tuple — `v2/session.ts:509-512`
- `context()` last-compaction lookup `desc(time_created), desc(id)` — `v2/session.ts:521-527` (orderBy at **:525**)
- `context()` filter boundary tuple with inclusive `gte(id)` — `v2/session.ts:536-542` (`gte` at **:540**)
- `context()` result orderBy `asc(time_created), asc(id)` — `v2/session.ts:546`

### Handler — `packages/opencode/src/server/routes/instance/httpapi/handlers/v2/message.ts`
- Wire `Cursor` decode schema, `time: Schema.Finite` required — `message.ts:10-15` (`time` at **:12**)
- Opaque encode including `time` — `message.ts:22`
- Service call passing `time` — `message.ts:47`
- Opaque response cursor `{ previous, next }` strings — `message.ts:53-56`

### Test files (all exist)
- `packages/opencode/test/session/messages-pagination.test.ts`
- `packages/opencode/test/server/session-messages.test.ts`
- `packages/opencode/test/v2/session.test.ts`
- `packages/opencode/test/v2/session-message-updater.test.ts` (not modified — Step 4 excluded)
- `messages-pagination.test.ts:1073-1093` — pre-existing `describe("MessageV2.cursor")` block: `:1079` and `:1086` assert `decoded.time`, `:1090` passes `time: 0` in the encode literal — **edited intentionally in Step E2b** (they lock the removed `time` field)

### V1 handler read path (verified, no change needed)
- `handlers/session.ts:101` — `MessageV2.cursor.decode(before)` on the V1 `messages` route is `Effect.try` validation only; the decoded value is discarded, and old cursors carrying `time` still decode (schema strips unknown keys). No edit required.

---

## Step-by-step execution

> **Rule 3 framing (important):** these are characterization tests for the **NEW intended behavior**. They are written FIRST and are expected to **fail against current code** (proving they exercise the changed path), then pass after the change. The id-only `context()` boundary is intentionally **not bit-for-bit equivalent** to the tuple predicate in the skew case (a row with `time_created > t0` but `id < id0` was previously included via the tuple's first OR branch and is now excluded) — the tests lock the new id-based contract so the difference is intentional, not incidental. Existing tests (notably `filterCompacted` cases and `test/server/session-messages.test.ts`) must stay green throughout — they lock the unchanged behaviors. **One carve-out:** the pre-existing `MessageV2.cursor` tests (`messages-pagination.test.ts:1073-1093`) lock the cursor payload's `time` field, which this plan intentionally removes — they are edited in Step E2b, not preserved.

### Step E1 — Write the characterization tests (FIRST, expect red)

**Files:** `packages/opencode/test/session/messages-pagination.test.ts`, `packages/opencode/test/v2/session.test.ts`

**Fixture note (applies to both tests):** the existing `fill()` helper (`messages-pagination.test.ts:38`) hardcodes `MessageID.ascending()` for ids and parameterizes only `time` — it **cannot** produce the id-vs-time skew. The implementer must write rows directly via `svc.updateMessage` (the pattern already used at `:43`, `:66`, `:94`) with hand-crafted ids: row A gets a lexically *larger* id (newer `MessageID.ascending()` stamp) inserted first with a smaller `time_created`; row B gets a lexically *smaller* id inserted later with a larger `time_created`.

**Test 1 — V1 `page()` id-order under skew** (new block in `messages-pagination.test.ts`, e.g. "page orders by id regardless of time_created skew"):
- Insert rows A and B per the fixture note above (A = newer/larger id, earlier `time_created`; B = older/smaller id, later `time_created`).
- Assert `MessageV2.page({ sessionID, limit: 10 })` returns items in **ascending id order** `[B, A]` (current code returns `[A, B]` via `(time_created, id)`).
- Assert pagination: with `limit: 1`, `more === true`, the returned item is `[A]` (the newest row — `page()` returns the newest N in ascending order), and the returned cursor decodes to `{ id: A.id }` with **no `time` field** (`tail = slice.at(-1)` = A); a second `page()` call with `before: cursor` returns `[B]` — i.e. the id-only `older()` predicate paginates correctly across the skew.
- Back-compat assertion: decoding an **old-format** cursor JSON that still carries `time` (e.g. `cursor.decode(base64url(JSON.stringify({ id: B.id, time: 123 })))`) succeeds with the `time` key stripped — locks the Effect `Schema.Struct` excess-key tolerance that makes in-flight V1 cursors safe across the schema change.

**Test 2 — V2 `messages()`/`context()` id-order + inclusive compaction window** (new block in `test/v2/session.test.ts`):
- Seed `SessionMessageTable` with the same skew shape (follow the file's existing seeding pattern).
- `messages({ sessionID })` (default desc) returns **id-descending** order; `messages({ sessionID, order: "asc" })` returns id-ascending — regardless of `time_created` skew.
- Cursor pagination across the skew: `messages({ sessionID, cursor: { id, direction: "next" } })` with the new id-only boundary returns the correct adjacent page in both directions.
- `context(sessionID)` after a compaction: returns rows in **ascending id order**, **includes the compaction summary row itself** (inclusive `gte` on id), and excludes rows with `id < compaction.id` even when their `time_created > compaction.time_created` (the documented non-equivalence — lock the NEW behavior).
- `context(sessionID)` with no compaction returns all rows id-ascending.

**Verify (expect the two new blocks red, everything else green):**
```powershell
cd packages/opencode; bun test test/session/messages-pagination.test.ts test/v2/session.test.ts
```

### Step E2 — V1: id-only ordering in `message-v2.ts`

**File:** `packages/opencode/src/session/message-v2.ts`

1. `page()` orderBy **:521**: `desc(MessageTable.time_created), desc(MessageTable.id)` → `desc(MessageTable.id)`. Keep the `.reverse()` at **:539** (result becomes ascending id).
2. `older()` **:185-186**: replace the `or(lt(time_created, row.time), and(eq(time_created, row.time), lt(id, row.id)))` tuple with `lt(MessageTable.id, row.id)`.
3. `Cursor` schema **:153-156**: drop the `time` field (schema becomes `{ id: MessageID }`). Safe for in-flight cursors: old cursors carry `time` and Effect `Schema.Struct` decode strips unknown keys (locked by the E1 back-compat assertion).
4. `cursor.encode` **:544**: `cursor.encode({ id: tail.id, time: tail.time_created })` → `cursor.encode({ id: tail.id })`.
5. `messagesForSummary()` orderBy **:628**: `orderBy(MessageTable.time_created, MessageTable.id)` → `orderBy(MessageTable.id)`.
6. `stream()` (**:548-560**) and `Session.messages` (`session.ts:711-716`) need **no edits** — both inherit `page()`; confirm both paths are id-ascending via the E1 tests plus `test/server/session-messages.test.ts`.

### Step E2b — Update the pre-existing `MessageV2.cursor` tests (intentional behavior-change edit)

**File:** `packages/opencode/test/session/messages-pagination.test.ts` — `describe("MessageV2.cursor")` block at `:1073-1093` (verified at HEAD `2c19ce5`).

Dropping `time` from the `Cursor` schema (E2 step 3) breaks three pre-existing assertions. This is the one place the "existing tests stay green" guard does **not** apply: these tests lock the exact behavior being changed (cursor payload carries `time`). This is an intentional behavior-change test edit, not a fix-up. **Land E2b in the same changeset as E2** — between the two, `bun typecheck` fails on the `TS2339`/`TS2353` errors below:

1. `:1079` — `expect(decoded.time).toBe(input.time)`: post-change `decoded` is `{ id }`; `decoded.time` is `undefined` at runtime (Effect `Schema.Struct` strips excess keys) **and** a `TS2339` typecheck error (`bun typecheck` includes `test/`). Remove the assertion; keep the `decoded.id` roundtrip at `:1078`. The `input` literal at `:1075` may keep or drop its `time` field — encode/decode now ignore it (dropping it is cleaner; either typechecks).
2. `:1082-1087` — the "encode/decode with fractional time" test asserts only `decoded.time` (`:1086`) and becomes meaningless. Delete the whole test.
3. `:1090` — `MessageV2.cursor.encode({ id: MessageID.ascending(), time: 0 })`: object-literal excess property `time` → `TS2353` under typecheck. Drop `time: 0` from the literal; the `:1091` base64url regex assertion still passes.

**V1 read-path loop-closure (verified, no change needed):** `handlers/session.ts:101` calls `MessageV2.cursor.decode(before)` purely as `Effect.try` validation — the decoded value is discarded — and old cursors carrying `time` still decode (schema strips unknown keys). No edit required there.

### Step E3 — V2: id-only ordering in `v2/session.ts`

**File:** `packages/opencode/src/v2/session.ts`

1. `messages()` boundary **:483-498**: replace the `(time_created, id)` tuple with the id-only predicate:
   `order === "asc" ? gt(SessionMessageTable.id, input.cursor.id) : lt(SessionMessageTable.id, input.cursor.id)`.
   Stop reading `input.cursor.time` entirely. The `direction === "previous"` order-flip logic at **:478-482** and the `rows.toReversed()` at **:514** are untouched.
2. `messages()` orderBy **:509-512**: collapse the tuple to `order === "asc" ? asc(SessionMessageTable.id) : desc(SessionMessageTable.id)`.
3. Service `Interface.messages` cursor **:117-121**: make `time` optional — `time?: number` (or remove the field; optional is the conservative choice for internal callers still passing it). **`list()`'s cursor at :107-111 is NOT touched.**
4. `context()` compaction lookup **:525**: `desc(time_created), desc(id)` → `desc(SessionMessageTable.id)`.
5. `context()` filter boundary **:536-542**: replace the tuple with `gte(SessionMessageTable.id, compaction.id)` — **`gte`, NOT `gt`**. The current code at :540 is `gte(..., compaction.id)`, so the compaction summary row is included today; `gt` would silently drop the summary from the model-context window. The id-only `gte` is intentionally not bit-for-bit equivalent to the tuple in the skew case (locked by the E1 test).
6. `context()` result orderBy **:546**: `asc(time_created), asc(id)` → `asc(SessionMessageTable.id)`.
7. `list()` (**:470-471** orderBy, **:107-111** cursor) — **no edits**, verified untouched.

### Step E4 — Handler: `time` optional in the service call, kept in the opaque wire cursor

**File:** `packages/opencode/src/server/routes/instance/httpapi/handlers/v2/message.ts`

1. Service call **:47**: drop the inert `time` from the cursor object passed to `session.messages(...)` → `{ id: decoded.id, direction: decoded.direction }`. (Passing it would also typecheck once the Interface field is optional; dropping it makes the inertness explicit.)
2. Wire decode schema **:10-15**: **unchanged** — `time: Schema.Finite` stays required there because every cursor this server has ever encoded (old and new) carries `time` inside the opaque string.
3. Opaque encode **:22**: **unchanged** — keep `time: DateTime.toEpochMillis(message.time.created)` in the base64url payload for in-flight-cursor back-compat (an old client holding a cursor from a pre-change server must still decode).
4. No changes to `groups/v2/message.ts` (the `cursor` query param is already documented as an opaque string at `groups/v2/message.ts:19-22`) and none to `handlers/v2/session.ts` (`context` endpoint at `:178` passes through `session.context(...)` as-is).

### Step E5 — Full verification

```powershell
cd packages/opencode; bun test test/session/messages-pagination.test.ts test/server/session-messages.test.ts test/v2/session.test.ts
cd packages/opencode; bun typecheck
cd packages/app; bun typecheck
```

Then run the full `packages/opencode` suite once (`cd packages/opencode; bun test`) — order-dependent failures are a known pre-existing suite-level issue (root AGENTS.md); compare failures against the pre-change baseline rather than assuming causation. Do not run tests from the repo root.

---

## Q2 resolution — SDK regen is NOT required

**Answer: No.** `./packages/sdk/js/script/build.ts` regenerates `src/v2/gen/` from the OpenAPI spec produced by `bun dev generate` (`packages/sdk/js/script/build.ts:14`). This change alters none of the spec's inputs:

- The messages endpoint's `cursor` query param is already an **opaque string** in the API group (`groups/v2/message.ts:19-22`: "Opaque pagination cursor returned as cursor.previous or cursor.next"), and the response cursor is `{ previous, next }` opaque strings (`handlers/v2/message.ts:53-56`). The `time` field lives only inside the base64url payload and in server-side TS types.
- The V1 `Cursor` schema (`message-v2.ts:153-156`) is module-private — not exported, not part of any wire schema.
- The V2 `Interface.messages` cursor `time?: number` is a TypeScript interface on the server service, not an Effect Schema in the API group — invisible to OpenAPI.
- OrderBy/boundary predicates are pure server-side query logic.

No schema, event, or description text changes → no OpenAPI diff → no regen.

**Fallback if the answer is wrong** (e.g. a step accidentally edits `groups/v2/message.ts`, or `packages/app` typecheck fails on SDK types after the change): run `cd packages/sdk/js; bun script/build.ts`, then delete stale incremental state before re-checking — `packages/app/node_modules/.ts-dist/` and `packages/sdk/js/tsconfig.tsbuildinfo` (per root AGENTS.md, `tsgo -b` caches can mask real SDK-contract errors) — then re-run `bun typecheck` in `packages/opencode` and `packages/app`.

## Q3 audit — V2 `messages()`/`context()` consumer order dependencies

Method: grep across `packages/opencode/src`, `packages/app/src`, `packages/web/src` for `.messages(`/`.context(` call sites plus `time.created|time_created` adjacency comparisons; read every hit. No MCP graph was used (gitnexus has this repo listed but is unreliable per root AGENTS.md Notes; the grep sweep was exhaustive over the consumer surface).

**Finding: no consumer compares `time.created` between adjacent items or depends on the `(time_created, id)` key. No adaptation needed.** Evidence:

| Consumer | Site | Order dependence |
|---|---|---|
| TUI initial load | `cli/cmd/tui/context/sync.tsx:493`, `:511` | `sdk.client.v2.session.messages({ sessionID })`, default desc → newest-first store; live events `unshift` via `reduceMessageEvent` (`sync-messages.shared.ts`). No time comparisons. Desc stays newest-first under id ordering. |
| TUI plugin API | `cli/cmd/tui/feature-plugins/sidebar/context.tsx:15` | Delegates to the same TUI store. |
| CLI run transport | `cli/cmd/run/stream.transport.ts:564` (SDK call), `:567` (`order: "desc"`), `:570` (`.slice().reverse()`) | Requests desc then self-normalizes to ascending via `.slice().reverse()`. No time comparisons. |
| CLI run history | `cli/cmd/run/session.shared.ts:146` | Default desc, `createSession(items)` builds turns; no time comparisons (grep clean). |
| CLI export | `cli/cmd/export.ts:284` | Dumps `svc.messages()` verbatim — output row order changes from `(time, id)` to `id`, which is the intended new contract. |
| CLI stats | `cli/cmd/stats.ts:165` | Aggregates per message; order-insensitive. |
| App load path | `app/src/pages/layout.tsx:747,757` | Fetches desc, then **re-sorts by id itself** (`:726`, `:736` string-compare on `a.id`) and `toReversed()` — self-normalizing, server order irrelevant. |
| App live sync | `app/src/context/sync.tsx:314,327` | `items.toReversed()` at :327; id-sorts at `:22`, `:42`, `:592`. No time comparisons. |
| Web UI | `packages/web/src` | **No code consumers** — only docs (`content/docs/sdk.mdx:135,335`). |
| V2 `prompt()` read-back | `v2/session.ts:579-581` | `order: "asc"` + `findLast` → newest-by-id user/assistant. Intended semantics under the new key (id authoritative). |
| V2 `subagent()` | `v2/session.ts:749-753` | `order: "desc"` + `find` for latest assistant — the in-code comment already states "V2 messages() returns DB rows ordered by id DESC ... MessageID is monotonic"; the code now matches its own comment. |
| V2 `summarize()` | `v2/session.ts:903-905` | `findLast(role === "user")` on default desc → oldest user (pre-existing semantics under both keys; unchanged relative semantics). |
| V2 `command()` read-back | `v2/session.ts:932-934` | Same shape as `prompt()` read-back. |
| V2 `revert()` | `v2/session.ts:960-966` | Uses `row.time_created` only for the **legacy-ID timestamp fallback match** (`matchLegacyMessage`, `v2/legacy-message-id.shared.ts:37`) — matches a message's embedded legacy timestamp, not adjacent-item ordering. Unaffected. |
| HTTP `context` endpoint | `handlers/v2/session.ts:178` | Pass-through of `session.context()` (asc id) — unchanged shape. |
| `sync-v2.tsx` | — | **Does not exist.** `rg "sync-v2"` over `packages/opencode/src` and `packages/app/src` returns no file; `packages/opencode/src/cli/cmd/tui/context/` contains only `sync.tsx`, `sync-messages.shared.ts`, `sync-schema.ts` (directory listing verified). The old plan's Q3 mention of `sync-v2.tsx` refers to a file that was never created or was removed in the V2 store rewrite. |

## Residual risk

- **Live arrival order vs server order:** the TUI reducer still `unshift`s live `session.next.*` events in arrival order. This change makes the server's pagination key and the id key agree, but arrival order can still differ from id order transiently (network interleaving). That is the TUI reducer's domain and is unchanged here — the change narrows the divergence class; it does not make arrival order authoritative.
- **`context()` window composition in the skew case:** intentionally differs from the tuple predicate (documented above, locked by test). Any future consumer that relied on the old skew-case inclusion of `time_created > t0, id < id0` rows would see them excluded — no such consumer was found in the Q3 audit.
- **In-flight cursors across the deploy boundary:** V1 cursors carrying `time` decode cleanly (schema strips unknown keys — locked by test); V2 opaque cursors keep `time` in the payload and the decode schema, so old cursors remain decodable. Residual risk is limited to a cursor issued by the old binary and consumed after the new binary drops `time` from the *service* input — the boundary no longer reads it, which is exactly the intended behavior.
- **Pre-existing suite flakiness:** order-dependent test failures and the known flaky permission/skill tests (root + session AGENTS.md) predate this change; compare against baseline.
- **`as any` / style:** no new casts introduced; all edits are predicate/orderBy swaps and one interface field widening.

## Excluded steps (explicit)

- **Step 2a** — obsolete: the TUI message cap does not exist (evidence in Scope decision).
- **Step 2b** — deferred on product decision Q1; its truncation premise is also weakened by the cap removal.
- **Step 3** — doc-only; the E1 char tests already lock the `messages()`-full / `context()`-window contracts; avoids touching OpenAPI descriptions and reopening Q2.
- **Step 4** — `memory()` adapter is test-only (zero production callers, verified); raw `push` at `session-message-updater.ts:85-87` is real but not on a production read path.
- **Step 5** — `filterCompacted` reorder is independent of the DB sort key and already covered by characterization tests; no consumer bug found.
