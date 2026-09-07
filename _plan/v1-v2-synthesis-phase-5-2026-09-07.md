# V1/V2 Synthesis — Phase 5: message model adoption, engine re-homing, V1 deletion

Date: 2026-09-07
Status: IN PROGRESS — 5a done, 5b done, 5c batch 1 done (dialogs + small routes), 5c batch 2+ pending (session route, plugin api, run/app), 5d/5e/5f pending
Depends on: Phase 4 (complete — commit `9d9fe54bc`, build verified)

## Goal

Finish the synthesis: close the V2 message-model gap, re-home the agent loop behind
`V2Session`, migrate the last V1 consumers, then delete the V1 session surface (HTTP
routes, bus events, service files) so `session/` is single-vocabulary.

## Current state (post Phase 4, verified 2026-09-07)

- **V2 HTTP surface**: 31+ session endpoints under `/api/session*`; all declare
  `ApiNotFoundError` (V1 error-shape parity via `withNotFound`).
- **Remaining V1 HTTP client calls (7)**: acp `prompt` + `command` (need the final
  assistant message with tokens in a synchronous response), and 5 `messages` sites
  (`run/stream.transport.ts:562`, `run/session.shared.ts:156`, TUI `sync.tsx:790`,
  app `sync.tsx:301`, app `layout.tsx:745`) — all feed V1 `MessageV2.WithParts`
  consumers.
- **TUI sync** (`context/sync.tsx`): session-metadata slices are V2-event-fed
  (`session.next.*`); 12 V1 event handlers remain — `message.updated/removed`,
  `message.part.updated(+.batch, .delta, .removed)` feeding the V1 `message`/`part`
  slices, plus `question.*`, `lsp.updated`, `vcs.branch.updated`,
  `server.instance.disposed` (shared infrastructure, staying V1 vocabulary).
- **V2 message model gap**: `SessionMessage` content covers
  `user/synthetic/shell/tool/text/reasoning/agent-switched/model-switched/compaction`.
  V1 part types with NO V2 home: assistant `file` parts, `subtask`, `agent`, `retry`,
  `step-start`/`snapshot` (snapshot survives as assistant `snapshot` field). The
  projectors/message-updater build `SessionMessageTable` purely from `session.next.*`
  events — V1 `message.part.updated` is not consumed.
- **Event wire inconsistency**: `sync.run` publishes raw values; the declared
  `V2Schema.DateTimeUtcFromMillis` (millis) actually arrives as ISO strings over SSE.
  TUI normalizes via `eventTime()` (sync.tsx). Root fix deferred from 4c.
- **Engine**: V1 loop (`session/loop/run-loop.ts` ~279 lines, `processor.ts`,
  `compaction.ts`) is the writer; V2 write methods delegate. `runDeferred` exists but
  no background worker drains it. `promptAsync` forks into the HTTP handler scope.
- **V1 HTTP group**: 28 endpoints still mounted; after Phase 4 their only remaining
  consumers are the 7 calls above + internal Effect-service callers (not HTTP).

## Gap analysis

### 1. Wire format (block 5a)

Schema declares millis; runtime delivers ISO strings. Fixing at publish makes every
V2 event timestamp trustworthy and lets consumers drop normalization.

### 2. Message model reshape (blocks 5c/5d)

V1 `MessageV2.WithParts` (info + `parts[]`, 10 part types) → V2 `SessionMessage`
(typed `content[]`, 9 content types). Missing: assistant `file`, `subtask`, `agent`,
`retry`. 18 consumers read `sync.data.part[messageID]`, 13 read `sync.data.message`.

### 3. Engine ownership (blocks 5f)

V1 loop is the writer; V2 is a facade. Deletion of V1 services requires the loop to
live behind `V2Session` emitting `SessionEvent.*` natively.

## Batches

### 5a — Wire-format integrity (small, do first) — DONE (2026-09-07)

- **Design deviation (evidence-based):** the plan called for encoding through the bus
  schema (`Schema.encodeUnknownSync`), but empirical testing showed it **strips
  fields the schema doesn't declare** — V1 event payloads carry undeclared fields
  consumers read, so full-schema encode would silently drop them. Shipped a targeted
  recursive `DateTime → epoch millis` walk instead (`SyncEvent.encodeDateTimes`,
  exported from `sync/index.ts`), applied to the converted payload right before
  `ProjectBus.publish`. Same pattern the projectors already used
  (`projectors-next.ts` now imports the shared helper — SSOT).
- EventTable still stores RAW data; the walk is idempotent for millis, so replay
  re-publishes correctly. The sync envelope path is untouched (both the TUI
  `useEvent()` and the app `global-sdk.tsx` filter `type: "sync"` out — no consumer).
