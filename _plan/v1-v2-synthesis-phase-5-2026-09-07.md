# V1/V2 Synthesis — Phase 5: message model adoption, engine re-homing, V1 deletion

Date: 2026-09-07
Status: IN PROGRESS — 5a/5b/5c/5d done, 5e-1 + 5e-2 + 5e-3 done (shared engine re-homed behind V2Session, legacy message compatibility added), binary regression guard DONE (2026-09-08), app pipeline batch DONE (2026-09-08, Option A: V1-shaped store + V2→V1 adapter), 5f consumer migration DONE (2026-09-08), 5f deletions explicitly deferred
Depends on: Phase 4 (complete — commit `9d9fe54bc`, build verified)

## Goal

Finish the synthesis: close the V2 message-model gap, re-home the agent loop behind
`V2Session`, migrate the last V1 consumers, then delete the V1 session surface (HTTP
routes, bus events, service files) so `session/` is single-vocabulary.

## Current state (post Phase 5 consumer migration, verified 2026-09-08)

- **V2 HTTP surface**: 31+ session endpoints under `/api/session*`; all declare
  `ApiNotFoundError` (V1 error-shape parity via `withNotFound`).
- **Core V1 HTTP client calls are migrated**: ACP prompt/command, run history
  bootstrap, run session history, TUI/app message loads, and app layout prefetch
  now use V2 session endpoints. The standalone `github/` action remains outside
  the Bun workspace and still uses its own V1 SDK client.
- **TUI sync** (`context/sync.tsx`): message/session metadata is V2-backed and
  native `session.next.*`-fed. `question.*`, `lsp.updated`, `vcs.branch.updated`,
  and `server.instance.disposed` remain V1-vocabulary infrastructure events.
- **V2 message model gap**: consumer-relevant content is covered by
  `SessionMessage` (`user/synthetic/shell/tool/text/reasoning/agent-switched/
  model-switched/compaction`, including user subtask attachments). Legacy-only
  step parts and retry/snapshot details have no active renderer consumer; native
  step/retry metadata remains in `session.next.*` events.
- **Event wire format**: live `sync.run` publication now recursively encodes
  `DateTime` values to epoch millis. `eventTime()` remains as compatibility insurance
  for legacy EventTable replay rows that may still contain ISO strings.
- **Engine**: the shared V1 loop (`session/loop/run-loop.ts` ~279 lines,
  `processor.ts`, `compaction.ts`) remains the writer behind `SessionPrompt.Engine`;
  V2 write methods delegate to that engine. Deferred prompts are drained by a
  layer-scoped worker; `promptAsync` stages through V2 and no longer owns the worker
  fiber in the HTTP handler scope.
- **V1 HTTP group**: 28 endpoints remain mounted intentionally. Their consumer
  migration is complete; the route/service/event deletion pass is deferred by the
  user and tracked in 5f.

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

### 5c — Message model adoption (consumers) — COMPLETE (staged batches through 2026-09-08)

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

- ~~`routes/session/index.tsx`~~ — DONE in batch 4 (see below).
- ~~`plugin/api.tsx`~~ — DONE in batch 3 (V2 shapes; `part()` removed — breaking).
- ~~`context/sync.tsx` `status()`~~ — DONE in batch 2.
- Run reducers (`stream.transport.ts`) + app
  (`context/sync.tsx:301`, `pages/layout.tsx:745` prefetch) — the app pipeline
  batch (deferred, V1-shaped end-to-end).
- ~~Delete V1 `message.*` handlers + `message`/`part` slices + V1 load~~ —
  DONE in 5c final (see below).

**Shipped in 5c final (2026-09-08) — V1 message/part slices deleted:**
- **`context/sync-schema.ts`** — `message: {[sessionID]: Message[]}` and
  `part: {[messageID]: Part[]}` removed from `SyncStore`; `Message`/`Part`
  imports dropped.
- **`context/sync.tsx`** — six V1 event handlers deleted
  (`message.updated`, `message.removed`, `message.part.updated`,
  `message.part.updated.batch`, `message.part.delta`,
  `message.part.removed`); store init fields removed; `session.sync()` no
  longer fetches `sdk.client.session.messages` (V1) — V2-only fetch
  (`v2.session.get/todo/diff/messages`); `Message`/`Part` imports dropped.
  Note: the deleted V1 `message.updated` handler carried a 100-message cap
  with part cleanup — the V2 slice has no cap (the V2 load fetches all
  messages; slice growth is a separate concern, not a regression of this
  deletion).
