# Plan: Harden optimistic/event ID handling (issue #377)

- **Issue:** ozgurulukir/opencode-personal#377 — `[app] Harden optimistic/event ID handling`
- **Branch:** `issue-377-app-optimistic-id-hardening`
- **Date:** 2026-11-08
- **Status:** pending review

## Goal

The app's V2 event reducer coerces missing/empty `event.id` to `""` at four insert sites, which corrupts the store's id-indexed slices (messages inserted with `""` collide under `Binary.search` lookups; the shell wrapper additionally derives `":assistant"` children from it). Separately, the optimistic-prompt text round-trip (draft → server projection → live event → load) has no test locking the equality invariant that text-based optimistic matching depends on.

This plan: (1) define and enforce a **fail-loud** missing-id policy, (2) add a pure round-trip equality test covering attachment cases, (3) document both in `global-sync/AGENTS.md`, keeping all existing optimistic tests green.

### Verified anchors (re-read 2026-11-08)

| Site | File | Line | Code |
| --- | --- | --- | --- |
| prompted | `packages/app/src/context/global-sync/event-reducer.ts` | 361 | `const id = event.id ?? ""` |
| shell.started | same | 410 | `const wrapperID = event.id ?? ""` |
| step.started | same | 493 | `id: event.id ?? ""` |
| compaction.started | same | 762 | `const id = event.id ?? ""` |

Supporting facts (all re-verified):

- `MessageEvent` is `{ id?: string; type: string; properties?: unknown }` (`event-reducer.ts:40`) — `id` is optional by type.
- Server bus **always** assigns an id: `bus/index.ts:91` (`options?.id ?? createID()`) and `bus/global.ts:15-16` backfills missing `payload.id`. A missing id reaching the reducer therefore indicates a client-side wiring/malformed-event bug, not normal operation.
- Handlers are pure store mutations (`input.setStore` / `produce` / `insertMessage`); no IO. `console.warn` is an accepted observation-only side effect elsewhere in `packages/app/src/context` (`command.tsx:264`, `child-store.ts:142`).
- Text round-trip helpers: `messageText()` (`v2-adapter.ts:73-79`, filters `text && !synthetic && !ignored`, joins `"\n"`); server projection joins non-synthetic text parts with `"\n"` (`create-user-message.ts:440-445`, emitted `:510`); optimistic match at `sync.tsx:90` and `resolveOptimistic` (`event-reducer.ts:381`).
- `buildRequestParts` (`build-request-parts.ts:91-205`): first text part is `input.text` verbatim (no trim/normalize); context comments become `synthetic: true` text parts; files/agents/images are non-text parts; `ignored` is never set to `true` on request parts (only copied through when present, which it never is).
- Existing tests always pass explicit ids (`promptedEvent(id, ...)` in `event-reducer.test.ts`); no missing-id test exists (confirms finding A-7).
- Issue path drift: issue says `packages/app/src/context/event-reducer.ts`; actual file is `packages/app/src/context/global-sync/event-reducer.ts`. All four line anchors match the actual file.

## Steps

### 1. Missing-id policy: fail loud at the four insert sites

**What:** Replace the `event.id ?? ""` coercions with a shared guard that drops the event's inserts and warns. Guard on **falsy** `event.id` (covers both `undefined` and `""`).

**File:** `packages/app/src/context/global-sync/event-reducer.ts`

- Add a small module-local helper (4 call sites justify extraction):

  ```ts
  // Missing/empty event ids are a client wiring bug — the server bus always
  // assigns ids (bus/index.ts). Dropping the insert keeps the id-indexed
  // slices from corrupting (""); the optimistic entry (prompted) stays visible.
  function requireEventID(event: MessageEvent): string | undefined {
    if (event.id) return event.id
    console.warn(`[event-reducer] ${event.type} missing event.id; dropping insert`)
    return undefined
  }
  ```

