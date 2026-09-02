# Plan: Fix intermittent chat ordering breaks & conversation disappearance in TUI/chat

**Date:** 2026-08-14
**Author:** strategic-planning agent
**Scope:** research + implementation plan (no code executed)

---

## 1. Goal

Investigate and fix two intermittent display glitches in the TUI / chat presentation:

1. **Message ordering breaks** — messages render in a non-chronological order during/after a session.
2. **Conversation disappears** — a session's conversation is partially or fully missing after loading, streaming, or compaction.

Produce a prioritized, test-gated (Rule 3) implementation plan. Guaranteed bug fixes are separated from optional hardening/enhancements. Every behavior-changing change requires a characterization test first.

**Out of scope:** rearchitecting the V1/V2 split, rewriting `runLoop`, changing the V1←→V2 delegation model, perf micro-optimizations unrelated to correctness.

---

## 2. Evidence & Root-Cause Analysis

### 2.1 Message ordering — where order is produced and consumed

The TUI paints messages in **stored array order** only:

- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:172` → `const messages = createMemo(() => sync.data.message[route.sessionID] ?? [])`
- `session/index.tsx:1136` → `<For each={messages()}>` renders the array verbatim. **No sort is applied at render time.**

So display order == `sync.data.message[sessionID]` order == whatever `sync.tsx` maintains:

- Initial load: `context/sync.tsx:506-510` calls `sdk.client.session.messages({ sessionID, limit: 100 })`.
- Streaming: `context/sync.tsx:214-252` (`message.updated`) inserts **by id** via `Binary.search(... (m) => m.id)`.

The two paths use **different sort keys**:

**A) Initial load order (DB, `MessageV2.page`)**
- `session/message-v2.ts:509-544` `page()` → `ORDER BY time_created DESC, id DESC`, then `items.reverse()` (line 537).
- Net result: ascending **`(time_created, id)`**.
- Server route / service returns `page().items` when `limit` set (the TUI sync path).

**B) Streaming order (in-memory, `sync.tsx`)**
- `Binary.search` (`core/src/util/binary.ts:2-20`) assumes the array is sorted by the **comparator `m.id`** (ascending string compare).
- Insert position = `left` from a binary search over **id**.

**Root cause of ordering breaks — divergent sort keys:**
- `MessageTable.time_created` is filled at **DB INSERT time** (`Timestamps`, `session/session.sql.ts`), while the `MessageID` encodes the timestamp+counter at the moment the ID was **generated** (`id/id.ts:50-68`).
- IDs are generated **eagerly, well before insertion** in several write paths:
  - `session/loop/run-loop.ts:200` — new assistant `MessageID.ascending()` before the processor streams (network round-trip delay).
  - `session/loop/subtask.ts:55,219` — subagent message IDs generated up-front.
  - `session/loop/shell.ts:65,84` — shell-related message IDs.
  - `session/compaction.ts:460,529,578,660` — compaction marker + synthetic user messages.
- With concurrency (tools, subagents, shell) or network latency, a message whose **id** says "older" can be **inserted into the DB later** (larger `time_created`). `page()` then orders it by `time_created` placement, while `sync.tsx` positions it by `id` placement.
- **Net effect:** the TUI array is id-sorted but the DB is `(time_created, id)`-sorted. Under the right interleaving (same-millisecond messages, or id-created-time ≠ insert-time), `Binary.search` returns a wrong insert index → out-of-order display. Because all ordering derives from these two keys, this is the primary **ordering-break** candidate.

**Concrete replication scenario (for the Step 1.1 characterization test):**
Insert two rows directly into `MessageTable` such that their **id order disagrees with their `time_created` order**. `MessageID` is `Date.now()*4096 + counter` + random suffix (`id/id.ts:59-68`); `time_created` is `$default(() => Date.now())` at insert (`session/session.sql.ts`). Force the inversion:
- **row B** gets an *older* (smaller) `id` — i.e. an ID whose hex prefix encodes an earlier timestamp — but is **inserted later**, so its `time_created` is *larger* than row A's.
- **row A** gets a *newer* (larger) `id` but is inserted *first*, so its `time_created` is *smaller*.

Then:
- `page()` ascends `(time_created, id)` → returns `[A, B]`.
- `sync`-style `Binary.search` by `m.id` (ascending string) would order `[B, A]`.
- Assert these two disagree today (line 538 `items.reverse()` on the DESC query yields `(time_created, id)` ascending). This locks the bug before the Step 1 fix.

**Secondary ordering fragility — `filterCompacted` reorder** (`message-v2.ts:647-696`):
- `filterCompacted` returns model-consumption order `[compaction-user, summary, ...retained tail..., continue-user]` and does `result.reverse()` on an already-ordered list (line 668). This is documented as **non-chronological**.
- This path is used by `runLoop` (`run-loop.ts:86`, `MessageV2.filterCompactedEffect`) and tests, **not** by the TUI V1 render. So it is a risk for the *model/loop* correctness (mitigated by `MessageV2.latest()`), and a latent trap for any future consumer that treats array position as chronological. The V1 `Session.messages` service deliberately does **not** filter, so the TUI sync path is safe from this specific reorder — but it is exactly the trap the codebase has already hit (double-compaction bug, `message-v2.test.ts:1621-1655`).

### 2.2 Conversation disappearance

Several independent contributors, each with evidence:

**C1) TUI 100-message ring cap** — `context/sync.tsx:232-250`:
- When `store.message[sessionID].length > 100`, the handler `shift()`s the oldest (`updated[0]`) and `delete`s its parts.
- `updated[0]` is the **id-smallest** assumed = oldest. If ordering is corrupt (see §2.1), `updated[0]` is NOT the oldest → the cap removes the wrong message while leaving older ones → **visible conversation loss / gap**.
- Combined with the `limit: 100` initial load (`sync.tsx:510`), a session with >100 messages silently truncates on the TUI even on a clean path — the cap keeps only the newest 100 messages, dropping older ones. This matches "conversation partially disappears" for long sessions.

**C2) Streaming text loss** (documented in `cli/cmd/run/AGENTS.md`):
- Symptom: "Text truncated during stream, correct after restart." The DB path (`flushPart` → projector) captures full text, but the TUI streaming path can drop content via `toolEntryBody` returning empty/placeholder commits (`cli/cmd/run/AGENTS.md` "SSOT tool scroll") and `MarkdownRenderable` settle/commit quirks.
- This is a *content* loss (scrollback entry), not a *message* reorder — distinct from the user-reported "conversation disappears" but shares the symptom category. Flag as a secondary target; the `flushActive` force-commit fallback already exists.

**C3) V2 read-model clarification (doc literal, not a disappearance bug):**
- V2 `messages()` (`v2/session.ts:318-358`) returns **ALL** rows from `SessionMessageTable`, with **no** compaction filtering — identical to V1 `Session.messages`. The `where` is only `session_id` equality (+ optional cursor boundary). **It does NOT hide pre-compaction messages.**
- V2 `context()` (`v2/session.ts:359-390`) is the one that filters: `gt(time_created, compaction.time_created)` after finding the last compaction. This is **by design** — `context` returns the active model-context window ("all messages after the last compaction"), which is the correct semantic for feeding a model.
- The "all messages after the last compaction" docstring in the OpenAPI metadata belongs to the **`context`** endpoint (`server/routes/instance/httpapi/groups/v2/session.ts:106`), **not** `messages`. A previous version of this plan misattributed it; corrected here.
- **Conclusion:** There is **no V1/V2 message-set divergence** of the "V2 hides pre-compaction content" kind. `messages` = full for both; `context` = filtered for both (V1 `Session.context` also returns the compaction-filtered window). The only risk is a **consumer confusion** between `messages()` (full, for display) and `context()` (window, for model input) — that is a documentation/hardening concern, not a bug. Handled as a doc-only note (see Step 3).

**C4) V2 projector `appendMessage` is append-only / unsorted** — `session-message-updater.ts:85-87` (`appendMessage` simply `push`). This file exposes **only** a `memory()` adapter (`session-message-updater.ts:20-92`) — there is **no DB-backed adapter** here; the DB read path is the direct Drizzle query in `v2/session.ts:345-356`. The `memory()` accumulator keeps messages in **event-arrival (push) order**. Crucially, the `getCurrent*` helpers (`activeAssistantIndex`/`activeCompactionIndex`/`activeShellIndex`, lines 21-43) are **backward scans** (`for (i = length-1; i >= 0; i--)`) over `state.messages`, so they assume the newest message sits at the array **end** — i.e. they assume push order == chronological order. If `appendMessage` is ever fed out-of-chronological-id order (projector replay, batch, concurrent writes), then both the V2 list order AND the `getCurrent*` "latest" lookups return the wrong result. Lower confidence today (the projector feeds events in monotonic-id order); flag for hardening.

### 2.3 DB layer consistency

- **No dedicated `order` column.** Ordering relies solely on `time_created` + `id` (index `message_session_time_created_id_idx`, `session/session.sql.ts`).
- `id` (ascending) encodes `Date.now()*4096 + counter` plus 14 random bytes (`id/id.ts:59-68`). The hex timestamp+counter prefix preserves monotonic order for the logical clock; the random suffix is a tie-breaker. Sorting by full id string is deterministic and stable; sorting by `time_created` then `id` is the DB's chosen key.
- **Recommendation:** treat `id` as the single authoritative ordering key everywhere (Step 1). `time_created` should remain a display/metadata value, not a sort key, because it measures *insert* time, not *logical/conversation* time.

### 2.4 Existing test coverage

Well covered (good baseline for Rule 3 characterization):
- `test/session/message-v2.test.ts:1621-1655` — double-compaction + `MessageV2.latest()` regression.
- `test/session/messages-pagination.test.ts:662-1165` — extensive `filterCompacted` cases (reorder, tail, fork remap, no-compaction identity).
- `test/session/compaction.test.ts`, `test/session/run-loop.characterization.test.ts` — compaction + loop ordering via `filterCompactedEffect`/`latest`.
- `test/cli/run/session-data.test.ts` + `test/cli/cmd/run/session-data.characterization.test.ts` — `flushInterrupted`, `reduceSessionData` commit ordering.
- `test/server/session-messages.test.ts` — server-route message ordering.
- `test/v2/session-message-updater.test.ts` — V2 projector.

**Gaps:** no test for the **`page()` vs `Binary.search` divergent-key interleaving**, no test locking the `sync.tsx` 100-message cap's "remove oldest by id" invariant, and no V2 `messages()`/`context()` sort-key test. These are the highest-risk untested behaviors.

---

## 3. Steps

> Every behavior-changing step requires a characterization test **first** (Rule 3). Steps are ordered by priority. Step 1 + Step 2a are guaranteed-bug fixes; Step 2b is an optional enhancement; Steps 3–4 are hardening; Step 5 is verification.

### Step 1 — (BUG) Make message ordering derive from a single authoritative key (`id`), V1 AND V2

**What:**
1. **Characterization test (Rule 3)** reproducing the divergent-order bug (concrete scenario in §2.1): build a synthetic message sequence where `MessageID`-embedded-timestamp order differs from `time_created` order. Assert `sync`-style binary insertion + DB-`page`-style ordering disagree today (lock the bug).
2. **V1 `MessageV2.page`** (`message-v2.ts:509-544`): change `orderBy` at line 519 from `desc(time_created), desc(id)` → `desc(id)` (single key), keeping the `.reverse()` at 537 (result is then ascending `id`). Update the `older()` cursor predicate (`message-v2.ts:184-185`) from `(time_created, id)` compare → `lt(MessageTable.id, row.id)` only.
3. **V1 cursor encoding** (`message-v2.ts:542`): `cursor.encode({ id: tail.id, time: tail.time_created })` → drop the now-dead `time` field → `cursor.encode({ id: tail.id })` (and update the `Cursor` schema/`cursor.encode/decode` as needed).
4. **V1 `messagesForSummary`** (`message-v2.ts:626`): change `orderBy(time_created, id)` → `orderBy(id)` (this is per-turn diff ordering; still derive from `id` for consistency, not left conditional).
5. **V1 `Session.messages`** (both `limit` and `no-limit` paths, `session/session.ts`): confirm both are id-ascending and consistent (they flow through `page()`; verify the no-limit path too).
6. **V2 DB message read path** (`v2/session.ts`) — align all **message** reads to id-only to keep the sort key globally consistent (otherwise Step 1 would reintroduce the exact V1/V2 divergence this plan exists to remove):
   - `messages()` cursor boundary (`v2/session.ts:324-340`): the `boundary` variable spans lines 324–340. Replace the `(time_created, id)` boundary → `order === "asc" ? gt(SessionMessageTable.id, input.cursor.id) : lt(SessionMessageTable.id, input.cursor.id)`.
   - `messages()` `orderBy` (`v2/session.ts:350-352`): `asc/desc(SessionMessageTable.id)` only.
   - `messages` cursor `time` field (Minor 3): after the boundary becomes id-only, `input.cursor.time` in the Interface input (`v2/session.ts:101-105`) and handler decode/encode (`handlers/v2/message.ts:10-15`) is no longer read by the boundary. Make `time` **optional** in the service Interface type (`time?: number`) and **stop passing/reading it in the boundary**. Keep `time` in the opaque wire-payload encode/decode (`handlers/v2/message.ts:22`) for backward-compat with in-flight cursors issued by older servers (Effect `Schema.Struct` decode tolerates the extraneous key), but it is inert. **Do not** make it required — otherwise internal callers are still forced to supply a value the boundary ignores. (`list()`'s own `time` cursor field at `v2/session.ts:91-95` is unchanged — see next bullet.)
   - `context()` compaction lookup (`v2/session.ts:365`): find the last compaction by `desc(id)` (not `desc(time_created), desc(id)`).
   - `context()` filter boundary (`v2/session.ts:376-382`): use `gte(SessionMessageTable.id, compaction.id)` only — **NOT `gt`**. The current code at line 380 is `gte(..., compaction.id)`, so today the compaction summary message is **included** in the model-context window (`(time_created, id) >= (compaction.time_created, compaction.id)`). Switching to `gt` would silently **exclude** the compaction summary from the window = behavior change. Switching to `gte` preserves the existing inclusive behavior.
     - **Edge-case note (documented behavior nuance):** converting the tuple predicate `(time_created, id) >= (t0, id0)` to id-only `gte(id, id0)` is not bit-for-bit equivalent in the divergent-sort-key case — a row with `time_created > t0` but `id < id0` (the exact skew this plan fixes) was previously included (its `time_created > t0` satisfied the OR's first branch) but after the change is excluded. That is intended (id is now authoritative), but it is a **window-composition difference in the skew case**; the characterization test in this step must assert the new id-based boundary so the change is intentional, not incidental. If the exclusive variant were ever wanted, it would be a separate step with its own char test first (per reviewer note).
   - `context()` result `orderBy` (`v2/session.ts:386`): `asc(SessionMessageTable.id)` only.
   - **`list()` (Major 2) — REMOVED from Step 1 scope.** `list()` at `v2/session.ts:279-317` orders `SessionTable` rows (sessions, **not** messages), by `(time_created, id)` (lines 310-313) with a `(time_created, id)` cursor boundary (lines 293-305). It is **not** a message-ordering write path (§2.1 catalogs only run-loop/subtask/shell/compaction message writes), so it does not contribute to the message-reorder bug this plan fixes. Leaving it out avoids scope creep and the cascading cursor `time` work. Kept **unchanged** (still `(time_created, id)`). If a future pass wants session ordering to match, that is a separate concern. Because `list()` stays as-is, its cursor type (`v2/session.ts:91-95`) and handler (`handlers/v2/session.ts:9-20`) are untouched.

**Why:** eliminates the dual-sort-key divergence that corrupts the TUI array via `Binary.search`, and keeps V1/V2 on one key so no new divergence class is introduced. `id` is monotonic (`id/id.ts`), so `id`-ascending IS chronological; `time_created` measures insert time, not conversation time.

**Files:**
- `packages/opencode/src/session/message-v2.ts` (`page`, `older`, `stream`, `messagesForSummary`, cursor encode)
- `packages/opencode/src/session/session.ts` (V1 `Session.messages` limit + no-limit paths)
- `packages/opencode/src/v2/session.ts` (`messages`, `context` orderBy + cursor boundaries + compaction boundary; `messages` Interface cursor `time` → optional). `list()` **untouched**.
- `packages/opencode/src/server/routes/instance/httpapi/handlers/v2/message.ts` (message cursor `time` optional in service call; keep in opaque encode for backward-compat). `handlers/v2/session.ts` **untouched**.
- cursor schema/module (`cursor` import in message-v2.ts) if the V1 `time` field removal ripples
- `packages/sdk/js` — only if the response *contract* changes. The `Cursor` type is internal to the server pagination, not the wire DTO, so no regen expected (open for confirmation, see Q2).

**Characterization test (Rule 3):**
- `test/session/messages-pagination.test.ts` — new block "page orders by id regardless of time_created skew" (replication in §2.1) + cross-test that `Binary.search` insert on the resulting array yields chronological order.
- `test/v2/session.test.ts` — new block asserting V2 `messages()` and `context()` return `(time_created, id)`-skewed fixtures in id order, and that `context()`'s boundary **includes** the compaction summary row (`gte` on id), locking the current inclusive behavior.

**Verify:** `cd packages/opencode && bun test test/session/messages-pagination.test.ts test/server/session-messages.test.ts test/v2/session.test.ts`; then `bun typecheck` in `packages/opencode` and `packages/app`.

**Risk:** LOW-MEDIUM. Contained to DB read/cursor path but now spans V1 + V2. Affects pagination order, `stream()`, and V2 `messages`/`context` (NOT `list`, which is untouched). Run-loop consumes `stream()` inside `filterCompacted` — verify `filterCompacted` tests still pass (its reorder is independent of input tie-break). V2 consumers (`sync-v2.tsx`, SDK) must not depend on V2 `messages` ordering by `time_created`; verify. The `context()` id-only boundary is not bit-for-bit equivalent to the tuple predicate in the divergent-sort-key case (see edge-case note above) — the char test locks the new intended behavior.

### Step 2a — (BUG) Harden the TUI message cap to remove the true-oldest message

**What:**
1. Characterization/unit test for the `sync.tsx` `message.updated` cap path (`context/sync.tsx:232-250`) asserting it removes the *oldest-by-id* message, and that a wrong-ordered array does not cause the wrong removal.
2. Change the cap removal to select the min-`id` element explicitly (or assert the array is id-sorted before shifting). Since Step 1 makes the array id-sorted, `updated[0]` = min id is then correct. Add a guard: if the array is not id-sorted, find the min-id index (defense-in-depth; cheap since the array is small at the cap boundary). Optional follow-up: also guard the initial-load `limit: 100` truncation so it never silently drops non-oldest messages (see Open Question Q1; the load is already oldest-100, so this is a lower-priority consistency guard).

**Why:** stops silent oldest-message drop and wrong-message removal under ordering skew; addresses "partial conversation disappears" from `C1`.

**Files:**
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx` (`message.updated` cap logic)
- test: new unit test for the cap invariant (co-located or under `test/cli/cmd/tui/`)

