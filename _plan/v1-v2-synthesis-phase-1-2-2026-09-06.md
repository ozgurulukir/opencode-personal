# V1/V2 Synthesis — Phase 1+2 (Brands + Event System) — 2026-09-06

Status: COMPLETE — implementation landed in `cb7fbd990` and its descendants; post-implementation audit recorded 2026-09-08.

> This document preserves the 2026-09-06 planning baseline. Current-state claims and line anchors below are historical unless explicitly marked as an audit.

## Goal

Remove the two cheapest coupling layers between the V1 session engine and the V2 facade:

1. **Phase 1 — Brand unification**: eliminate the `ModelID`/`Modelv2.ID` brand mismatch and the cast helpers at the delegation boundary.
2. **Phase 2 — Event system unification**: make the V2 `SessionEvent.*.Sync` stream unconditional (remove the `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` flag and its initially estimated 20 gate sites; the exact implementation census was 19).

Both phases are small-diff, independently shippable, and reversible. Neither rewrites the engine, touches the HTTP API surface, or changes the wire format.

---

## Verified context (2026-09-06)

| Fact | Anchor |
|---|---|
| V1 `ProviderID` = `Schema.brand("ProviderID")` + zod static + 11 well-known provider statics | `packages/opencode/src/provider/schema.ts:6-26` |
| V1 `ModelID` = `Schema.brand("ModelID")` + zod static | `packages/opencode/src/provider/schema.ts:28-40` |
| V2 `Modelv2.ID` = `Schema.brand("Model.ID")`, `Modelv2.ProviderID` = `Schema.brand("Model.ProviderID")`, `Modelv2.VariantID` = `Schema.brand("VariantID")` | `packages/opencode/src/v2/model.ts:6-10` |
| Cast helpers `v2ModelToV1Session` / `v2ModelToV1Prompt` | `packages/opencode/src/v2/session.ts:192-205` |
| Helper call sites: `create` / `prompt` / `compact` | `packages/opencode/src/v2/session.ts:267, 407, 639` |
| Inline brand casts in `toV2Info` | `packages/opencode/src/v2/session.ts:149-154` |
| `ModelID` used 84× across 15+ files (provider, agent, acp, config, server handlers, tool registry) | grep, 2026-09-06 |
| `Modelv2.*` used ~31×, ONLY inside `packages/opencode/src` (v2/ + `session/loop/create-user-message.ts`, `session/processor.ts`, `session/prompt.ts`) — app/CLI/SDK unaffected | grep, 2026-09-06 |
| Flag definition: `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM: OPENCODE_EXPERIMENTAL \|\| truthy(...)` — import-time const, prod default OFF | `packages/core/src/flag/flag.ts:98` (const at :28) |
| Gate sites (20): processor.ts ×13, compaction.ts ×2, loop/create-user-message.ts ×2, loop/shell.ts ×2, tui/plugin/internal.ts ×1 | grep, 2026-09-06 |
| Gates wrap ONLY the V2 `sync.run(SessionEvent.*.Sync)` emission; the V1 path (`session.updatePart`, Bus events) is unconditional | `packages/opencode/src/session/processor.ts:235-300` |
| Tests force the flag ON globally | `packages/opencode/test/preload.ts:37` |
| TUI consumer of the flag: conditional `SessionV2Debug` plugin registration | `packages/opencode/src/cli/cmd/tui/plugin/internal.ts:28` |

**Key semantic consequence:** because the gates only condition the V2 emission, removing them makes the V2 projection (`SessionMessageTable` via `session/projectors-next.ts`) always-on — it does NOT remove or alter any V1 behavior. V1 event deletion is Phase 5, after the TUI migrates off `useSync()`.

---

## Phase 1 — Brand unification

> **Status: DONE (2026-09-06).** `v2/model.ts` re-exports V1 brands; cast helpers replaced by `toPromptModel`; `toV2Info` casts removed; unused `Modelv2` import dropped from `session/prompt.ts`; docs updated (v2/AGENTS.md + root AGENTS.md). Verified: typecheck opencode + app clean, test/v2/ 31 pass, run-loop characterization 4 pass, oxlint no new warnings. The implementation was later committed as part of `cb7fbd990` and its descendants.

**Direction:** unify on the **V1 brands** (`ModelID`, `ProviderID` from `provider/schema.ts`). Rationale: 84 vs ~31 usage asymmetry, the provider layer is the single source of truth for model identity, and the provider layer is otherwise cast-clean (1 known cast). `VariantID` has no V1 counterpart and stays in `v2/model.ts`.

### 1.1 Re-point `Modelv2.ID` / `Modelv2.ProviderID` to the V1 brands
**File:** `packages/opencode/src/v2/model.ts:6-10`

**What:** Replace the local brand definitions with re-exports of the V1 branded schemas. Keep the `Modelv2` namespace shape so call sites don't churn:

```ts
import { ModelID, ProviderID } from "@/provider/schema"

export const ID = ModelID            // was: Schema.String.pipe(Schema.brand("Model.ID"))
export const ProviderID = ProviderID // was: Schema.String.pipe(Schema.brand("Model.ProviderID"))
export const VariantID = Schema.String.pipe(Schema.brand("VariantID")) // unchanged
```

