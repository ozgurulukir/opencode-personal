# Plan: V1/V2 subagent resume model parity (issue #384)

## Goal

Close the resume-branch asymmetry between V1 `TaskTool` and V2 `Session.subagent()`:
both re-sync a resumed child session's permission and agent, but only V2 also
applies the caller's model (`switchModel`). **Decision: option (a) — V1 gains the
model switch**, grounded solely in the code evidence below (issue #384 states no
preference between (a) and (b) — either is acceptable per its AC). V2's behavior
is already correct; its work under (a) is a parity comment, a test assertion, and
docs.

## Context / Problem (verified)

| Evidence | Location |
| --- | --- |
| V1 resume branch: `setPermission` always, `setAgent` when changed, **no model write** | `packages/opencode/src/tool/task.ts:125-130` |
| V1 derived model: `next.model ??` caller assistant's `{modelID, providerID}` | `task.ts:113-116` |
| V1 passes model **per-prompt** to `ops.prompt` (wins in createUserMessage) | `task.ts:170-173` |
| V1 fresh spawn **does** store model | `task.ts:138-141` → `session/session.ts:446` |
| V2 resume branch: `setPermission` always, `switchAgent` when changed, **`switchModel` when `input.model`** | `packages/opencode/src/v2/session.ts:764-773` |
| V2 `switchModel` impl — emits `ModelSwitched.Sync` | `v2/session.ts:689-695` (guard `if (input.model)` at `:770`) |
| V2 `switchAgent` impl — emits `AgentSwitched.Sync` | `v2/session.ts:682-688` |
| V2 prompt passes model only when supplied | `v2/session.ts:812`; V2 create stores `input.model` possibly undefined (`:429`) |
| V1 `Session.Interface` has `setAgent`/`setPermission` but **no `setModel`** | `session/session.ts:367-369` |
| V1 `setAgent`/`setPermission` impl — direct `patch()` (V1 bus + `SessionEvent.Updated.Sync`, no switch event) | `session.ts:643-661, 671-684` |
| Session layer already captures `sync` and imports `SessionEvent` + `DateTime` | `session.ts:415-421, 20-21` |
| V1 row **self-heals at prompt start**: resolution → differs-check → `ModelSwitched.Sync` | `session/loop/create-user-message.ts:74, 105-119` |
| That event is what updates `SessionTable.model` + adds the `SessionMessageTable` timeline row | `session/projectors-next.ts:172-178` |
| Row is a **live fallback** for future prompts (`agent.model ?? row ?? provider default`) | `session/loop/model.ts:46-60` |
| Projectors are registered for **all tests** (`bunfig.toml:4` preload → `test/preload.ts:88,96`) | so `ModelSwitched.Sync` emissions update rows in tests |
| Default agents (`general`/`build`/`plan`) define **no model** → V1 test derivation falls back to caller assistant's model | `agent/agent.ts:163-177`; optional schema `agent.ts:45-47` |
| V1 resume tests: basic (`task.test.ts:211`) + refresh (`task.test.ts:931` — asserts agent+permission, **not model**); `seed()` assistant carries `ref` (`:83-84`) | |
| V2 resume test: `session.test.ts:1496-1535` — asserts agent+permission via `kids[0]`, **not model**; layer includes `SyncEvent.defaultLayer` (`:266`) | |
| `subagent()` has **zero production callers**: `rg "\.subagent\("` in `packages/opencode/src` → 0 matches; no server route | API-surface-only (matches `v2/AGENTS.md`) |
| GitNexus `impact(TaskTool)` → 0 callers/UNKNOWN — documented caveat: tool registration is a generator yield, invisible to the graph (`tool/AGENTS.md`). Text-search fallback: `tool/registry.ts:140` (LLM tool calls), `session/loop/subtask.ts:18,159,241` (slash-command subtasks) | |
| `setAgent` production callers: **only** `task.ts:128` (the resume branch) | `rg setAgent(` |
| No test stubs `Session.Service` as a full object (`Layer.succeed(Session.Service` → 0 matches; the 3 hits were `SessionCompaction`/`SessionRevert`) → adding an interface method breaks no stubs. Partial mocks are safe too: `test/server/httpapi-mcp-oauth.test.ts:17` uses `Layer.mock(Session.Service)({})` — `setModel` is never called on that path, so it is unaffected | |