**Verify:** unit test for the cap invariant; `cd packages/opencode && bun test` (full suite — cap is order-dependent; run full suite per AGENTS.md).

**Risk:** LOW. Changes TUI memory/rendering width only at the cap boundary. Do not touch the message resource pattern this file uses (avoid re-introducing the `useFilteredList`/`createResource` reactivity regression documented in `.jules/bolt.md` — this file uses the `store.message` resource directly, not `useFilteredList`; leave that pattern unmodified).

### Step 2b — (ENHANCEMENT, optional) Scrollback pagination instead of hard 100-cap truncation

> Separated from Step 2a because this is a **product/architecture decision**, not a bug fix. See Open Question Q1.

**What:**
1. Product decision: keep the full message list in memory (state grows with session length; correct) and paginate the **visual scrollback**, OR introduce an explicit "load older" affordance. Do NOT silently truncate the message source (what the current hard cap does).
2. If chosen: change the TUI to keep the complete `store.message[sessionID]` and render a window of the scrollback, adding a load-older gesture that calls `messages({ sessionID, before: cursor, limit })`.
3. Remove or raise the 100-cap so it no longer truncates conversation.

**Why:** long sessions currently silently drop the oldest 100 messages from the TUI even on a clean path (no ordering bug).

**Files:**
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` (scrollback window + load-older)
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx` (remove/raise cap)
- `packages/opencode/src/cli/cmd/tui/component/...` as needed for the gesture