If the self-reexport shadowing (`export const ProviderID = ProviderID`) is awkward, alias explicitly (`export const ProviderID = ProviderIDV1`) or import with a namespace (`import * as ProviderSchema from "@/provider/schema"`). Prefer whichever reads cleanest; the goal is one brand symbol, not a specific alias style.

**Why:** One brand symbol = V1 and V2 model refs become structurally compatible without casts. Wire format unchanged (brands don't survive OpenAPI codegen; SDK gen types are plain strings).

### 1.2 Simplify `Modelv2.Ref` typing
**File:** `packages/opencode/src/v2/model.ts:92-98`

**What:** `Ref` fields keep their names but now carry the unified brands. No structural change.

### 1.3 Delete the cast helpers
**File:** `packages/opencode/src/v2/session.ts:181-205`

**What:**
- Delete `v2ModelToV1Session` — after unification its body is an identity reshape (`{id, providerID, variant}` → same shape); pass `input.model` directly at the `create` call site (`v2/session.ts:267`).
- Delete `v2ModelToV1Prompt` — it is a genuine field-name reshape (`id` → `modelID`), so replace it with a 3-line inline at its two call sites (`prompt` at :407, `compact` at :639), or keep ONE helper renamed `toPromptModel(model: Modelv2.Ref): { modelID: ModelID; providerID: ProviderID }` with no casts. Prefer the single renamed helper — two call sites, one explanation.
- Update the JSDoc block (`v2/session.ts:181-191`) — the "brand mismatch" explanation is obsolete; replace with a one-liner if the renamed helper needs any comment at all.

### 1.4 Clean `toV2Info` / `fromRow` casts
**File:** `packages/opencode/src/v2/session.ts:141-164, 229-252`

**What:** `toV2Info` currently casts `info.model.id as string` → `Modelv2.ID.make(...)`. After unification, `info.model.id` IS a `ModelID` = `Modelv2.ID`; the casts collapse to direct assignment. The `variant` mapping (`Modelv2.VariantID.make(info.model.variant ?? "default")`) stays — `VariantID` remains a distinct brand.

### 1.5 Sweep residual casts
**What:** `grep -rn "as unknown as ModelID\|as unknown as ProviderID\|Modelv2.ID.make\|Modelv2.ProviderID.make" packages/opencode/src` — fix any stragglers (expected in the 3 V1 loop files that reference `Modelv2.*`: `session/loop/create-user-message.ts`, `session/processor.ts`, `session/prompt.ts` — these should now typecheck without casts).

### 1.6 Update documentation
**Files:** `packages/opencode/src/v2/AGENTS.md` ("V1/V2 model-ID brand mismatch — use the cast helpers" section), root `AGENTS.md` (notes referencing `v2ModelToV1Session`/`v2ModelToV1Prompt`).

**What:** Rewrite the mismatch section as resolved: "V1 and V2 share the `ModelID`/`ProviderID` brands from `provider/schema.ts`; `VariantID` remains V2-local." Remove helper references from root AGENTS.md notes.

### 1.7 Verify Phase 1
```bash
rm -rf packages/app/node_modules/.ts-dist packages/sdk/js/tsconfig.tsbuildinfo
bun run --cwd packages/opencode typecheck
bun run --cwd packages/app typecheck
bun test packages/opencode/test/v2/session.test.ts   # from packages/opencode
```
SDK regen NOT required (brand symbols don't affect openapi.json), but run `bun typecheck` in `packages/app` anyway per the stale-tsbuildinfo rule.

---

## Phase 2 — Event system unification (flag removal)

> **Status: DONE (2026-09-06).** All 19 gate sites stripped (processor ×13 incl. the `Retried` ternary, compaction ×2, create-user-message ×2, shell ×2); `SessionV2Debug` registered unconditionally; flag deleted from `flag.ts`; `test/preload.ts` env line removed; docs updated (root AGENTS.md, packages/opencode/AGENTS.md, v2/AGENTS.md, v2/session.ts comment). Zero `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` references remain in code; other, unrelated `Flag` uses remain. Verified: typecheck core+opencode+app clean; full suite 97-100 fails — baseline comparison on the critical files (processor-effect 11/1, prompt.test 2-3 flaky fails, plugin-loader 1 fail) shows IDENTICAL failure sets with and without the change → all pre-existing order-dependent flakes. Runtime smoke: flag key absent from `Flag`. NOT performed: interactive TUI smoke (`bun dev` + session-v2 route) — needs live LLM session. The implementation was later committed as part of `cb7fbd990` and its descendants.

**Semantics:** every gate wraps only `yield* sync.run(SessionEvent.*.Sync, {...})`. Removal = the V2 projection becomes unconditional. V1 emissions are untouched.

### 2.1 Strip the gate conditionals, keep the emissions
**Files (20 sites):**
- `packages/opencode/src/session/processor.ts` (13 sites: :235, :270, :291, :322, :339, :421, :451, :476, :508, :570, :622, :719, +1)
- `packages/opencode/src/session/compaction.ts` (2)
- `packages/opencode/src/session/loop/create-user-message.ts` (2)
- `packages/opencode/src/session/loop/shell.ts` (2)

**What:** For each site, delete the `if (Flag.OPENCODE_EXPERIMENTAL_EVENT_SYSTEM) { ... }` wrapper and dedent the `sync.run(...)` call. Keep the `// V2 read-model projection: ...` comments — they explain *why* the emission exists.

**Why:** The flag has served its burn-in purpose: the full test suite runs with it ON (`test/preload.ts:37`), so projector correctness is suite-verified. `Flag` is an import-time const (`flag.ts:28,98`) — it cannot be toggled per-test, so there is no testing flexibility being lost.

### 2.2 Register the TUI debug plugin unconditionally
**File:** `packages/opencode/src/cli/cmd/tui/plugin/internal.ts:28`

**What:** `...(Flag.OPENCODE_EXPERIMENTAL_EVENT_SYSTEM ? [SessionV2Debug] : [])` → `[SessionV2Debug]` (or however the array is built — keep style). Remove the `Flag` import if now unused.

### 2.3 Delete the flag
**File:** `packages/core/src/flag/flag.ts:98`

**What:** Remove the `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` entry. Grep for residual references (`packages/core/src`, `packages/opencode/src`, docs). Note: `OPENCODE_EXPERIMENTAL` itself stays — it gates other flags.

### 2.4 Clean the test preload
**File:** `packages/opencode/test/preload.ts:37`

**What:** Delete `process.env["OPENCODE_EXPERIMENTAL_EVENT_SYSTEM"] = "true"` (now a no-op env var).

### 2.5 Update documentation
**Files:** root `AGENTS.md` (dual-write / flag mentions, e.g. the "V2 session delegation architecture" note), `packages/opencode/src/v2/AGENTS.md` ("dual-writes `SessionEvent.*.Sync` behind `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM`" language), `packages/opencode/src/session/AGENTS.md` if it references the flag.

**What:** New wording: "The V1 write path emits `SessionEvent.*.Sync` unconditionally; the V2 projectors (`session/projectors-next.ts`) populate `SessionMessageTable` from those events."

### 2.6 Verify Phase 2
```bash
cd packages/opencode
bun typecheck
bun test                      # FULL suite — order-dependent failures are documented; do not chase pre-existing flakes (permission tests)
```
Manual smoke: `bun dev` (tmux per package AGENTS.md) → start a session → confirm `SessionV2Debug` plugin is active and the session-v2 route renders messages without any env var set.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Phase 2 turns ON `SessionMessageTable` writes in production for the first time (prod default was OFF — env-gated). DB growth ≈ one row per message/part event. | Additive, bounded data; the suite already exercises projectors with the flag ON. Watch DB size after release; retention/cleanup is a Phase 5 concern. |
| First prod run populates the table from scratch — no backfill of historical sessions. V2 reads (`messages`/`context`) return only post-flag data for old sessions. | Acceptable: V2 reads are consumed by the app/session-v2 plugin, which is not yet the default TUI path. Backfill (replaying V1 history into events) is explicitly out of scope. |
| Brand unification removes the nominal compile-time guard that prevented V1 `ModelID` flowing into V2-only contexts. | Intended: they are the same concept with one authority (`provider/schema.ts`). The `VariantID` brand still guards the one genuinely V2-only field. |
| Order-dependent test failures mask a real regression. | Run the full suite before AND after; diff the failure list. Known pre-existing flakes: permission `reply - reject cancels...`, `skill` timeout after permission tests, `ModelsDev get()` disk-empty test. |
| Flag is import-time const — no gradual rollout possible. | Accepted: all-or-nothing matches the test coverage reality (suite already runs ON). Rollback = revert the commit; leftover `SessionMessageTable` rows are harmless. |

## Rollback

Both phases are small, mechanical diffs. `git revert` per phase is sufficient. No schema migration is added or removed by either phase (the tables already exist).

## Out of scope (later phases)

- Phase 3: port the 22 V1 HTTP endpoints (`/session/*`) to V2 schemas/handlers.
- Phase 4: re-home `session/loop/*` + `processor.ts` + `compaction.ts` as the engine behind `V2Session`.
- Phase 5: delete V1 bus events, TUI `sync.tsx` (21 `useSync()` consumers), legacy JSON `Storage.Service`, backfill tooling.

## Post-implementation audit (2026-09-08)

- Both phases are implemented and carried forward in the Phase 3+ commit lineage; the old “Not committed” notes above were historical at the time of writing and are corrected in the batch statuses.
- The Phase 2 gate count is corrected: 20 was the initial estimate, while the exact stripped-site census was 19.
- The event-system flag has no remaining code references. Unrelated `Flag` definitions/usages are expected and were not removed.
- The interactive TUI smoke test documented in the original verification remains unperformed. Later Phase 4/5 TUI smoke coverage exists, but it is not a substitute for the exact no-env-var smoke described here.