**What actually happens today (V1 resume):** the row stays stale from resume until
`createUserMessage` runs at prompt start. In production the row usually converges
there — but `ops.resolvePromptParts` (`task.ts:166-167`) runs **before** `ops.prompt`,
and any early prompt failure leaves the row permanently stale for future
no-explicit-model prompts. The issue's "never written back" claim is accurate at the
`task.ts` level; the prompt-time self-heal is the mitigating mechanism.

## Decision: option (a) — V1 gains `setModel` on resume

Issue #384 states no preference between (a) and (b) — this choice rests on the
code evidence only. Notably, the issue's own AC phrases (a) as writing the model
onto the resumed session "when it differs", which is exactly the guard in Step 2.

Why the row must NOT stay stale (concrete reasons from the code):

1. **The row is not display-only.** `currentModel()` reads `SessionTable.model` as
   the fallback whenever a later prompt has no explicit model (`model.ts:50-55`) —
   e.g. the user continuing the child session in the TUI, ACP, or any caller that
   omits `model`. A stale row serves the wrong model after the spawn's own turn.
2. **Failure window.** Today's convergence happens only if the prompt reaches
   `createUserMessage`; failures before it (resolvePromptParts, early prompt setup)
   leave the row stale indefinitely. V2 already closes this window at resume
   (`v2/session.ts:770-772`); (a) makes V1 match.
3. **Resume-block completeness + testability.** The re-sync trio (permission, agent,
   model) belongs together at `task.ts:125-130`, and the assertion is observable in
   the existing stubbed-prompt tests (where `createUserMessage` never runs).
4. **No side effects** (AC question, verified):
   - Caches: none need invalidation — `currentModel` re-reads the DB per prompt
     (`model.ts:47-49`); LLM system-prompt prefix cache is keyed per model
     (`session/llm.ts:124`); tool-schema cache is keyed per provider/model
     (`session/prompt.ts:125-148`, key at `:135`).
   - Permissions: model is not an input to permission evaluation.
   - Provider validation: unchanged — `setModel` only emits the event; validation
     stays at prompt time (`getModel` → `ModelNotFound` + bus error, `model.ts:20-39`).
     The written model is either the agent's config or the caller's in-use model.
   - Current turn unaffected: `task.ts:170-173` passes `model` explicitly, which
     wins over the row in `create-user-message.ts:74`.

**Why not (b) (drop V2 `switchModel`):** rejected. (b)'s honest rationale is
"redundant with the prompt-time self-heal", **not** "the model must not change on
resume" — it does change (via `ModelSwitched` at prompt). (b) would delete working
V2 behavior, widen the stale-row window on *both* paths instead of closing it on
V1, and remove the resume-timed timeline event V2 users get today. (a) closes
the failure window on V1 and keeps the stronger failure story.

## Architecture Decisions