**Verify:** TUI manual flow for a >100-message session; unit test for cap-invariant removal (from Step 2a) becomes trivial once the cap is gone.

**Risk:** MEDIUM. UX + state-growth tradeoff; separate from the bug fix. Deferred pending Q1 answer.

### Step 3 — (HARDEN, doc-only) Clarify V2 `messages()` vs `context()` contracts

> Corrects the prior version's misreading (C2). There is **no** disappearance bug here — `messages()` returns full, `context()` is compaction-filtered by design. This is documentation clarity only.

**What:**
1. Add/confirm JSDoc on V2 `messages()` (`v2/session.ts:318`) stating it returns **all** messages for the session (no compaction filtering), and on V2 `context()` (`v2/session.ts:359`) stating it returns the compaction-filtered model-context window.
2. Ensure the OpenAPI descriptions align. The **`messages`** endpoint is declared in **`groups/v2/message.ts:28-46`** (group `v2.message`), and already carries the description "Retrieve projected v2 messages for a session." — append explicit language that it returns **all** messages including pre-compaction rows, and that the compaction-filtered window is served by `context`. The **`context`** endpoint is in `groups/v2/session.ts:84-109` and its description "all messages after the last compaction" (line 106) is already correct.
3. Add a characterization/assertion test that V2 `messages()` returns full (pre-compaction) rows, locking the "no hiding" contract so a future change cannot silently introduce compaction filtering into the display path.

