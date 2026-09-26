---
# Fix: SyncEvent DateTime round-trip (V2 replay data loss + reconnect loop)

Status: APPROVED
Date: 2026-09-26

## 1. Summary
Replayed V2 events carry ISO-string timestamps (e.g. `2026-09-26T12:37:58.940Z`). Projectors construct `Schema.Class` V2 message types that require a decoded `DateTime.Utc`, so construction THROWS (`Expected DateTime.Utc, got "2026-..."`). The `process()` transaction rolls back, `replay()` fails, the V2 read model (`SessionMessageTable`) stays empty, and the workspace sync enters an infinite reconnect loop.

## 2. Verified Root Cause (anchors)
1. Emitters pass `DateTime` instances into `SyncEvent.run(...)`. **Run-call lines:** `session/processor.ts:263` (Reasoning.Delta; its timestamp value is :267), `session/loop/create-user-message.ts:499` (Prompted; timestamp value :501), `session/session.ts:510` (Deleted; timestamp value :512), `v2/session.ts:603` (AgentSwitched; timestamp :605), `:610` (ModelSwitched; timestamp :612), `:734,:742,:751,:765` (Synthetic; timestamps :736-767), `:961` (Updated/revert flow; timestamp :963). **Timestamp-value lines:** `session/processor.ts:347` (Tool.Called, run-call :338), `:479` (Step.Started, run-call :469), `:595` (Compaction.Delta, run-call :593), `:602` (Text.Delta, run-call :599), `session/session.ts:512`, `v2/session.ts:605,612,736-767,963`.
2. Recorder stores `event.data` raw in a Drizzle JSON-mode column: `sync/index.ts:322` (`data: event.data as Record<string, unknown>`). `JSON.stringify(DateTime.nowUnsafe())` → ISO string.
3. Replay feeds stored data back into projectors: `sync/index.ts:107`. Consumers: `control-plane/workspace.ts:383-392`, `server/handlers/sync.ts:35-41`.
4. Projectors build V2 messages from `event.data.timestamp`: `session/projectors-next.ts:109-123` → `session-message-updater.ts:157-174,210-230,186-198,441-452,135-155`. Schema: `v2/session-message.ts:69,95,113,161,207` via `V2Schema.DateTimeUtcFromMillis` (`v2/schema.ts:3-8`).
5. Throw → `process()` transaction rollback (`sync/index.ts:301-359`) → `replay()` fails.
6. SSE loop logs at info and drops the event (`workspace.ts:440-452`); gap check (`sync/index.ts:93-98`) drops subsequent events for that aggregate.
7. `syncHistory` `Effect.forEach` fails whole batch (`workspace.ts:375-398`) → caught at `workspace.ts:415-425` → disconnect/reconnect → poison events repeat → infinite loop (backoff cap 2 min, `workspace.ts:478`).

Mixed live+replay corruption: an update-type event (`session-message-updater.ts:231-243`) can persist the ISO string into `SessionMessageTable.data` (encodeDateTimes passes strings through, `sync/index.ts:278-285`); later `decodeMessage` (`projectors-next.ts:12-13`) throws on every read.

Documented wrong assumption at `sync/index.ts:334-337` ("the walk is idempotent for millis") must be corrected: raw does not round-trip because `toJSON` yields an ISO string.

## 3. Chosen Fix + Rationale

**Canonical encoded form at the recorder boundary + tolerant revive for projector input + tolerant decode-on-read for the already-poisoned read model.**

Verified runtime mechanics (bun probes against this tree, 2026-09-26):