| Decision | Choice | Rationale | Alternatives rejected |
| --- | --- | --- | --- |
| Write mechanism | New `Session.setModel` that emits `SessionEvent.ModelSwitched.Sync` (event → shared projector writes `SessionTable` + `SessionMessageTable`) | Mechanism-identical to V2 `switchModel` (`v2/session.ts:691`) and to today's prompt-time emission (`create-user-message.ts:110`); **preserves** the `session.next.model.switched` timeline entry that exists today (moved earlier). Session layer already has `sync` (`session.ts:420`), `SessionEvent` (`:20`), `DateTime` (`:21`); only `Modelv2` import is added (`v2/model.ts` imports provider schemas only — no cycle; same direction as `create-user-message.ts:15`). Zero layer/topology changes; TaskTool yields nothing new. | **Direct `patch()`** (sibling of `setAgent`): simpler, but suppresses the ModelSwitched emission that fires today at prompt → `SessionMessageTable` loses the timeline row → creates a *new* V1/V2 divergence. Emission inside `task.ts` via `ctx.extra.sync` (`tool/tool.ts:30` — `extra.sync?: SyncEvent.Interface`): that field is optional, so emission could be silently skipped when a producer omits it; it would also push V2 event-payload construction into the tool; and `Session.setModel` keeps service-level parity with the adjacent `setAgent` — rejected (conclusion unchanged). |
| Condition | Differs-check on `providerID` + `modelID` (`session.model?.id !== model.modelID \|\| session.model?.providerID !== model.providerID`) | Mirrors the adjacent `setAgent` guard (`task.ts:127`) and the prompt-time check (`create-user-message.ts:108`); matches the issue AC ("when it differs"); skips no-op writes | Unconditional emit (V2's presence-guard style): creates a redundant timeline entry on every resume; variant-aware check: derived model has no variant and resolving it needs `provider.getModel` at task time — variant stays `createUserMessage`'s authority |
| Variant handling | Write omits variant → event carries `variant: "default"` (`Modelv2.VariantID.make(input.model.variant ?? "default")`); comparison ignores variant | `variant: "default"` is consumer-equivalent to absent (`model.ts:54`, `create-user-message.ts:108`); final row state after the full resume→prompt sequence equals today's in all cases | Including variant: would require provider lookup in the resume branch (heavy, wrong layer) |
| V2 functional change | **None** — keep `if (input.model)` guard (`v2/session.ts:770`) | V2 API contract: model applies only when supplied; V1/V2 create-time difference (concrete vs optional) is structural and pre-existing | Changing V2 guard to differ-check: cosmetic only (avoids redundant emit when model unchanged) — optional future cleanup, out of scope |
| SDK | **No regeneration** | `Session.Interface` is server-internal; no HTTP schema/config/event-union changes (no new event type — `ModelSwitched` already exists) | — |

**Residual divergence (documented, out of scope):** with **no** explicit model on
resume, V1 always converges the row to the caller's model (derived at
`task.ts:113-116`), while V2 leaves the row untouched (guard at `:770`). This
pre-exists at **create** (`task.ts:138-141` always writes a concrete model;
`v2/session.ts:429` writes `input.model` only) and in the prompt path itself
(V1 always passes a concrete model, `task.ts:170-173`; V2 passes `undefined`,
`:812`). Fixing it would change fresh-spawn behavior — out of scope for resume
parity.

## Steps

1. **Add `Session.setModel`** — `packages/opencode/src/session/session.ts`
   - Why: resume-branch write target; event-based to match V2 `switchModel`.
   - Import (near line 20): add `import { Modelv2 } from "@/v2/model"`.
   - Interface (after `setPermission`, line 369):

     ```ts
     readonly setPermission: (input: { sessionID: SessionID; permission: Permission.Ruleset }) => Effect.Effect<void>
     readonly setModel: (input: { sessionID: SessionID; model: Schema.Schema.Type<typeof Model> }) => Effect.Effect<void>
     ```

   - Impl (after the `setPermission` impl, ~line 684; `sync` is in scope from
     `session.ts:420`):

     ```ts
     // Emits ModelSwitched so the shared projector (session/projectors-next.ts:172)
     // writes SessionTable.model and the SessionMessageTable timeline entry — the
     // same mechanism V2 switchModel uses and the same event createUserMessage
     // emits at prompt time (issue #384). No provider validation here; that stays
     // at prompt time (session/loop/model.ts:getModel).
     const setModel = Effect.fn("Session.setModel")(function* (input: {
       sessionID: SessionID
       model: Schema.Schema.Type<typeof Model>
     }) {
       yield* sync.run(SessionEvent.ModelSwitched.Sync, {
         sessionID: input.sessionID,
         timestamp: DateTime.makeUnsafe(Date.now()),
         model: {
           id: input.model.id,
           providerID: input.model.providerID,
           variant: Modelv2.VariantID.make(input.model.variant ?? "default"),
         },
       })
     })
     ```

   - Export (in the `Service.of({...})` object, after `setPermission,` at line 786):
     add `setModel,`.