- Per handler (early return **before any mutation**, including `resolveOptimistic`):
  - `handlePrompted` (:348): `const id = requireEventID(event); if (!id) return` — placed **before** `resolveOptimistic` (:381) so the optimistic entry is *not* evicted when the real insert is dropped (the user's prompt stays visible via `store.optimistic` until a later valid event or page merge reconciles it).
  - `handleShellStarted` (:395): guard before the wrapper insert (:411); no wrapper → no `":assistant"` child, no orphan tool part.
  - `handleStepStarted` (:474): guard at the top, **before** the current-assistant completion block (:483-488) — a malformed event causes zero partial mutations; the next valid `step.started`/`step.ended` completes the assistant normally.
  - `handleCompactionStarted` (:759): guard before the insert (:763).

**Why fail loud over a deterministic generated id:** the server always assigns ids, so a missing id is a bug — synthesizing an id would mask it while still risking collision with real server ids (content-derived ids are not namespaced against `createID()` output). Skipping degrades gracefully: no `""`-keyed corruption, and for `prompted` the optimistic entry keeps the message on screen. Documented so the trade-off is explicit.

**Alternatives considered:**
- *Deterministic generated id* (e.g. hash of type+session+timestamp): keeps every insert, but hides the bug, needs a collision story vs server ids, and adds id-minting logic to a pure reducer. Rejected.
- *Silent skip (no warn)*: violates fail-fast/fail loud; the bug would be invisible. Rejected.
- *Fix at the bus boundary only* (backfill before reducer): reducer input type still allows `id?: string`; defense in depth says both layers guard. The reducer guard is the scope of this issue.

### 2. Tests: missing-id behavior

**File:** `packages/app/src/context/global-sync/event-reducer.test.ts`

Add a `describe("missing event.id", ...)` block using the file's existing harness (`promptedEvent`, store setup helpers — follow the established fixture style; do not duplicate reducer logic):

1. `session.prompted` with `id` omitted → **no** user message inserted, **no** parts, store messages unchanged; optimistic entry (if seeded via `resolveOptimistic` spy/fixture) is **not** evicted; `console.warn` called once (spy via `vi.spyOn(console, "warn")` or the test file's existing spy convention — check the file first; restore in `afterEach`).
2. `session.prompted` with `id: ""` → same assertions (empty string covered).
3. `session.shell.started` with missing id → no wrapper message, no `":assistant"` message, no tool part.
4. `session.step.started` with missing id → no assistant inserted **and** the active assistant is left uncompleted (guard precedes completion block).
5. `session.compaction.started` with missing id → no compaction message/part.
6. Control: same events **with** a valid id insert normally (guards existing behavior; much of this is already covered by current tests — keep only what's not redundant).

### 3. Tests: prompt text round-trip equality (pure, no IO)

**File (new):** `packages/app/src/context/global-sync/prompt-text-roundtrip.test.ts`

A single pure chain per case, all equality asserted with `messageText()`:

```
draft text + attachments
  → buildRequestParts(...)                       // prompt-input/build-request-parts.ts
  → optimisticParts ── messageText() ─────────────┐ stage A: client optimistic text
  → requestParts (simulated server projection):   │
      non-synthetic text parts joined "\n"        │  mirrors create-user-message.ts:440-445,510
      ── stage B: server prompt.text ─────────────┤
  → promptedEvent(id, sessionID, stageB, files, agents)
      → applyDirectoryEvent → store parts
      → messageText() ────────────────────────────┤ stage C: live event text
  → V2 SessionMessage fixture (same text)         │
      → sessionMessagesToV1 → store parts
      → messageText() ────────────────────────────┘ stage D: load-path text
assert A === B === C === D
```

**Cases (per AC — file/context/agent attachments covered):**
1. Plain single-line text.
2. Multi-line text (`"line1\nline2"`) — locks that no trim/normalize diverges the stages.
3. Text + file attachment (prompt file part) — file part must not affect `messageText`.
4. Text + agent attachment — agent part must not affect `messageText`.
5. Text + context file with comment → synthetic comment text part present in `optimisticParts`/`requestParts` but **excluded** at every stage (filters `synthetic`); context file part present as non-text.
6. Text + image attachment (dataUrl file part) — excluded from text equality.

Reuse `user()`/`assistant()` fixture builders from `v2-adapter.test.ts` for the stage-D `SessionMessage` shape, and `buildRequestParts` directly for stages A/B. No mocks of owned code (repo rule); no network.

**Known divergence documented in the test header:** `messageText` filters `ignored` but the server projection only filters `synthetic` — harmless today because request parts never set `ignored: true` (`build-request-parts.ts`); if that changes, stage B must gain the filter. Assert `requestParts` never carries `ignored: true` as a canary.

### 4. Documentation lockstep

**File:** `packages/app/src/context/global-sync/AGENTS.md`

- Extend the "Optimistic prompt confirmation matches prompt text" bullet (currently lines 18-19) with:
  - **Missing-id policy:** `event.id` is required at insert sites; the reducer drops the insert (before any mutation, incl. `resolveOptimistic`) and warns — never coerce to `""`. Rationale: server bus always assigns ids; `""` corrupts id-keyed lookups.
  - **Round-trip invariant:** `messageText(buildRequestParts.optimisticParts)` ≡ server projection (non-synthetic text joined `"\n"`) ≡ `messageText` after the `session.prompted` event ≡ `messageText` after `sessionMessagesToV1` — locked by `prompt-text-roundtrip.test.ts`.
- Update the "Tests and completion gate" section (lines 28-33) to name `prompt-text-roundtrip.test.ts` alongside the three existing suites.

### 5. Verification

From `packages/app` (never from repo root):

```powershell
# targeted new + adjacent suites
bun test --preload ../ui/test/solid-jsx.ts --preload ./happydom.ts `
  ./src/context/global-sync/event-reducer.test.ts `
  ./src/context/global-sync/prompt-text-roundtrip.test.ts `
  ./src/context/sync-optimistic.test.ts `
  ./src/context/global-sync/v2-adapter.test.ts

# full app unit suite (order-dependent leakage — full run is mandatory)
bun run test:unit

# typecheck (trust tsgo over LSP for @/ aliases)
bun typecheck
```

Gate: all four suites green, full `test:unit` green, `bun typecheck` clean, `console.warn` assertions restored (no leaked spies — repo note: `mock.module()` leakage; use `afterEach` restore).

## Architecture Decisions

| Decision | Choice | Rationale | Alternative / trade-off |
| --- | --- | --- | --- |
| Missing-id policy | **Fail loud**: falsy-id guard, warn, drop insert before any mutation | Server always assigns ids (`bus/index.ts:91`); `""` collides in id-keyed slices; bug must surface. Pure reducer + `console.warn` matches repo precedent (`command.tsx:264`) | Deterministic generated id keeps display but masks the bug and risks id collision with `createID()` output — rejected |
| Prompted guard placement | **Before** `resolveOptimistic` | Dropping the insert but evicting the optimistic entry would make the prompt vanish entirely; keeping it preserves visible state until a valid event/page merge | Guarding after eviction gives correct eventual state but a visible gap — rejected |
| `step.started` guard placement | Top of handler, before current-assistant completion | Malformed event = zero partial mutations (fail fast); next valid event recovers | Partial progress (complete current, skip insert) — more code, marginal benefit; rejected for simplicity |
| Round-trip test style | Pure single-chain test, no IO/mocks of owned code | Equality across four stages is the invariant; pure = deterministic, fast, per repo testing rules | Integration test against real server — slower, out of scope for app package; rejected |
| Test file placement | New `prompt-text-roundtrip.test.ts` under `global-sync/` | Spans prompt-input + reducer + adapter; keeps the three existing suites untouched and green | Folding into `sync-optimistic.test.ts` — possible, but mixes concerns; open question below |
| `ignored` filter asymmetry | Document + canary assert, no behavior change | App never sets `ignored: true` on request parts today; changing the server-mirror filter would alter matching semantics outside this issue | Aligning filters now — scope creep; rejected |

## Open Questions

1. **Warn channel:** `console.warn` (repo precedent) vs. a bus/telemetry event for the dropped insert? Plan assumes `console.warn`; reviewer may prefer a structured log.
2. **Test file placement:** new `prompt-text-roundtrip.test.ts` vs. extending `sync-optimistic.test.ts`? Plan prefers the new file; either satisfies the AC.
3. **Partial-progress on `step.started`:** plan bails before completing the current assistant. If the reviewer prefers "complete current, then bail", that's a one-line reorder — behavior difference is only for malformed events.
4. **Scope check:** issue AC does not require changing `sync.tsx` text matching (already correct); confirm no additional hardening (e.g. trimming) is expected there.