- `JSON.stringify(DateTime.nowUnsafe())` → `"2026-09-26T13:44:00.084Z"` — confirms the recorder corruption (`toJSON` yields an ISO string).
- `Schema.Class` constructors validate the **type side**: `new SessionMessage.User({ time: { created: <DateTime> } })` passes; millis throws `Expected DateTime.Utc, got 1790430278751`; ISO string throws `Expected DateTime.Utc, got "2026-..."`. So encoding the recorder alone is NOT enough — replay must hand projectors `DateTime.Utc` instances.
- `Schema.decodeUnknownSync(SessionMessage.Message)` validates the **encoded side**: requires millis; ISO strings throw `Expected number, got "2026-..."`. So the read model needs millis.
- `Schema.decodeUnknown` **strips undeclared properties** (`{a:"x", extra:42}` → `{a:"x"}`) — reviving replay data via full `def.schema` decode would silently drop undeclared payload fields (the exact loss `encodeDateTimes`' JSDoc warns about for encode). Revival must be a targeted walk, not a schema decode.

Surface audit: `V2Schema.DateTimeUtcFromMillis` appears in exactly ONE event-data position — `SessionEvent` `Base.timestamp` (`v2/session-event.ts:22`, spread into every V2 event def). V1 event schemas (`session/session.ts` Created/Updated/Deleted, `session/message-v2.ts` message events) declare millis (`NonNegativeInt`) and their emitters pass numbers, so `encodeDateTimes` is a no-op for V1 — the fix is V2-scoped by construction.

Design (three moves, all at existing seams):

1. **Store the encoded form** (`sync/index.ts` `process()`): persist `encodeDateTimes(data)` in `EventTable` instead of raw `event.data`. Millis are JSON-stable, so stored rows round-trip exactly. Publish already encodes; storage now matches the wire.
2. **Revive for projectors** (new `Definition.revive` hook): `process()` computes `const data = def.revive ? def.revive(event.data) : event.data` and feeds THAT to the projector, to `convertEvent`, and derives storage/publish from it. The hook is declared per event family; `EventV2.define` (`v2/event.ts`) — the single chokepoint for all V2 defs — supplies one shared implementation that revives `data.timestamp` (accepts `DateTime` instance | millis | ISO string → `DateTime.Utc`). Live behavior is unchanged (DateTime in → DateTime out); replay now feeds projectors the same shape emitters produce.
3. **Tolerant decode-on-read for the corrupted read model** (`v2/session-message.ts` `normalizeForDecode`): revive ISO strings at `time.{created,completed,ran,pruned}` (top level + `content[].time.*`) to millis before `SessionMessage.Message` decode. Heals rows already poisoned by the mixed live+replay path; both read paths (`projectors-next.ts` `decodeMessage`, `v2/session.ts` `messages()`) go through this seam.

Trade-off evaluation (brief labels):

- **(a) Encoded store + decode on read — CHOSEN.** Persist the encoded form (millis); reconstruct the type form at the consumption boundaries via a targeted, position-explicit `revive` (declared timestamp fields only) plus a tolerant read-model decode for already-poisoned rows. Round-trip is exact; live path untouched; decode risk confined to schema-declared positions.
- **(b) Projectors decode ISO→DateTime at construction — REJECTED.** Scatters a decode/coerce call across every construction and update site (~15 sites in `session-message-updater.ts` + `projectors-next.ts`, plus every future site — each one a chance to forget), and it does nothing for rows already poisoned in `SessionMessageTable.data` (the mixed live+replay corruption path), so reads would still throw.
- **(c) Symmetric `encodeDateTimes`/`decodeDateTimes` around the persistence boundary — REJECTED.** A generic inverse walk cannot distinguish an ISO-looking content string (e.g. tool output echoing a timestamp) from a real timestamp field — it would rewrite user-visible text/tool output. It also runs the decode on the live path needlessly. (a) achieves the same round-trip with the decode confined to declared positions.

Other rejected alternatives:

- *Full `def.schema` decode on replay*: strips undeclared fields (verified) — silent data loss.
- *Widen `DateTimeUtcFromMillis`' encoded side to accept ISO strings*: widens the OpenAPI/SDK wire contract (`effectPayloads()` feeds the global SSE schema) to paper over a storage bug.
- *Fix at emitters (pass millis everywhere)*: constructors reject millis; would touch every construction site and every consumer of `message.time.created`.

Wire-shape note (accurate scope): the fix normalizes the `ProjectBus.publish` path (`sync/index.ts:338`) — replayed events there publish millis instead of ISO. The `GlobalBus` `sync` envelope (`sync/index.ts:345-356`) is deliberately unchanged: it spreads the original `event`, so — as today, on BOTH live and replay — its `syncEvent.data` reaches SSE consumers as ISO strings (JSON serialization of `DateTime`/raw). Envelope consumers that feed `syncEvent` back into `sync.replay` are covered by `revive`. Aligning the envelope to the encoded form is a possible follow-up, not part of this fix.

## 4. Exact Changes

**1. `packages/opencode/src/sync/index.ts`**

- `Definition` type: add `readonly revive?: (data: unknown) => unknown`.
- `define()`: accept and pass through `revive`.
- `process()`:
  - Before the transaction: `const data = def.revive ? def.revive(event.data) : event.data`.
  - `projector(tx, data, event)` (was `event.data`).
  - `EventTable` insert: `data: encodeDateTimes(data) as Record<string, unknown>` (was raw `event.data`). Re-persisting in encoded form applies only to events that pass the seq guard (`event.seq > latest` — the receiving-instance/`syncHistory` case); a same-instance replay of an already-recorded event early-returns at `sync/index.ts:87` and is never re-persisted. The durable backward-compat mechanism is `revive` accepting `DateTime | millis | ISO` at the projector boundary — see §5.
  - Publish: `convertEvent(def.type, data)` (was `event.data`) so replayed events publish millis.
  - GlobalBus `sync` envelope (`sync/index.ts:345-356`) unchanged — it spreads `event`; JSON serialization at the SSE boundary encodes DateTime → ISO, and `revive` tolerates both forms on the way back.
- Replace the wrong assumption at `sync/index.ts:334-337` with the canonical-form contract: "EventTable stores the encoded form (epoch millis). Raw `DateTime` instances do NOT round-trip (`toJSON` → ISO string); `def.revive` reconstructs the type form for projectors on replay."
- Update the `encodeDateTimes` JSDoc: now used for storage as well as publish.

**2. `packages/opencode/src/v2/schema.ts`**

- Add `reviveDateTimeUtc(value: unknown): DateTime.Utc`:
  - `DateTime.isDateTime(value)` → `DateTime.isUtc(value) ? value : DateTime.toUtc(value)` — `isDateTime` narrows to `DateTime` (`Utc | Zoned`, `DateTime.d.ts:24,239`), which is NOT assignable to the declared `DateTime.Utc` return type; `isUtc` (`:267`) / `toUtc` (`:618`) keep the branch typecheck-clean.
  - finite number → `DateTime.makeUnsafe(value)`.
  - string → `const millis = new Date(value).getTime()`; throw a clear error (`unparseable timestamp "..."`) if not finite; else `DateTime.makeUnsafe(millis)`.
  - anything else → throw with the received value in the message (fail loud; the row is genuinely corrupt).

**3. `packages/opencode/src/v2/event.ts`**

- `define()`: pass `revive: reviveEventTimestamp` into `SyncEvent.define`. `reviveEventTimestamp` lives in `packages/opencode/src/v2/event.ts` as a module-local helper next to `define()` (not exported — exercised through the public replay path), using `reviveDateTimeUtc` from `./schema`. It shallow-copies record-shaped data and replaces `data.timestamp` (no-op when `timestamp` is absent). One wiring covers every V2 event — all spread `Base.timestamp`.

**4. `packages/opencode/src/v2/session-message.ts`**

- Extend `normalizeForDecode`: FIRST revive string values at `time.created|completed|ran|pruned` (top level and `content[].time.*`) to epoch millis via `Date.parse` (finite-validated; unparseable strings left untouched so the schema error stays precise), THEN run the existing assistant tool-input pass. The time revival must apply to ALL message types — restructure the current `type !== "assistant"` early return so the revival runs before it.

**5. Tests**

Shared replay mechanism (applies to every case below): live emission advances `EventSequenceTable` (`sync/index.ts:304-315`), so replaying captured history rows back on the same instance early-returns at `sync/index.ts:87` (`event.seq <= latest`) — and re-inserting an existing `EventTable` row would hit the `event.id` primary key (unique, `sync/event.sql.ts:10`, no `onConflictDoNothing`). Every replay case therefore POSTs a **crafted** `ReplayEvent`:

- `id`: fresh unique id (e.g. `EventID.ascending()` from `@/sync/schema`) — avoids the `EventTable` PK conflict;
- `seq`: `latest + 1` (read from `EventSequenceTable`, or captured-history max seq + 1) — passes the seq guard so `process()` actually executes the payload;
- `type`: the versioned registry key as stored by `EventTable` (e.g. `session.next.synthetic.1`, `session.next.step.ended.1`);
- `aggregateID`: the real session id; `data.timestamp`: an ISO string (the legacy wire form).

(Fallback alternative — capture history, then clear `EventSequenceTable` + `EventTable` + `SessionMessageTable` for the aggregate before replaying fresh-id events — considered, not used; the crafted-event form is smaller.)

Prerequisites (all cases): `Flag.OPENCODE_EXPERIMENTAL_WORKSPACES = true` (else `EventTable`/`EventSequenceTable` are never written — `sync/index.ts:304` — and `/sync/history` returns nothing); live emits run inside `WithInstance.provide({ directory, fn })` (publish requires instance context, `sync/index.ts:329-331`); `sessionID` is a real branded `SessionID` from `Session.create` (the message constructors validate it).

- `packages/opencode/test/server/httpapi-sync.test.ts`:
  - "stores V2 event timestamps in encoded form": live-emit `SessionEvent.Synthetic.Sync` (DateTime timestamp) → `history` → assert the stored row's `data.timestamp` is a number (encoded store).
  - "replays a crafted ISO-timestamp V2 event": POST the crafted event (fresh id, seq = latest+1, ISO `timestamp`) → before the fix the projector constructor throws and the replay request fails; after the fix it returns 200 and `SessionMessageTable` holds the synthetic message with numeric `data.time.created`.
  - "replayed update events persist millis (mixed live+replay)": live `Step.Started` → crafted fresh-id `Step.Ended` replay with ISO timestamp → assistant row `time.completed` numeric (exercises the immer produce path + `getCurrentAssistant` decode of a live-written row). The crafted payload must carry the full declared shape — `sessionID`, `timestamp`, `finish` (string), `cost` (number), `tokens: { input, output, reasoning, cache: { read, write } }` (`session-event.ts:129-148`; `snapshot` optional) — because the produce path assigns without validation, so an incomplete payload (e.g. `tokens` missing `cache`) persists silently and only fails later at `decodeMessage`.
  - "tolerates a poisoned read-model row": poison an existing assistant row's `data.time.created` to an ISO string via direct DB update → a replayed `Step.Ended` must not throw (`normalizeForDecode` revival) and re-encodes the row numeric.
- `packages/opencode/test/v2/session-message.test.ts` — **NEW FILE** (does not exist today): unit tests for the `normalizeForDecode` time revival across user/assistant/shell/compaction row shapes.
- `packages/opencode/test/v2/projectors-next.test.ts` — exists but is registry-only today; extend it with a DB fixture to actually exercise a projector, asserting revived timestamps reach the updater as `DateTime.Utc`.

Constraints confirmed: no new dependencies; no `Schema.Struct` definitions moved across modules (Effect Schema cross-file identity rule); only existing Effect v4 APIs — `DateTime.isDateTime` (`sync/index.ts:279`) and `DateTime.makeUnsafe` (`v2/session.ts:605`) are already used in this tree.

## 5. Backward Compatibility

- Existing `EventTable` ISO rows: tolerated by `revive` (ISO → `DateTime.Utc`) whenever they are replayed with `seq > local latest` (the receiving-instance/`syncHistory` case) — such replays re-persist the row in encoded (millis) form. Same-instance replays early-return (`sync/index.ts:87`) and leave the stored row untouched; that is safe because `EventTable.data` is only ever consumed through the replay path (where `revive` runs), never through the strict message decode. No migration required.
- Existing `SessionMessageTable` ISO rows: tolerated by the `normalizeForDecode` revival; the next write of the same message re-encodes to millis (self-healing on first touch).
- Wire/SDK contract unchanged: `effectPayloads()`/OpenAPI still declare millis; no schema changes → **no SDK regen**, `packages/app` unaffected.
- V1 events: no `revive` hook; their data is millis-native so `encodeDateTimes` is a no-op — zero V1 storage/publish change.
- Projector invariant (document in `sync/index.ts`): projectors must read the `data` argument, not `event.data` — `projectors-next.ts` already complies.

## 6. Regression Test

As listed in §4.5. Under the crafted-event mechanism (fresh id, seq = latest+1, ISO `timestamp`), `process()` genuinely executes the replayed payload: before the fix the projector constructor throws (`Expected DateTime.Utc, got "2026-..."`) and the replay request fails; after the fix it returns 200 and the projected rows carry numeric timestamps. The poisoned-row case reproduces the mixed live+replay corruption and locks the tolerant decode.

## 7. Verification Commands

```powershell
cd packages/opencode
bun test test/server/httpapi-sync.test.ts
bun test test/v2/session-message.test.ts
bun test test/v2/projectors-next.test.ts
bun typecheck      # tsgo; delete stale *.tsbuildinfo first if confusing errors appear
bun run lint       # grep output for "no-unused-vars" and ": error "
```

No SDK regen needed (no schema/OpenAPI change). Full-suite runs follow the order-dependent-failure rules in the root AGENTS.md.

V1 no-change check: the existing first case ("serves sync routes") replays captured V1 `session.created` rows and must keep passing unchanged — its captured-row replay early-returns on the seq guard and `encodeDateTimes` is a no-op on V1 millis data, confirming the V1 path is untouched.

## 8. Impact / Callers Notes

- `process()` is the single chokepoint — callers: `run()` (every emitter: `session/processor.ts`, `session/loop/create-user-message.ts`, `session/session.ts`, `session/compaction.ts`, `v2/session.ts`) and `replay()` (`control-plane/workspace.ts` syncHistory + SSE loop, `server/routes/instance/httpapi/handlers/sync.ts`). All paths get the fix without touching call sites.
- Anchor correction vs §2: the `Prompted.Sync` run call is `session/loop/create-user-message.ts:499` and its `timestamp` value line is :501 (§2's anchor cited the timestamp line but omitted the `loop/` path segment). Both lines cited: :499 = run call, :501 = timestamp value.
- `encodeDateTimes` external caller: `projectors-next.ts:17` (`encodeMessageData`) — semantics unchanged (DateTime → millis; strings still pass through, now only reachable for genuinely non-timestamp strings).
- `normalizeForDecode` callers: `projectors-next.ts:12` and `v2/session.ts` `messages()` — both gain tolerance; neither changes shape.
- GitNexus MCP is not indexed for this repo (per root AGENTS.md Notes — verify with `list_repos` before relying on graph tooling); caller analysis above was done via grep.
- Risk: `sync/index.ts` `process()` is on every event's critical path; the changes are additive (optional hook + storage encoding) and V1-inert. No HIGH-risk caller surface outside the sync module.

## 9. Out-of-Scope
Replay TOCTOU (finding #2), unbounded delta recording (#3), post-commit publish error isolation (#4) — separate GitHub issues.
---