2. **Apply the switch in the V1 resume branch** — `packages/opencode/src/tool/task.ts`
   - Why: the fix itself; lives inside the existing `if (session)` resume block so
     fresh spawns are untouched.
   - Before (`task.ts:125-130`):

     ```ts
     if (session) {
       yield* sessions.setPermission({ sessionID: session.id, permission })
       if (session.agent !== next.name) {
         yield* sessions.setAgent({ sessionID: session.id, agent: next.name })
       }
     }
     ```

   - After:

     ```ts
     if (session) {
       yield* sessions.setPermission({ sessionID: session.id, permission })
       if (session.agent !== next.name) {
         yield* sessions.setAgent({ sessionID: session.id, agent: next.name })
       }
       // Resume re-syncs the model row too — parity with V2 subagent()'s
       // switchModel (issue #384). Only future prompts read the row; this turn
       // still passes `model` explicitly (below), which wins in createUserMessage.
       if (session.model?.id !== model.modelID || session.model?.providerID !== model.providerID) {
         yield* sessions.setModel({ sessionID: session.id, model: { id: model.modelID, providerID: model.providerID } })
       }
     }
     ```

3. **Parity comment on the V2 side** — `packages/opencode/src/v2/session.ts`
   - Above the `switchModel` call in the resume branch (`:770-772`), one line:

     ```ts
     // Resume model re-sync — V1 mirrors this via Session.setModel (issue #384)
     ```

   - No functional change (decision table above).

4. **Extend the V1 resume test** — `packages/opencode/test/tool/task.test.ts`, test
   `"execute refreshes child session permissions and agent when resuming via task_id"`
   (`:931`; rename to `"...permissions, agent, and model..."` to match behavior).
   - Arrange: give the child a **different** model at create (real code at
     `task.test.ts:936-941` is `const child = yield* sessions.create({ parentID:
     chat.id, title: "Existing child", agent: "explore", permission: [...] })`):

     ```ts
     const child = yield* sessions.create({
       parentID: chat.id,
       title: "Existing child",
       agent: "explore",
       permission: [{ permission: "edit", pattern: "*", action: "allow" }],
       model: { id: ModelID.make("old-model"), providerID: ProviderID.make("test") },
     })
     ```

   - Assert after the existing agent/permission assertions (`task.test.ts:977-980`):

     ```ts
     // Resume re-syncs the model row to the spawn's derived model (issue #384).
     // `general` defines no agent model, so derivation falls back to the caller
     // assistant's model (ref = test/test-model, seed() :83-84).
     expect(updatedChild.model?.id).toBe("test-model")
     expect(updatedChild.model?.providerID).toBe("test")
     ```

   - Why here (not the basic resume test at `:211`): this is the *re-sync* test —
     model is the third re-synced dimension alongside permission and agent.
   - Note: `promptOps.prompt` is stubbed in this file, so `createUserMessage`
     never runs — the assertion proves the resume-branch write alone.