- **Consumer census (pre-deletion):** zero readers of `store.message` /
  `store.part` / `data.message` / `data.part` outside sync.tsx itself (the
  run CLI's `data.part` is its own session-data reducer Map, unrelated).
- **Milestone:** prompt and command consumers were removed from the opencode
  package, but one V1 `session.messages` consumer remains in
  `cli/cmd/run/stream.transport.ts` for the interactive run bootstrap. The app's
  two deferred `session.messages` calls were subsequently migrated by the app
  pipeline batch below. The V1 endpoints themselves remain pending for 5f.
- **Verification (5c final):** typecheck clean in `opencode`; tui 91 pass +
  the 1 pre-existing flake; `test/cli/cmd/run/` 287/287; v2+httpapi-session
  45/45; TUI smoke: fresh boot + `bun dev -c` reopen — prior session history
  renders via the V2-only `session.sync()` path; log shows only the
  pre-existing unrelated `[editor-zed] parseJson` errors.

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

**Shipped in batch 3 (2026-09-07) — plugin API on V2 shapes (user decision):**
- **`packages/plugin/src/tui.ts`** — `session.messages()` now returns
  `ReadonlyArray<SessionMessage>` (V2 union); **`state.part(messageID)` is
  REMOVED** — the V2 model has no per-message part slice (content is inline on
  the message). BREAKING for external TUI plugins: read `message.content`
  (assistant) / `message.text`+`files`+`agents` (user) instead.
- **`plugin/api.tsx`** — `messages()` reads the V2 `messages` slice; `part()`
  deleted.
- **`sidebar/context.tsx`** (only in-repo plugin consumer) — V2 mapping
  (`type === "assistant"`, `model.{providerID,id}`, `?? 0` token guards — same
  pattern as subagent-footer/prompt-index).
- **`test/fixture/tui-plugin.ts`** — `part` field dropped from the fixture state.
- Verification: plugin + opencode typechecks clean; tui 49/49; `test/cli/tui/`
  retains 1 pre-existing order-dependent flake (`does not use npm package main
  for tui entry` — stash-verified identical baseline).

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

**Shipped in batch 4 (2026-09-08) — `routes/session/index.tsx`, the last TUI V1
slice consumer:**

- **`util/transcript.ts` rewritten to V2** (small, self-contained — migrated
  directly instead of adapting): `formatTranscript(session, messages:
  SessionMessage[], options)`; `formatMessage(msg, options, providers?)`;
  `formatUserContent` (text + file/agent attachment lines);
  `formatAssistantHeader` (now exported for tests; `model.providerID`/`model.id`);
  `formatAssistantContent` (content items; tool output = text content items
  joined; tool error = `state.error.message`). `MessageWithParts` type deleted.
- **`messages` memo** — `(sync.data.messages[route.sessionID] ??
  []).toReversed()` (oldest-first) so all `findLast`/scan/id-comparison logic
  keeps V1 semantics; rendering order unchanged. The V2 slice also holds
  shell/synthetic/compaction/agent-switched records the V1 slice never had —
  the rendering loop skips them; compaction renders as a " Compaction " divider
  `<Match>` in the loop (replaces the old UserMessage compaction-part check).
- **`contentPartFromV2` adapter** — V2 content items → V1-shaped
  `ToolPart`/`TextPart`/`ReasoningPart` so the ~15 tool renderers stay
  untouched: `structured`→`metadata`, text content join→`output`,
  `time.{created,completed,pruned}`→`state.time.{start,end,compacted}`,
  pending string input→`{input: {}, raw}`, error→`state.error.message`,
  `callID` = item id, text box id synthesized `${message.id}-text-${index}`
  (V2 `AssistantText` has no id). Also removed the old `part={part as any}`
  Dynamic cast (replaced by one documented cast on the component union —
  SolidJS `Dynamic` cannot join component/prop unions).
- **Component prop migration** — `UserMessage{message: SessionMessageUser}`
  (text/files inline; file badge `file.name`); `AssistantMessage{message:
  SessionMessageAssistant, sessionID, last}` (V2 messages carry no sessionID —
  passed down; duration via newest-first slice position instead of `parentID`;
  model via `model.{providerID,id}`); `ReasoningPart`/`TextPart`/`ToolPart`
  take `message: SessionMessageAssistant` + `sessionID` (permission getter
  reads `props.sessionID`).
- **Abort detection heuristic** — V1 checked the stable
  `error.name === "MessageAbortedError"`; V2 `UnknownError` is
  `{type: "unknown", message}` with a DOMException-derived message. Now:
  case-insensitive `"abort"` substring on `error.message` (documented; false
  positive only restyles the footer as "interrupted").
- **Command migrations** — revert prompt restore → `fromUserMessage()` (shared
  helper); jump-to-last-user + scroll navigation read the V2 slice (newest-first
  iteration); copy-last-assistant joins text content items; Task subagent view
  reads `sync.data.messages` + inline content tools.
- **Test port** — `test/cli/tui/transcript.test.ts` V1→V2 (18 tests, assertions
  preserved; synthetic-text-skip test dropped — V2 content has no synthetic
  flag; file-attachment test added for `formatUserContent`).
- **Deviations (documented):** footer shows `agent` instead of `mode` (V2 has
  no mode); Task view running-tool label degrades from `tool + title` to just
  the tool name (V2 tool states carry no `title`); V2 completed-state
  `attachments` (PromptFileAttachment) not mapped to V1 `FilePart` — no
  renderer reads it.
- **Verification (batch 4):** typecheck clean in `opencode` + `app`;
  transcript 18/18; `test/cli/cmd/run/` 287/287; v2+httpapi-session 45/45;
  `test/cli/tui/` 91 pass + the 1 pre-existing flake (stash-verified
  identical baseline); TUI smoke: mounts, prompt submit + retry/status footer
  live (LLM quota exhausted mid-smoke — assistant render covered by transcript
  tests + typecheck).

### 5d — acp prompt/command (last 2 V1 prompt sites) — DONE (2026-09-07)

**Design decision (Option A — pair response):** `buildUsage` needs only the final
assistant message's tokens, and the V2 sync prompt runs the loop synchronously —
the assistant message is already projected when the call returns. Both the V2
`prompt` and `command` endpoints now return `{user?, assistant?}` (projected
user message + final assistant message). Zero consumers read the old shapes
(`run.ts` ignores the response; command was `NoContent`), so the change is
consumer-safe.

- **`v2/session.ts`** — `prompt()`/`command()` read back messages once and
  return `{user, assistant}`; the Service interface types updated.
- **`session-prompt.ts`** — `Prompt` gains optional `synthetic: string[]` and
  `ignored: string[]` (ACP audience-routing parity): assistant-only context
  blocks and user-only display blocks. `promptToParts` emits them as
  synthetic/ignored text parts; the existing reduce routes synthetic →
  `Synthetic.Sync` events and ignored stays display-only on the V1 parts
  (excluded from the LLM payload) — no reduce change needed.
- **HTTP schemas** — prompt success `SessionMessage.Message` →
  `V2PromptResponse{user?, assistant?}`; command success `NoContent` →
  `V2CommandResponse{user?, assistant?}`; command handler returns the pair.
- **`acp/agent.ts`** — prompt + command migrated to `sdk.v2.session.*`:
  V1 parts array → `Prompt{text, files, synthetic, ignored}` conversion
  (text blocks joined "\n", audience-routed blocks into the arrays);
  `buildUsage` reads `response.data?.assistant` with `?? 0` token guards
  (V2 tokens optional); `SessionMessageAssistant` type.
- **SDK regenerated**; both packages typecheck clean (tsbuildinfo cleared).
- **Tests**: v2 session prompt test extended to assert the assistant member
  (28/28); v2 + bridge + sdk + acp suites 156/156.
- **Result: V1 `prompt`/`prompt_async`/`command` HTTP endpoints now have ZERO
  consumers** (TUI run.ts → v2 since 4d; TUI prompt → v2 promptAsync since 4d;
  ACP → v2 now).

### 5e — Engine re-homing (highest risk)

**Census (historical pre-5e snapshot, 2026-09-08):**

- The loop machinery ALREADY emits message-lifecycle `SessionEvent.*` natively
  (`processor.ts`, `create-user-message.ts` → `sync.run`: Prompted, Tool.*,
  Text.*, Reasoning.*, Step.*, Shell.*, Compaction.*, Synthetic, AgentSwitched,
  ModelSwitched). The TUI consumes all of these via `session.next.*`.
- The event bridge (`v2/event-bridge.ts`, 87 lines, wired in
  `project/bootstrap.ts`) translates only 7 NON-loop families from the V1 bus:
  `session.updated/deleted/status`, `todo.updated`, `session.diff`,
  `permission.asked/replied` → `session.next.*`.
- Sources today: `session.ts` patch() → `sync.run(Event.Updated)` (V1
  vocabulary "session.updated", dual-publishes to the V1 bus via `busSchema`);
  `status.ts`/`todo.ts`/`summary.ts`/`revert.ts`/`permission/index.ts` → manual
  `bus.publish` (V1 BusEvent only — the bridge is their ONLY path to the V2
  stream).
- `SyncEvent.run` IS the dual-publish mechanism (projector + V1 bus via
  `busSchema ?? schema` + GlobalBus "sync" → V2 SSE). The V1-vocabulary
  sync events and their projectors are load-bearing (SessionTable) — native
  `session.next.*` publishes are ADDED alongside; V1-vocabulary removal is 5f.
- V1 bus keeps permanent consumers: plugins (`subscribeAll`), V1 SSE endpoint
  (app batch), github.ts, llm.ts (Permission.Replied), share-next, project/vcs/lsp.
- `promptAsync` handler forks `promptSvc.prompt` into a handler-yielded
  `Scope.Scope` (per-request scope in effect httpapi) — the loop may be
  orphaned/dropped at request completion; moves to the worker scope in 5e-1.
- `runDeferred` exists on the V2 service (in-memory `deferredQueue` Set) but no
  background worker drains it; tests/callers trigger it explicitly.
- The "blueprint" (ToolExecutor/CompactionPolicy/PromptAssembler/SubtaskRouter/
  AgentLoop) is a naming in this plan + root AGENTS.md, not a document — 5e-3
  defines its own decomposition after characterization tests.
- `SessionPrompt.Service` consumers: V2 bridge, V1 HTTP handlers (dead
  endpoints, 5f), `cli/cmd/github.ts:434`, `control-plane/workspace.ts:173` —
  the service survives 5f unless those migrate; 5e-3 re-homes only V2Session.

**Batches:**

- **5e-1 — deferred-delivery worker + promptAsync scope — DONE (2026-09-08):**
  - `v2/session.ts` — the layer captures `Scope.Scope` (layer scope);
    `prompt(delivery: "deferred")` now forks `runDeferred(sessionID)` into it
    after the response read-back (fork placed LAST so the drain cannot
    interleave before the caller's result is built — keeps the
    "stages without running synchronously" test deterministic). The queue
    guard makes concurrent drains idempotent; a message staged while the loop
    is busy is consumed by the running loop's continuation check
    (`Runner.ensureRunning` awaits the current run; the loop's continuation
    logic picks up newly staged messages).
  - `handlers/v2/session.ts` promptAsync — migrated from
    `promptSvc.prompt(...)` + `Effect.forkIn(requestScope)` to
    `session.prompt({..., delivery: "deferred"})` (the V2 service). Payload
    stays the V1 `PromptInput` shape (parts) — converted in-handler to the V2
    `Prompt` (same mapping as acp/agent.ts: text join with synthetic/ignored
    split, files flatMap). Staging failures still publish `SessionV1.Event.Error`
    (loop failures publish it themselves at `run-loop.ts:211`). The handler's
    `Scope.Scope` capture removed (no longer forked there); `promptSvc` kept
    (predict handler still uses it).
  - No SDK regen needed (endpoint payload/response schemas unchanged).
  - Tests: new `prompt (deferred) drains via the background worker` (polls the
    stub loop until the worker drains); existing
    "stages without running synchronously" unchanged and deterministic.
    The worker is forked in the layer scope, but a dedicated cancel-on-dispose
    assertion remains a follow-up verification item before the deletion pass.
  - Verification: typecheck clean; v2 session 29/29; httpapi-session 12/12;
    cmd/run 287/287; tui 91 + known flake; TUI smoke: submit → staged →
    worker drained → loop ran → quota error + retry surfaced through the new
    path.
- **5e-2 — native session-lifecycle events, delete the bridge — DONE
  (2026-09-08):**
  - Sources now emit `session.next.*` natively via `sync.run(SessionEvent.*.Sync)`
    alongside their V1 bus publishes (V1 payload shapes untouched — plugins/
    V1-SSE/app keep working): `status.ts` set() → StatusUpdated; `todo.ts`
    update() → TodoUpdated; `summary.ts` summarize() + `revert.ts` →
    DiffUpdated; `permission/index.ts` ask()/reply()/timeout-reject/
    reject-cancels-all/always-approve → Permission.Asked/Replied (local
    `publishReplied` helper for the 4 reply sites; PermissionID Newtype →
    plain string via double cast — the V2 def declares plain string);
    `session.ts` patch() → Updated, remove() → Deleted (gated on instance
    presence exactly like the V1 publish).
  - **Layer ripple handled at the source**: the 4 modified services require
    `SyncEvent.Service`, so their `defaultLayer`s self-provide
    `SyncEvent.defaultLayer` (memoMap dedups to one instance per build) —
    zero ripple for existing compositions. The 6 test files using RAW
    `layer` got explicit `Layer.provide(SyncEvent.defaultLayer)` pipes.
  - **`v2/event-bridge.ts` DELETED** (87 lines) + bootstrap wiring removed
    (init list + defaultLayer provide). The 7 lifecycle projectors in
    `projectors-next.ts` remain (no-ops — required by SyncEvent.run).
  - **Test updates**: `bridges V1 session lifecycle events to the V2 event
    stream` now exercises the REAL sources — the diff section triggers
    `SessionSummary.summarize()` (seeding a user message row via
    `Session.updateMessage` to pass the `hasMessages` guard) instead of a
    direct V1 bus publish (which no longer reaches the V2 stream — correct
    new behavior).
  - Verification: typecheck clean; httpapi-session 12/12; v2+cmd/run+permission
    green (only the documented pre-existing flakes: reject-cancels,
    removeApproved, skills-sort, processor-abort — stash-verified); TUI smoke:
    history render + prompt submit + status/retry transitions flow natively;
    log clean.
- **5e-3 — re-home the engine behind V2Session** — DONE (2026-09-08):
  - `session/prompt.ts` now exposes `SessionPrompt.Engine` and `engineLayer`.
    The existing `SessionPrompt.Service` is a compatibility facade backed by
    the same engine, so legacy consumers remain supported.
  - `v2/session.ts` now uses `SessionPrompt.Engine` for prompt, shell, skill,
    subagent cancellation, abort, summarize, init, command, and deferred-loop
    execution. V2 no longer requires the V1 `SessionPrompt.Service` facade for
    engine operations.
  - Added legacy-message decoding compatibility: old V2 user rows without
    `agent`/`model` are completed from the session row, with safe fallbacks.
    This fixes the compiled-binary `Missing key at ["agent"]` failure in
    `V2Session.messages()`.
  - **Binary regression guard (2026-09-08):** the post-build
    `Expected object` failure was traced to an active `session_message` row,
    not test source embedded in the binary. A provider had persisted an extra
    JSON-encoded layer in an assistant tool state's `input`, so decoding the
    row failed at `SessionMessage.ToolStateRunning.input`. New tool events are
    normalized to records in `session/processor.ts`; V2 reads/projectors use
    the bounded `SessionMessage.normalizeForDecode()` compatibility pass for
    existing rows. Malformed input degrades to `{}` instead of taking down the
    session history endpoint.
  - Added a regression test for legacy user rows and changed V2 tests to stub
    only `SessionPrompt.Engine`, proving the facade is not a V2 dependency.
  - The remaining `SessionPrompt.Service` consumers (`github.ts`,
    `control-plane/workspace.ts`, and the V1 prediction route) keep the facade
    intentionally; migrating them is outside 5e-3 and can be handled with the
    V1 surface removal in 5f.
  - Verification: opencode/app typechecks passed; V2 session tests 31/31,
    updater tests 6/6; run-loop characterization tests 4/4; app unit tests
    469/469; lint passed; single binary build and `--version` smoke test passed
    (`0.0.0-main-202609081806`).

### App message pipeline batch — DONE (2026-09-08, Option A)

**Design decision (locked after a false start):** the first attempt (Option B)
migrated the app store to the V2 `SessionMessage` model — but the rendering
chain (`packages/ui` DataProvider `Data` type, `session-turn.tsx`,
`message-part.tsx` ~1500 lines) reads the V1 `message`/`part` slices deeply.
Migrating the renderer is its own future batch. **Option A: the store stays
V1-shaped; the pipeline (endpoint + events) migrates to V2 through a
V2→V1 adapter.** Consumers untouched, rendering identical, ~350-line adapter,
O(1) per delta (direct V1 slice maintenance, no projection layer).

**New `context/global-sync/v2-adapter.ts` (pure, tested):**

- `sessionMessagesToV1(messages, sessionID)` — load-path fold over an
  ascending V2 list → `{session: Message[], part: Record<string, Part[]>}`.
  Rebuilds turn structure: assistants get `parentID` = most recent user
  message; shell messages expand into user-wrapper (id = V2 message id,
  synthetic "The following tool was executed by the user" text part) +
  assistant (`${id}:assistant`) + `bash` tool part; compaction messages expand
  into a user wrapper carrying a `compaction` part (the summary text arrives
  via the compaction assistant's own text parts, so compaction.delta/ended are
  no-ops); synthetic comment notes (`parseCommentNote` match) attach as
  synthetic text parts to the latest user message; agent/model-switched are
  skipped (no V1 rendering).
- Part ids: `${messageID}:${index padded to 4}:${kind}` — deterministic across
  load/event paths and id-sort == content order (the V1 slices sort parts by
  id; renderers rely on content order).
- V2→V1 mappings: model `{id, providerID, variant}` → `{providerID, modelID,
  variant?}` (drops "default"); tool states → V1 `ToolState` (pending keeps
  `raw`, running/completed/error map `structured` → `metadata`, content texts
  joined → `output`, timestamps from the tool item); errors `{type, message}`
  → `{name: "UnknownError", data: {message}}`; file attachments → `FilePart`
  with reconstructed `FileSource` (path decoded from the uri); agent
  attachments → `AgentPart`.

**`event-reducer.ts` rewritten:** same `session.next.*` case structure, but
handlers maintain the V1 `message`/`part` slices via Binary.search inserts
(HEAD's insert semantics) + adapter factories. `prompted` calls
`resolveOptimistic(sessionID, text)` BEFORE inserting (evicts the optimistic
entry first — no transient duplicate). Permission cases re-keyed to
`session.next.permission.asked/replied` (payload wraps the V1 request as
`request`). `session.created`, `question.*`, `vcs.branch.updated`, `lsp.updated`,
`server.instance.disposed` unchanged.

**`sync.tsx`:** `fetchMessages` → `client.v2.session.messages` (order "desc",
body cursor; `complete: items.length < limit` — the V2 endpoint always encodes
`cursor.next` for non-empty pages, unlike V1's peek pattern) → adapter → V1
page. `mergeOptimisticPage` confirms by PROMPT TEXT (`messageText` over
non-synthetic text parts, mirroring the server's projection) instead of id —
V2 message ids are event ids, not the client's messageID; one real message
consumes one optimistic entry. Dead `addOptimisticMessage` deleted. The
optimistic resolver is registered via `globalSync.setOptimisticResolver`
(signature: `(directory, sessionID, text)`).

**`layout.tsx` prefetch:** V2 endpoint → adapter → V1 slices + part merging
restored (HEAD behavior, adapter-converted).

**`global-sdk.tsx` coalescing (kept from the false start):** full-state,
idempotent events coalesce (`session.next.status/updated/todo/diff`,
`lsp.updated`, `session.next.tool.progress` per callID). V2 text/reasoning/
compaction deltas are appends applied in order and are never dropped; no
coalescable event shares a target with them, so the V1 stale-delta logic is
gone.

**Known degradations (documented, same as the TUI's V2 behavior):**

- Aborted turns lose the "Interrupted" divider — the V2 `step.failed` payload
  flattens errors to `{type, message}`, losing `MessageAbortedError`; aborted
  turns render the UnknownError bubble instead. Fix belongs server-side
  (carry the error name in Step.Failed) — follow-up.
- Interleaved reasoning blocks are addressed by position (findLast), not
  reasoningID — sequential reasoning (the norm) is unaffected.
- Part-level metadata on synthetic comment notes (preview/origin) is lost;
  `parseCommentNote` fallback recovers path/selection/comment.
- Sessions predating the V2 event system have no V2 projections → empty
  history until the 5f backfill tooling lands (same interim state the
  migrated TUI accepted).

**Verification:** app typecheck clean; opencode typecheck clean; app unit
tests 486/486 (event-reducer ported to `session.next.*` inputs with V1
assertions; new `v2-adapter.test.ts` 8 tests; `sync-optimistic.test.ts`
ported to text-match confirm); lint clean for changed files (3 new dead
variables removed; remaining warnings pre-existing).

## Post-implementation audit (2026-09-08)

- 5a–5e-3 and the app pipeline batch are implemented. Their deviations are recorded in the corresponding batch sections, including publish-time date encoding, retained legacy compatibility, native lifecycle emission, the shared-engine facade, and the Option A V2-to-V1 app adapter.
- 5f consumer migration is complete: `run/stream.transport.ts` reads V2
  projected history and adapts it only at the legacy renderer boundary;
  native `session.next.*` events drive the run reducer without re-processing
  their dual-published V1 counterparts; GitHub and share-next subscribe to V2
  lifecycle/tool events. Share payloads remain V1-shaped at the external
  sharing API boundary for compatibility.
- 5f deletion is intentionally deferred by the user: the V1 HTTP group,
  dual-published V1 definitions, legacy storage/backfill, and web SDK docs
  remain in place until a later deletion pass.
- The binary regressions reported after the build (`Missing key` and `Expected object`) have regression coverage and compatibility normalization. The `Expected object` case was reproduced as a legacy-session boundary issue: `MessageV2.toModelMessages` now normalizes persisted JSON-string tool inputs into records without changing stored rows or new-session object inputs. The build/version smoke passed; a direct `serve` endpoint smoke remains environment-sensitive and is not claimed as passing.
- No-op lifecycle projectors are intentionally retained while the lifecycle `EventV2` definitions and `SyncEvent.run` calls remain.
- Verification follow-ups before 5f deletion: add a direct DateTime/millis replay
  assertion and a dedicated deferred-worker cancel-on-dispose test. Existing replay,
  scope, and binary smoke coverage remains green; these are coverage gaps, not
  observed runtime regressions.

### 5f — V1 consumer migration and deferred deletion

**Consumer migration DONE (2026-09-08); deletion deferred.** The deletion
gate is deliberately left closed because the user requested that 5f
deletions not be performed yet. The migrated consumers now use V2 reads and
native `session.next.*` events:

- `cli/cmd/run/stream.transport.ts` fetches
  `sdk.v2.session.messages({ order: "desc" })`, restores ascending order for
  bootstrap, and converts projected V2 messages at the existing scrollback
  reducer boundary.
- `cli/cmd/run/v2-legacy.ts` adapts native V2 lifecycle/tool/text events to
  the established reducer commit contract. The transport filters equivalent
  V1 message/session/permission events, preventing duplicate output while
  retaining question events and other permanent V1 infrastructure events.
- `cli/cmd/run/event-loop.ts` runs the production non-interactive path in
  explicit native mode, so V1 duplicates are filtered even when V1 publishes
  arrive first; its default mode keeps direct V1 fixture compatibility until
  deletion.
- `cli/cmd/github.ts` subscribes to V2 tool/text events.
- `share/share-next.ts` subscribes to V2 session/lifecycle/tool events and
  performs a coalesced compatibility read for the externally V1-shaped share
  payload.

The V1 HTTP group and V1 definitions remain mounted, so deleting them now
would still be a breaking partial rollout.

- Delete the V1 session HTTP group (28 endpoints) + its handlers once the 5f
  migration/deletion gate is met; 5c/5d alone do not satisfy that gate.
- Delete the dual-published V1 bus events the TUI no longer handles
  (`session.updated/deleted/status`, `todo.updated`, `session.diff`,
  `permission.asked/replied`, `message.*`) — keep `question.*`, `lsp.updated`,
  `vcs.branch.updated`, `server.instance.disposed` (permanent V1 vocabulary).
- Event bridge deletion is already DONE in 5e-2. Remove the lifecycle no-op
  projector registrations only after the corresponding `EventV2` definitions and
  `SyncEvent.run` calls are removed; while native lifecycle events exist, those
  registrations are required by `SyncEvent.run`.
- Legacy JSON `Storage.Service` removal + backfill tooling.
- `packages/web` SDK docs (10 locale mdx files) — documentation task.

**Deviation:** 5f consumer migration is landed without the deletion pass by
explicit user instruction. The remaining deletion items are tracked here,
not silently marked complete.

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