**Why:** the `context()`/`messages()` distinction is a documented contract, not a bug; a test locks it and prevents a future regression that would read like disappearance.

**Files:**
- `packages/opencode/src/v2/session.ts` (JSDoc on `messages`/`context`)
- `packages/opencode/src/server/routes/instance/httpapi/groups/v2/message.ts` (openapi `description` on the `messages` endpoint, lines 43-44)
- `packages/opencode/src/server/routes/instance/httpapi/groups/v2/session.ts` (confirm `context` description at line 106 — already correct, leave/verify)
- test: `test/v2/session.test.ts`

**Verify:** `cd packages/opencode && bun test test/v2/session.test.ts`.

**Risk:** NONE (doc + test).

### Step 4 — (HARDEN, optional) Make V2 in-memory projector sort by `id`

**What:**
1. Characterization test for `session-message-updater.memory` adapter (`session-message-updater.ts:20-92`): feed events out of id-order; assert list stays id-ordered.
2. Change `memory.appendMessage` (`:85-87`) to insert-by-id (or maintain order invariant) instead of raw `push`, OR sort in the V2 `messages()` reader. `getCurrentAssistant`/`getCurrentShell`/`getCurrentCompaction` use backward scans for "latest" — verify they use max-id semantics and a sorted list does not change their result on the happy path.