5. **Extend the V2 resume test** — `packages/opencode/test/v2/session.test.ts`,
   test `"subagent resumes an existing child session via taskID and refreshes its
   permissions"` (`:1496`; rename to `"...permissions, agent, and model"`).
   - Arrange: child create gains a model (real code at `session.test.ts:1500-1504`);
     `subagent` call gains `input.model`:

     ```ts
     const child = yield* session.create({
       parentID: parent.id,
       agent: "explore",
       permission: [{ permission: "bash", pattern: "*", action: "allow" }],
       model: {
         id: ModelID.make("old-model"),
         providerID: ProviderID.make("test"),
         variant: Modelv2.VariantID.make("default"),
       },
     })
     // ... in the subagent input at :1517-1522:
     model: {
       id: ModelID.make("test-model"),
       providerID: ProviderID.make("test"),
       variant: Modelv2.VariantID.make("default"),
     },
     ```

     (`Modelv2.Ref` requires `variant`, `v2/model.ts:78-83`.)

   - Assert after the existing `kids[0]` agent/permission assertions (`:1529-1534`):

     ```ts
     // Resume applies input.model to the child row via switchModel (issue #384).
     expect(kids[0]?.model?.id).toBe("test-model")
     expect(kids[0]?.model?.providerID).toBe("test")
     ```

   - Why this works: `switchModel` → `ModelSwitched.Sync` → projector →
     `SessionTable.model` → `children()` → `toV2Info` (`v2/session.ts:213-217`).
     The existing `kids[0].agent` assertion proves the event→projector→row path
     already functions in this test env.
   - **Also pin the no-model guard (Open Question 1, taken — cheap):** a small
     sibling test locks `if (input.model)` so the guard cannot silently regress —
     child created with an old model, resumed *without* `input.model`, row must
     stay old:

     ```ts
     it.instance("subagent resume without input.model leaves the child model unchanged", () =>
       Effect.gen(function* () {
         const session = yield* SessionV2.Service
         const parent = yield* session.create({ agent: "build" })
         const child = yield* session.create({
           parentID: parent.id,
           agent: "explore",
           model: {
             id: ModelID.make("old-model"),
             providerID: ProviderID.make("test"),
             variant: Modelv2.VariantID.make("default"),
           },
         })
         yield* session.subagent({
           parentID: parent.id,
           taskID: child.id,
           agent: "general",
           prompt: { text: "continue without a model" },
         })
         const kids = yield* session.children(parent.id)
         expect(kids[0]?.model?.id).toBe("old-model")
       }),
     )
     ```