- **`eventTime()` KEPT (deviation #2):** live events now deliver millis, but legacy
  EventTable rows (experimental-workspaces replay) still hold ISO strings from
  before this fix, and the walk only converts `DateTime` instances — JSON
  round-tripped rows are strings. The TUI normalizer stays as cheap insurance;
  comment updated to describe the new reality.
- **Bonus fix:** the app's `session-trim` does arithmetic on `session.time.*`
  (`bUpdated - aUpdated`, `<= cutoff`) — V1 `session.updated` delivered ISO strings
  while v2 HTTP responses deliver millis (mixed-format NaN). The SDK types declare
  `number`; runtime now matches.
- Bridge comment in `event-bridge.ts` updated (root fix no longer deferred).
- Verification: new millis assertion in the bridge test (`httpapi-session` 12/12);
  `test/v2/` + `httpapi-sdk` 60/60; `cli/cmd/run` + `cli/cmd/tui` 336/336; app
  `test:unit` 469/469; full `test/server/` retains only the documented pre-existing
  pair + provider parallel-load flakes.

### 5b — V2 message model gap closure — DONE (2026-09-07, narrowed scope)

**Census result (per part type, creation sites × consumers × V2 representation):**

| V1 part | Created | UI consumers | V2 representation | Verdict |
|---|---|---|---|---|
| text/file/agent (user) | `create-user-message.ts` reduce | TUI index/dialogs, app prompt | `User.text`/`files`/`agents` | covered |
| subtask (user) | `loop/command.ts:118` | `cli/cmd/export.ts` ONLY (no TUI/app renderer) | **DROPPED** — reduce has no subtask branch | **REAL GAP** |
| text/reasoning/tool (assistant) | processor | everywhere | `Assistant.content` | covered |
| step-start/step-finish/patch (assistant) | processor | app explicitly SKIPS (`SKIP_PARTS`) | none | no consumer → skip |
| compaction (assistant part) | `compaction.ts:686` | TUI index:1331 presence-check only | `Compaction` message class (started/delta/ended events, direct from V1) | covered (auto/overflow/tail_start_id unread by anyone) |
| retry (part) | **DEAD** — zero creation sites | none | `session.next.retried` event + status | N/A |
| snapshot (part) | **DEAD** | none | none | N/A |

**Plan corrections (the census was the decision procedure — it overruled 4 of 5 claims):**
- "assistant `file` items" — wrong: both file-part creation sites are USER messages;
  `User.files` covers them. No work.
- "`retry` item" — YAGNI: `RetryPart` is a dead type; retry UX flows via the
  `session.next.retried` event + session status, both already in V2. No work.
- "`agent` part representation" — already done: `User.agents` + `AgentSwitched`
  message class. No work.
- compaction part fields (`auto`/`overflow`/`tail_start_id`) — no consumer reads
  them (TUI renders a divider on presence). No work.
- "nested session link" in subtask — speculative: `SubtaskPart` carries no session
  ID (child link lives on the child session's `parent`).

**Remaining 5b work (one change): subtask preservation in the V2 prompt projection** — SHIPPED
- `session-prompt.ts`: `SubtaskAttachment` class (agent/description/prompt +
  optional model/command) + optional `subtask` on `Prompt`.
- `create-user-message.ts`: `subtask` branch in the prompt reduce (mirrors the
  file/agent branches; builds a `SubtaskAttachment` instance).
- `v2/session-message.ts`: optional `subtask` on the `User` class.
- `v2/session-message-updater.ts`: passes `subtask` through in the prompted handler.
- SDK regenerated; typecheck clean in both `opencode` and `app` (stale
  tsbuildinfo cleared first).
- Characterization test: `prompted event with subtask stores subtask on user
  message` (`test/v2/session-message-updater.test.ts`, 5/5). Note: the event
  payload must carry a `SubtaskAttachment` INSTANCE — `new SessionMessage.User()`
  validates nested class fields strictly (plain objects throw; same latent
  replay caveat as files/agents, pre-existing).
- No bridge extension needed: subtask rides the existing `session.next.prompted`
  event; compaction/retry events already flow directly from V1 code.
- Suite status: `test/v2/` + `test/session/` show only pre-existing timing flakes
  (baseline-verified via stash: identical failure sets, different victims per
  run); server key suites retain only the documented 404-responseStyle failure;
  run+tui 336/336.

### 5c — Message model adoption (consumers) — IN PROGRESS (2026-09-07)

**Shipped in batch 1 (5c-0 + 5c-1 + 5c-2 + small routes):**
- **5c-0 model extension (prerequisite found by consumer census):** the TUI reads
  `message.agent`/`message.model` (agent color rendering, prompt state restore) —
  V2 `User` lacked both. `session.next.prompted` now carries `agent` + `model`
  (`Modelv2.Ref`); `User` class + updater + TUI handler pass them through; SDK
  regenerated. `create-user-message.ts` publishes them (same reshape as
  ModelSwitched: `{id: modelID, providerID, variant: variant ?? "default"}`).
- **5c-1 dual-load (strangler fig):** `sync()` now also loads
  `v2.session.messages` into the `messages` slice (newest-first, matching the
  `session.next.*` unshift order) alongside the V1 `message`/`part` load. V1
  consumers unaffected.
- **5c-2 dialog group:** `dialog-message`, `dialog-timeline`,
  `dialog-fork-from-timeline`, `dialog-usage` all read the V2 slice now. Shared
  `fromUserMessage()` helper in `component/prompt/part.ts` restores a V2 user
  message into the composer (text + files + agents). Known data loss: V2
  `FileAttachment` drops the `path`/`type` the V1 `FileSource` union requires, so
  file-part `source` ranges are not restored (the @-mention text survives inside
  `msg.text`). dialog-usage maps `state.structured`→tool counts via
  `content[].name`; model key from `model.providerID`/`model.id`.
- **Small routes:** `subagent-footer` (tokens/cost with `?? 0` guards — V2 tokens
  optional), `permission` (tool input lookup via message content; string-input
  guard for pending state), `prompt/index` (lastUserMessage = first user item in
  newest-first slice; model reshape `{id}`→`{modelID}` for `local.model.set`).

**Remaining for 5c (next batches):**
- `routes/session/index.tsx` — the big one: UserMessage/AssistantMessage rebuild
  on V2 shapes, tool-renderer adapter (V2 `AssistantTool` → V1 `ToolPart`:
  `structured`→`metadata`, `content[].text` join→`output`, `time.pruned`→
  `time.compacted`), transcript formatter (`formatTranscript` takes V1
  `{info, parts}` pairs), scroll navigation, Task subagent view, revert prompt
  restore (→ `fromUserMessage`).
- `plugin/api.tsx` — public plugin surface (`messages()`/`part()`): decide V2
  shapes vs adapter; own batch.
- `context/sync.tsx` `status()` — reads `store.message` for last-message role.
- Run reducers (`session.shared.ts`, `stream.transport.ts`) + app
  (`context/sync.tsx:301`, `pages/layout.tsx:745` prefetch).
- Delete V1 `message.*` handlers + `message`/`part` slices + V1 load (last).

**Verification (batch 1):** typecheck clean in `opencode` + `app` (tsbuildinfo
cleared after SDK regen); tui+run+v2+bridge suites 381/381.

**Shipped in batch 2 (2026-09-07):**
- **TUI `context/sync.tsx` `status()`** — reads the V2 `messages` slice now.
  Parity note: the V1 slice only held user/assistant messages; the V2 slice also
  holds shell/synthetic/compaction records, so `status()` filters to the newest
  user/assistant message to keep working/idle semantics identical.
- **run `session.shared.ts`** — `resolveSession` fetches `v2.session.messages`
  (newest-first, no limit param — `sessionHistory()` slices); `SessionMessages`
  type is now `SessionMessage[]`; `turn()`/`prompt()` read the inline V2 fields
  (`text`/`files`/`agents`, `model.{id,providerID,variant}`). Span derivation
  (`take`/`add`) kept as fallback; stored V2 `FileAttachment.source` ranges are
  reused directly (new fidelity win — covered by a new test). Part emission
  order is now files-then-agents (V2 schema field order — V1's part-array
  interleaving order is not preserved by the V2 model).
- **Tests**: `test/cli/run/session.shared.test.ts` + `variant.shared.test.ts`
  fixtures ported V1→V2 with assertions unchanged (parity proof); new test for
  stored-source reuse. A duplicate characterization file written during the
  migration was deleted — the existing suite is the canonical coverage (DRY).

**Deferred with reasons (census-driven scope corrections):**
- **run `stream.transport.ts:562`** — the fetch feeds `bootstrapSubagentCalls`,
  whose downstream replay pipeline is V1 event vocabulary end-to-end
  (`message.updated`/`message.part.updated` child events). Converting the fetch
  alone would be cosmetic; the pipeline re-vocabularies with 5e/5f.
- **app `context/sync.tsx:301` + `pages/layout.tsx:745`** — the app message
  pipeline is V1-shaped end-to-end (`{info, parts}` pairs, `message`/`part`
  slices, optimistic merge, `x-next-cursor` prefetch). This is the app's
  equivalent of the TUI session-route migration — its own batch, not a
  mechanical swap. The plan's original "5 mechanical call sites" assumption was
  wrong; the census overruled it.
- **TUI `sync.tsx:791` V1 load** — still feeds the V1 slices until
  `session/index.tsx` migrates (5c final deletes it).

**Pre-existing breakage noted:** `test/cli/run/stream.transport.test.ts` fails
with 8 timeout failures IDENTICAL with and without batch 2 (stash-verified) —
broken on this branch independent of this work.

**Verification (batch 2):** typecheck clean in `opencode` + `app`;
session.shared+variant.shared 11/11; `test/cli/cmd/run/` 287/287; tui 49/49;
v2 33/33.

### 5d — acp prompt/command (last 2 V1 prompt sites)

- Extend the V2 sync `prompt` response to carry the final assistant message
  (tokens/cost/finish) — e.g. success becomes the assistant `SessionMessage` or an
  `{user, assistant}` pair; OR restructure ACP to read usage via
  `sendUsageUpdate`'s data source. Decide by what `buildUsage` minimally needs.
- Migrate `acp/agent.ts` prompt + command; V1 `prompt`/`prompt_async` endpoints then
  have zero HTTP consumers.

### 5e — Engine re-homing (highest risk)

- Port `runLoop`/`processor`/`compaction` behind `V2Session` so the loop emits
  `SessionEvent.*` natively (deletes the bridge's reason to exist).
- Wire the deferred-delivery background worker (drain `runDeferred` queue on
  instance start; `promptAsync` fork moves from HTTP-handler scope to the worker
  scope so it survives request completion).
- Characterization tests first (Rule 3): the loop has partial coverage via
  `test/session/` + `test/v2/`; extend before moving code.
- The blueprint in the phase-4 plan's `_plan/` reference decomposes runLoop into
  `ToolExecutor` + `CompactionPolicy` + `PromptAssembler` + `SubtaskRouter` +
  `AgentLoop` orchestrator — reuse it.

### 5f — V1 deletion

- Delete the V1 session HTTP group (28 endpoints) + its handlers once 5c/5d land.
- Delete the dual-published V1 bus events the TUI no longer handles
  (`session.updated/deleted/status`, `todo.updated`, `session.diff`,
  `permission.asked/replied`, `message.*`) — keep `question.*`, `lsp.updated`,
  `vcs.branch.updated`, `server.instance.disposed` (permanent V1 vocabulary).
- Delete the event bridge (5e makes it redundant) and the no-op projectors.
- Legacy JSON `Storage.Service` removal + backfill tooling.
- `packages/web` SDK docs (10 locale mdx files) — documentation task.

## Verification (per batch)

```bash
cd packages/sdk/js && bun script/build.ts     # when endpoints/events change
rm -rf packages/app/node_modules/.ts-dist packages/sdk/js/tsconfig.tsbuildinfo
bun run --cwd packages/opencode typecheck && bun run --cwd packages/app typecheck
cd packages/opencode && bun test test/v2/ test/server/ test/cli/cmd/run/ test/cli/cmd/tui/
cd packages/app && bun run test:unit
# full build (user-run) + TUI smoke at batch boundaries
```

Known pre-existing failures (not caused by this work, stash-verified):
`provider HttpApi > serves OAuth authorize response shapes`,
`v2 SDK error shape > 404 with responseStyle data…`; provider `it.live` tests flake
at the 5s timeout under full-suite parallel load.

## Risks

| Risk | Mitigation |
|---|---|
| Encode-at-publish changes wire shape for consumers mid-rollout | Only V2 timestamp fields transform; ship 5a + `eventTime()` removal atomically; SDK already declares millis |
| Replay path double-encodes | Store raw in `EventTable`; encode only at publish; add a replay test |
| Model-gap decisions are lossy (subtask/agent/retry semantics) | Census consumers first; additive content items; keep V1 slices until 5c |
| Engine re-homing destabilizes the loop | Characterization tests before extraction; batch behind the `AgentLoop` orchestrator seam; build + smoke between sub-steps |
| `promptAsync` scope change orphans running loops | Move the fork to the deferred worker scope with explicit shutdown; test cancel-on-dispose |
| Deleting V1 events before all consumers migrate | Deletion gated on grep census + typecheck (receiver-type guarantee); delete per event family |
| Order-dependent test failures mask regressions | Run full suites per batch; compare against the documented pre-existing failure list |

## Out of scope

- `question.*`/`lsp`/`vcs` event vocabulary migration (permanent V1 — shared
  infrastructure, no V1/V2 duality).
- Permission/model engine changes beyond what re-homing requires.
- New TUI features on the V2 model (adoption only, no behavior changes).