**Why:** removes event-arrival-order dependency; protects out-of-order replay/batch consumers (`C4`).

**Files:**
- `packages/opencode/src/v2/session-message-updater.ts`
- test: `test/v2/session-message-updater.test.ts`

**Verify:** that test file; full suite (`bun test`).

**Risk:** LOW. Contained to the in-memory V2 accumulator.

### Step 5 — (HARDEN, optional) Guard `filterCompacted` reorder and document non-chronological contract

**What:**
1. Add a JSDoc block on `filterCompacted` (`message-v2.ts:647`) stating it returns model-consumption (non-chronological) order and that consumers MUST use `MessageV2.latest()` for "newest message" semantics.
2. Only if warranted by a found consumer bug: make `filterCompacted` document/annotate its output (do **not** reorder it to chronological — that would break the loop's compaction invariant). Keep `latest()`.
3. Add a **test-only** assertion (characterization) that any consumer reading array-position-as-latest goes through `latest()` — i.e. a test that greps/checks the run-loop hot paths use `latest()`, **not** a runtime guard. If a runtime guard is instead desired, re-scope this step (a runtime assertion is a behavior change and would not be "NONE risk").

**Why:** the documented trap has already caused a real double-compaction bug; a test prevents recurrence without changing behavior.

**Files:**
- `packages/opencode/src/session/message-v2.ts` (doc only)
- `packages/opencode/src/session/loop/run-loop.ts` (spot-check all `msgs` consumers use `latest()` / explicit bounds)

**Verify:** existing `filterCompacted` + run-loop characterization tests remain green.

**Risk:** NONE (doc + test-only). If a real consumer bug surfaces, re-scope to a bug step.

### Step 6 — (VERIFY) End-to-end regression + perf guardrail check

**What:**
- Run the full `packages/opencode` test suite (order-dependent failures are expected/suite-level — per AGENTS.md).
- Run `bun typecheck` from `packages/opencode` AND `packages/app` (SDK regen may be needed only if the message-schema, not the ordering, changed — see Open Question Q2).
- Confirm no perf regression against `.jules/bolt.md` guardrails: message sync and render paths remain single-pass; do not add `toSorted`/`map` chains in high-frequency `createMemo`s without a proven bottleneck.

**Verify:** `cd packages/opencode && bun test; bun typecheck`; `cd ../app && bun typecheck`.

**Risk:** NONE (verification).

---

## 4. Architecture Decisions

### #1 — Single sort key: `id` (monotonic) over `(time_created, id)`, applied uniformly to V1 AND V2
- **Chosen:** Message/part ordering derives solely from `id`, which is monotonic via `Identifier.ascending` (`id/id.ts`). DB pagination and TUI insertion both key on `id`, across V1 (`MessageV2.page`, `messagesForSummary`) and V2 message reads (`messages`, `context`). **V2 `list()` is intentionally excluded** — it orders sessions, not messages, and is out of scope for this message-ordering fix (Major 2).
- **Rationale:** `id` measures *logical/conversation* time at creation; `time_created` measures DB *insert* time. Using insert-time as a sort key is what produces the divergent orders behind the intermittent reorder. Applying the change uniformly avoids re-introducing the V1/V2 divergence class.
- **Alternatives considered:** (a) keep `time_created` sort but force `time_created = idTimestamp` at insert — rejected: changes semantics, incurs migration touch, and still leaves V1-stream vs DB potential skew; (b) sort at render in TUI — rejected: O(N log N) per reactive update on a hot createMemo, violates `.jules/bolt.md` guardrails and masks the root inconsistency.
- **Trade-off:** `id`-sorting changes pagination key ordering and the V2 read-model orderings (`messages`/`context`). `filterCompacted`/run-loop and V2 tests must re-verify. Low blast radius; the V2 additions outside `list()` broaden Step 1's surface slightly. The `context()` id-only boundary is not bit-for-bit equivalent to the tuple predicate in the divergent-sort-key case (compaction-window composition can differ) — locked by a char test.

### #2 — Bug fix (min-id cap guard) is separate from enhancement (scrollback pagination)
- **Step 2a** keeps the 100-cap but never drops the *wrong* message (min-id guard). This is the guaranteed bug fix.
- **Step 2b** (cap the scrollback, not the source) is a separate product decision with separate risk; it does not change the *correctness* guarantee of 2a.
- **Rationale:** bundling a bug fix with an architecture change makes the fix harder to review, test, and ship.
- **Alternatives:** increase cap — rejected, doesn't fix wrong-id removal; remove cap entirely in the fix step — rejected, couples a UX change into a bug fix and risks unbounded TUI state without the pagination decision made.

---

## 5. Open Questions

- **Q1 (product):** Should the TUI keep the full message list in memory and paginate the visual scrollback (correct, but state grows with session length), or is a bounded cap acceptable with a "load older" affordance? Default for this plan: keep full list, paginate visual (Step 2b). Confirm preferred UX. This gates whether Step 2a is shipped alone (cap guard) or alongside 2b (cap removal).
- **Q2 (SDK/schema):** Steps 1–5 change query ordering only; no wire schema change expected for the message DTO. The internal `Cursor` type change (`time` removal) is server-side pagination, not part of the response schema. Confirm whether a `@opencode-ai/sdk` regen (`packages/sdk/js/script/build.ts`) is truly unnecessary (it should be — no schema/event change). If any test or consumer depends on response *order* semantics, a regen may be needed.
- **Q3 (V2 order dependency):** Do any V2 `messages()`/`context()` consumers (SDK callers, `sync-v2.tsx`, web UI) depend on the existing `(time_created, id)` sort order (e.g., comparing `time.created` across adjacent items)? Aligning V2 to id-only must not break those assumptions. Audit before/while applying Step 1. (This concerns `messages`/`context` only; `list` is untouched per Major 2.)
- **Q4:** Are the "conversation disappears" reports primarily from the live TUI (V1 sync) or the V2 debug view? The fix differs (Cap/sort vs read-model). If only V2 debug, Step 2's cap risk is lower and Step 3's doc-clarity work is higher value. (Note: the historical "MISSING DATA" label in the V2 debug view is a static empty-state message, not a conversation-loss indicator — see §2.2 C3.)