6. **Docs** — `packages/opencode/src/v2/AGENTS.md`
   - Add a short section (e.g. after "V2 subagent() is API-surface-only and
     deny-gated"):

     ```md
     ## V2 subagent() resume re-syncs permission, agent, and model

     When `taskID` resolves to an existing child session, `subagent()` re-syncs the
     row before prompting: `Session.setPermission` always, `switchAgent` when the
     agent changed, and `switchModel` when `input.model` is supplied (no-op
     otherwise — V2 has no caller-model fallback). V1 `TaskTool` mirrors this via
     `setPermission` / `setAgent` / `setModel` (issue #384); V1 always derives a
     concrete model (`agent.model ?? caller's current model`), so its guard is a
     differs-check rather than a presence check. The residual no-model divergence
     (V1 converges the row to the caller's model; V2 leaves it unchanged) is
     structural and pre-dates resume — V1 `Session.create` also always writes a
     concrete model while V2 `create` writes `input.model` only when supplied.
     ```

## Test additions (summary)

| File | Change |
| --- | --- |
| `packages/opencode/test/tool/task.test.ts:931` | Child create gains `model: { id: ModelID.make("old-model"), providerID: ProviderID.make("test") }`; after existing refresh asserts, assert `updatedChild.model?.id === "test-model"` + `providerID === "test"`; rename test to include "model" |
| `packages/opencode/test/v2/session.test.ts:1496` | Child create gains old `Modelv2.Ref` (with `variant: "default"`); `subagent` input gains new `Modelv2.Ref`; after existing asserts, assert `kids[0]?.model?.id === "test-model"` + `providerID === "test"`; rename test to include "model" |
| `packages/opencode/test/v2/session.test.ts` (new sibling test) | Pin V2's `if (input.model)` guard: child created with old model, resume without `input.model`, assert row still `old-model` |

No mocks are introduced — both tests use the real Session service, real DB, and
real projectors (registered by `test/preload.ts`); only `promptOps.prompt` /
Engine `prompt` stay stubbed as today (they already are — the row write no longer
depends on them).

## Verification commands

```powershell
# targeted (AC)
cd packages/opencode
bun test test/tool/task.test.ts test/v2/session.test.ts
bun typecheck
```

- Full suite note: repo rules prefer a full run after changes, but the Windows full
  suite is slow and has known order-dependent flakes; targeted + CI is the
  pragmatic gate for this change (no shared-state mutation added beyond one new
  service method).
- **No SDK regen** (`./packages/sdk/js/script/build.ts` not needed — no HTTP
  schema/config/event changes) and **no `packages/app` typecheck** needed.
- Lint: `bun run lint` from root (optional; watch for `no-unused-vars` if an
  import goes unused).

## Risk / impact notes

- **Callers of the changed paths:** the new write is inside `if (session)`
  (resume-only) in `task.ts` — fresh spawns (`:138-141`) and the per-prompt model
  (`:170-173`) are untouched. `setAgent` has exactly one production caller
  (`task.ts:128`); `setModel` will have exactly one — the new call inside the same
  resume block. `setPermission` callers (`task.ts:126`, `v2/session.ts:766,918`,
  `prompt.ts:223`, `handlers/session.ts:177`) are unaffected.
- **TaskTool consumers (text search — GitNexus reports UNKNOWN because tool
  registration is a generator yield, per `tool/AGENTS.md`):** LLM tool calls via
  `tool/registry.ts:140` and slash-command subtasks via `session/loop/subtask.ts`
  (both share the same `run`; the resume branch activates only with `task_id`).
- **`subagent()` zero production callers:** re-verified this session —
  `rg "\.subagent\("` in `packages/opencode/src` → 0 matches; no server route.
  V2-side changes (comment only) have no production reach anyway.
- **HIGH/CRITICAL risk?** No — blast radius is one resume branch + one new
  service method; GitNexus `impact` could not answer (UNKNOWN, index 7 commits
  behind) so callers were confirmed by text search as the tool guidance requires.
- **Interface addition breaks no stubs:** no test implements `Session.Service` as
  a full object (`Layer.succeed(Session.Service` → 0 matches).
- **Event double-emission:** with the resume write, `createUserMessage`'s differs-check
  now finds a matching row and does **not** re-emit at prompt (id/provider equal).
  Exception: when the agent config defines `model.variant`, the resume write stores
  `variant: "default"` while the prompt resolves the agent variant → one extra
  `model.switched` timeline entry vs today; **final row state is identical**.
  Cosmetic, documented.
- **V2 redundant emit (pre-existing):** V2's presence-guard re-emits `switchModel`
  even when the model is unchanged; V1's differs-check does not. Cosmetic
  divergence, left alone (out of scope).
- **Pre-push hook** runs `bun turbo typecheck` across packages — run `bun typecheck`
  from `packages/opencode` before pushing; no `diff-wasm`/SDK-regen pitfalls apply.

## AC → step mapping

| AC | How satisfied |
| --- | --- |
| (a) V1 gains model switch (chosen) | Steps 1-2; decision section documents why the row must not stay stale |
| Implemented on both paths | V1: steps 1-2 (functional); V2: already functional — step 3 comment + step 5 test + step 6 docs |
| Tests extend the two named resume tests with a model assertion | Step 4 (V1 `task.test.ts:931`) + step 5 (V2 `session.test.ts:1496`) |
| Decision documented in comments and/or `v2/AGENTS.md` | Step 3 (code comment) + step 6 (AGENTS section) |
| Side-effect questions answered | Decision section item 4 (caches / permissions / validation / current turn) |
| `subagent()` zero callers verified | Context table (rg evidence) |
| Verification commands | Dedicated section |
| SDK regen only if schemas touched | Not touched → none |

## Open Questions

1. **V2 no-model guard pin — taken (cheap):** resolved as the sibling test
   appended to step 5 (child created with an old model, resume *without*
   `input.model`, assert the row stays old).
2. **V2 differ-check cleanup:** adding a differs-check to V2's `switchModel` call
   would remove its redundant emit on unchanged-model resume (cosmetic parity with
   V1's guard). Deferred — no behavior depends on it.
3. **`subagent-parity.test.ts`** (`test/agent/subagent-parity.test.ts`) is the
   natural home for a future cross-path resume parity test (V1 and V2 resumed
   side-by-side asserting the same final row), but it currently has no resume
   coverage; the AC-named tests are extended instead to keep the diff minimal.
