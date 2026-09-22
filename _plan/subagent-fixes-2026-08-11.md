# Implementation Plan: Subagent Implementation Fixes

**Date:** 2026-08-11  

**Status:** ✅ EXECUTED (reviewed 2026-09-22) — landed in `2388c2a` (parent-child permission resolution, task_id resume, queue bugs) plus `a3e1440` / PR #103 (permission bypass + compaction bugs).
**Scope:** Fix 9 issues in the subagent implementation (V1 `tool/task.ts`, V2 `v2/session.ts`, shared `agent/subagent-permissions.ts`, `session/loop/subtask.ts`, `session/loop/run-loop.ts`, `session/loop/tools.ts`)  
**Priority order:** Security → Correctness → Robustness → Documentation

---

## Goal

Fix all 9 issues identified in the subagent implementation deep dive:
1. Floating promise in V1 cancel path (align with V2)
2. Silent deny bypass when parent agent not found (SECURITY)
3. V2 synthetic message silently skipped on empty result
4. V1 empty `<task_result>` on no text
5. V1/V2 invalid agent handling mismatch (standardize on `Effect.die`)
6. No subagent session cleanup (document as known limitation)
7. Missing V2 test coverage
8. Max nesting depth for recursive subagents
9. AGENTS.md documentation drift (stale line references)

All fixes follow repo conventions: no semicolons, 120 char printWidth, prefer `const`, avoid `try/catch` where possible, use Bun APIs when possible, V1/V2 parity where applicable.

---

## Steps

### Phase 0: Characterization Tests (Rule 3)

**Before any behavior changes, write characterization tests that lock current behavior.**

#### 0.1 V1 TaskTool — parent agent not found (current behavior)

**File:** `packages/opencode/test/tool/task.test.ts`  
**What:** The existing test at lines 488–519 documents current behavior (succeeds when parent agent is missing). Update the test comment to explicitly state this is the *current* behavior being characterized, and add an assertion that `result.metadata.sessionId` is defined (already present). No code change yet — this test will be updated in Issue 2 step to reflect the new behavior.

#### 0.2 V1 TaskTool — invalid agent type (current behavior)

**File:** `packages/opencode/test/tool/task.test.ts`  
**What:** Add a test that verifies V1 `TaskTool.execute` with an invalid `subagent_type` currently throws a defect (because `.pipe(Effect.orDie)` converts `Effect.fail` to defect). This locks the current behavior before Issue 5 changes it to `Effect.die` directly.

```ts
it.instance("execute dies for invalid subagent_type (characterization)", () =>
  Effect.gen(function* () {
    const { chat, assistant } = yield* seed()
    const tool = yield* TaskTool
    const def = yield* tool.init()

    const result = yield* def
      .execute(
        {
          description: "bad task",
          prompt: "do something",
          subagent_type: "nonexistent",
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps() },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )
      .pipe(
        Effect.map(() => ({ error: undefined as string | undefined, ok: true })),
        Effect.catchDefect((defect) =>
          Effect.succeed({ error: defect instanceof Error ? defect.message : String(defect), ok: false }),
        ),
      )

    expect(result.ok).toBe(false)
    expect(result.error).toContain("Unknown agent type")
  }),
)
```

#### 0.3 V2 subagent — parent agent not found (current behavior)

**File:** `packages/opencode/test/v2/session.test.ts`  
**What:** Add a test that creates a parent session with a non-existent agent, then calls `subagent()`. Verify it currently succeeds (warns but continues). This locks current behavior before Issue 2 changes it.

```ts
it.instance("subagent proceeds when parent agent is missing (characterization)", () =>
  Effect.gen(function* () {
    const session = yield* SessionV2.Service
    const parent = yield* session.create({ agent: "deleted-agent" })

    // Current behavior: succeeds even though parent agent is not found.
    // The parentAgent lookup silently returns undefined via catchCause,
    // skipping parent agent deny rules.
    yield* session.subagent({
      parentID: parent.id,
      agent: "general",
      prompt: { text: "do something" },
    })

    expect(true).toBe(true)
  }),
)
```

---

### Phase 1: Security & Correctness Fixes

#### 1.1 Issue 5: Standardize invalid agent handling to `Effect.die` (V1)

**File:** `packages/opencode/src/tool/task.ts`  
**Lines:** 73–76

**What:**
- Replace `Effect.fail(new Error(...))` with `Effect.die(new Error(...))` at line 75.
- The `.pipe(Effect.orDie)` at line 199 already converts failures to defects at the tool boundary, so changing to `Effect.die` directly is cleaner and matches V2.

**Why:** V2 already uses `Effect.die` for this case (line 468 of `v2/session.ts`). Standardizing on `Effect.die` makes both code paths consistent — an invalid agent name is a programming error (the LLM is given available agents in the tool description), not a recoverable failure.

**Test update:** Update the characterization test from Phase 0.2 to expect `Effect.die` directly (the test already catches defects via `Effect.catchDefect`, so it will pass either way — but the test name/comment should be updated to reflect the new implementation).

#### 1.2 Issue 2: Fix silent deny bypass when parent agent not found (SECURITY)

**Files:**
- `packages/opencode/src/tool/task.ts` — lines 86–97
- `packages/opencode/src/v2/session.ts` — lines 470–482

**What:**
- **Option C (recommended):** When parent agent is not found, apply a conservative default deny set instead of skipping denies entirely. This preserves backwards compatibility (agents can be renamed/deleted without breaking existing workflows) while closing the security hole.
- In both V1 and V2, replace the `catchCause` → `return undefined` pattern with a fallback that returns a minimal deny ruleset:
  ```ts
  const fallbackDeny: Permission.Ruleset = [
    { permission: "edit", pattern: "*", action: "deny" },
    { permission: "write", pattern: "*", action: "deny" },
    { permission: "bash", pattern: "*", action: "deny" },
  ]
  ```
- Pass this fallback to `subagentSessionPermission` as `parentAgent` when the parent agent lookup fails. The `deriveSubagentSessionPermission` function will extract the deny rules and include them.

**Why:** This is security-relevant. If a parent session's agent is deleted/renamed, the current code silently skips all parent agent deny rules (e.g., Plan Mode's `edit: { "*": "deny" }`). Option C provides a safe default without breaking workflows where agents are renamed.

**Why not Option A (fail hard):** Would break existing workflows where agents are legitimately renamed or deleted between session creation and subagent spawning.

**Why not Option B (document only):** The security hole remains; documentation doesn't prevent exploitation.

**Test updates:**
- Update V1 `task.test.ts` lines 488–519: change from "succeeds when parent agent is missing" to "applies fallback deny rules when parent agent is missing". Verify the child session's permission includes the fallback denies.
- Update V2 `session.test.ts` Phase 0.3 test: verify the child session gets fallback deny rules.

#### 1.3 Issue 8: Add max nesting depth for recursive subagents

**Files:**
- `packages/opencode/src/tool/task.ts` — add depth check before creating child session
- `packages/opencode/src/v2/session.ts` — add depth check before creating child session
- `packages/opencode/src/agent/subagent-permissions.ts` — add `MAX_SUBAGENT_DEPTH` constant

**What:**
- Add a constant `MAX_SUBAGENT_DEPTH = 3` at the top of `subagent-permissions.ts` (after imports, before the `dedupe` function).
- In V1 `TaskTool.execute` (before line 99 where `nextSession` is created), walk the `parentID` chain iteratively via `sessions.get(parentID)` and count depth. If depth >= MAX_SUBAGENT_DEPTH, return `Effect.fail(new Error("Maximum subagent nesting depth (3) exceeded"))`.
- In V2 `subagent()` (before line 491 where `result.create` is called), do the same iterative depth check.
- The depth check counts how many `parentID` hops from the current session to a root session (no parent). A depth of 3 means: parent → child → grandchild → great-grandchild (the 4th level) is rejected.

**Why:** Without a depth limit, a subagent configured to allow `task` could spawn deeply nested subagents, potentially causing stack overflows, resource exhaustion, or infinite loops.

**Enforcement point rationale:** Checking in `TaskTool.execute` and V2 `subagent()` (rather than in `subagentSessionPermission`) is cleaner because:
- It provides a clear error message at the point of failure
- It doesn't conflate permission derivation with depth limiting
- It works for both permission-allowed and permission-denied subagents (the depth limit is structural, not permission-based)

**Test updates:**
- Add V1 test: create a chain of 3 subagent sessions, verify the 4th is rejected.
- Add V2 test: same pattern via `session.subagent()`.

---

### Phase 2: Robustness Fixes

#### 2.1 Issue 1: Fix floating promise in V1 cancel path

**File:** `packages/opencode/src/tool/task.ts`  
**Lines:** 136–140

**What:**
- Replace `runCancel.fork(cancel)` with `Effect.runPromise(cancel).catch((error) => log.warn("subagent cancel failed", { error: String(error) }))`.
- This matches V2's pattern at `v2/session.ts:515`.

**Why:** The current `runCancel.fork(cancel)` creates a fiber that is never awaited or caught. If `cancel` fails, the error is silently swallowed. V2 already handles this correctly.

**Note:** The `EffectBridge` pattern may need adjustment — `runCancel` is created via `EffectBridge.make()` at line 130, and `cancel` is `ops.cancel(nextSession.id)`. The `Effect.runPromise(cancel).catch(...)` pattern works because `cancel` returns `Effect<void>`.

#### 2.2 Issue 3: V2 synthetic message — post fallback when subagent has no text

**File:** `packages/opencode/src/v2/session.ts`  
**Lines:** 535–544

**What:**
- Replace the silent `return` at lines 537 and 539 with a synthetic message that indicates the subagent completed without text:
  ```ts
  const textPart = assistant.content.findLast((part) => part.type === "text")
  const text = textPart?.text ?? "Subagent completed without producing a text response."
  yield* sync.run(SessionEvent.Synthetic.Sync, {
    sessionID: input.parentID,
    timestamp: DateTime.makeUnsafe(Date.now()),
    text,
  })
  ```

**Why:** Callers observing the parent session currently get no signal when a subagent completes without producing text. Posting a fallback message ensures the result is always visible.

#### 2.3 Issue 4: V1 empty `<task_result>` — output clearer message

**File:** `packages/opencode/src/tool/task.ts`  
**Line:** 174

**What:**
- Replace `result.parts.findLast((item) => item.type === "text")?.text ?? ""` with:
  ```ts
  const text = result.parts.findLast((item) => item.type === "text")?.text
  const outputText = text ?? "Subagent completed without producing a text response."
  ```
- Use `outputText` in the output array at line 174.

**Why:** An empty `<task_result></task_result>` is confusing for the LLM and users. A clear message indicates the subagent ran but produced no text output.

---

### Phase 3: Missing Test Coverage (Issue 7)

**File:** `packages/opencode/test/v2/session.test.ts`

Add the following tests following existing patterns:

#### 3.1 Parent agent not found (with Issue 2 fix)

Verify that when parent agent is not found, fallback deny rules are applied to the child session's permission.

#### 3.2 Subagent with `primary_tools` configured

Create a parent with `experimental.primary_tools: ["bash", "read"]`, spawn a subagent, verify the child session's permission includes `allow` rules for those tools and the tools map has them set to `false`.

#### 3.3 Subagent with model variant

Create a subagent with a model that has a `variant` field, verify `v2ModelToV1Session` preserves the variant in the child session's model.

#### 3.4 Error path (subagent loop fails)

Simulate a subagent loop failure (stub prompt that throws), verify a synthetic error message is posted to the parent.

#### 3.5 Abort during execution (not pre-aborted)

Start a subagent with a non-aborted signal, abort it during execution, verify the cancel path is triggered and the tool part is marked as error/cancelled.

#### 3.6 Interrupt via scope close

Verify that when the parent scope is closed while a subagent is running, the subagent is properly cancelled (release phase of `acquireUseRelease`).

---

### Phase 4: Documentation Updates (Issue 9)

**Last phase** — update AGENTS.md files after all code fixes are complete, so line references match the final code state.

#### 4.1 Root `AGENTS.md`

**File:** `C:\Github\opencode-personal\AGENTS.md`

Update these stale references in `packages/opencode/src/session/prompt.ts` (the file path is implicit in root AGENTS.md context):
- `prompt.ts:1513` → `session/loop/run-loop.ts:73` (runLoop definition)
- `prompt.ts:1513-1754` → `session/loop/run-loop.ts:73-351`
- `prompt.ts:1595-1597` → `session/loop/run-loop.ts:171-182` (double compaction guard)
- `prompt.ts:458,482` → `session/loop/tools.ts:79,103` (permission merge in `context` and `ask`)
- `prompt.ts:732` → `session/loop/subtask.ts:132` (subagent permission merge)

Also update the floating promise note: the old note says V1 has a floating promise — after Issue 1 fix, update to reflect V1 now matches V2's defensive pattern.

Update the parent agent lookup note: after Issue 2 fix, update to reflect fallback deny rules are applied instead of silently skipping.

#### 4.2 `packages/opencode/src/agent/AGENTS.md`

**File:** `packages/opencode/src/agent/AGENTS.md`

- Line 17: `prompt.ts:1486-1493` → `session/loop/tools.ts:79,103` (permission merge)
- Line 21: `prompt.ts:476-484` → `session/loop/tools.ts:79` (normal tool execution ruleset)
- Line 23: `prompt.ts:727-734` → `session/loop/subtask.ts:132` (subagent task execution ruleset)
- Line 25: `prompt.ts:732` → `session/loop/subtask.ts:132`

#### 4.3 `packages/opencode/src/v2/AGENTS.md`

**File:** `packages/opencode/src/v2/AGENTS.md`

- Verify all line references to `v2/session.ts` are still accurate (they should be, since the file structure hasn't changed significantly).
- Add a note about the fallback deny rules when parent agent is not found (Issue 2 fix).
- Add a note about the max nesting depth enforcement (Issue 8 fix).

#### 4.4 `packages/opencode/src/session/AGENTS.md`

**File:** `packages/opencode/src/session/AGENTS.md`

- Line 17: `prompt.ts:runLoop` → `session/loop/run-loop.ts:runLoop`
- Line 29: `prompt.ts:1486-1493` → `session/loop/tools.ts:79,103`
- Line 52: `prompt.ts:727-734` → `session/loop/subtask.ts:132`
- Line 94: `prompt.ts:1595-1598` → `session/loop/run-loop.ts:171-182`

---

### Phase 5: Issue 6 — Document No Subagent Session Cleanup

**Decision: Option C — Document as known limitation, skip code change.**

**Rationale:** Per the "wabi-sabi" philosophy in AGENTS.md, we should not over-engineer a TTL/GC system. Subagent sessions persisting indefinitely is a known limitation. The database is SQLite with bounded size; subagent sessions are small rows. If cleanup becomes necessary, it can be addressed later with a simple TTL or parent-session-completion hook.

**Action:** Add a note to `packages/opencode/src/agent/AGENTS.md` and `packages/opencode/src/v2/AGENTS.md` documenting that subagent sessions are not automatically cleaned up and may accumulate over time.

---

## Architecture Decisions

### Issue 2: Fallback Deny Rules (Option C)

- **Chosen approach:** When parent agent is not found, apply a conservative default deny set (`edit`, `write`, `bash` denied) instead of silently skipping all denies.
- **Rationale:** Closes the security hole while preserving backwards compatibility for renamed/deleted agents. The fallback denies are the most dangerous tools to leave unrestricted.
- **Alternatives considered:**
  - Option A (fail hard): Would break workflows where agents are renamed/deleted between session creation and subagent spawning.
  - Option B (document only): Leaves the security hole open.
- **Trade-offs:** The fallback deny set is conservative but may be overly restrictive in some cases. It can be adjusted later if needed.

### Issue 5: `Effect.die` vs `Effect.fail`

- **Chosen approach:** Standardize on `Effect.die` for invalid agent names in both V1 and V2.
- **Rationale:** An invalid agent name is a programming error — the LLM is given available agents in the tool description. `Effect.die` signals this is a defect, not a recoverable failure. V1's `.pipe(Effect.orDie)` at the tool boundary already converts to defect, so `Effect.die` directly is cleaner.
- **Alternatives considered:** Keep V1's `Effect.fail` + `orDie` pattern. This is functionally equivalent but inconsistent with V2.
- **Trade-offs:** None significant. Both paths result in defects; `Effect.die` is more direct.

### Issue 8: Max Nesting Depth Enforcement Point

- **Chosen approach:** Enforce depth limit in `TaskTool.execute` and V2 `subagent()`, walking the `parentID` chain.
- **Rationale:** Provides clear error messages at the point of failure. Keeps depth limiting separate from permission derivation.
- **Alternatives considered:**
  - Enforce in `subagentSessionPermission`: conflates permission with structural limits.
  - Enforce in `subagentToolRestrictions`: too late — the session is already created.
- **Trade-offs:** Walking the `parentID` chain requires N+1 DB queries (one per ancestor). With MAX_DEPTH=3, this is at most 3 extra queries — acceptable. Use an iterative loop (not recursion) to avoid stack concerns in Effect's generator context.

### Issue 6: No Session Cleanup

- **Chosen approach:** Document as known limitation (Option C).
- **Rationale:** Per AGENTS.md "wabi-sabi" philosophy, avoid over-engineering. SQLite handles moderate data growth well. A TTL/GC system adds complexity without clear immediate benefit.
- **Alternatives considered:**
  - Option A (max-children limit): Arbitrary limit that may break legitimate workflows.
  - Option B (cleanup on parent completion): "Completion" is ambiguous for long-lived sessions.
- **Trade-offs:** Subagent sessions accumulate. If this becomes a problem, a simple cleanup can be added later.

---

## Open Questions

1. **Issue 2 fallback deny set granularity** — The current recommendation denies `edit`, `write`, and `bash`. Should we also deny `apply_patch`, `write_file`, or other file-mutating tools? The `edit`/`write`/`bash` trio covers the most dangerous categories, but a more comprehensive set might be safer.
   - **Recommendation:** Start with `edit`, `write`, `bash`. Add more if specific exploits are found.

2. **Issue 8 depth limit value** — MAX_SUBAGENT_DEPTH=3 is recommended, but should this be configurable? Some workflows may legitimately need deeper nesting.
   - **Recommendation:** Hardcode at 3 for now. Make it configurable only if there's a demonstrated need.

3. **Issue 3/4 synthetic message text** — The fallback text "Subagent completed without producing a text response." is clear but may be confusing if the subagent produced non-text output (e.g., file attachments). Should we distinguish between "no output at all" and "no text output"?
   - **Recommendation:** Use the same message for both cases. The synthetic message is a signal that the subagent finished; the parent can inspect the child session's messages for details.

4. **Issue 1 EffectBridge compatibility** — Replacing `runCancel.fork(cancel)` with `Effect.runPromise(cancel).catch(...)` changes the cancellation semantics slightly. Does `EffectBridge.make()` expect the fiber to be forked, or is `Effect.runPromise` sufficient?
   - **Recommendation:** Verify with the existing cancel test (`task.test.ts:290-338`) after the change. The test should still pass — if it does, the semantics are compatible. If the test fails, investigate whether `EffectBridge` requires the forked fiber for cleanup tracking and adjust accordingly.

---

## File Summary

| Issue | File | Lines | Change Type |
|-------|------|-------|-------------|
| 0.1 | `test/tool/task.test.ts` | 488–519 | Update characterization test |
| 0.2 | `test/tool/task.test.ts` | new | Add invalid agent characterization test |
| 0.3 | `test/v2/session.test.ts` | new | Add parent agent missing characterization test |
| 1.1 | `src/tool/task.ts` | 75 | `Effect.fail` → `Effect.die` |
| 1.2 | `src/tool/task.ts` | 86–97 | Fallback deny rules on parent agent missing |
| 1.2 | `src/v2/session.ts` | 470–482 | Fallback deny rules on parent agent missing |
| 1.3 | `src/tool/task.ts` | before 99 | Max depth check |
| 1.3 | `src/v2/session.ts` | before 491 | Max depth check |
| 1.3 | `src/agent/subagent-permissions.ts` | new | `MAX_SUBAGENT_DEPTH` constant |
| 2.1 | `src/tool/task.ts` | 139 | `runCancel.fork(cancel)` → `Effect.runPromise(cancel).catch(...)` |
| 2.2 | `src/v2/session.ts` | 535–544 | Post fallback synthetic message on empty result |
| 2.3 | `src/tool/task.ts` | 174 | Clearer message on empty text |
| 3.1–3.6 | `test/v2/session.test.ts` | new | 6 new test cases |
| 4.1 | `AGENTS.md` (root) | 215, 220, 244, 253–254 | Update stale line references + floating promise/parent agent notes |
| 4.2 | `src/agent/AGENTS.md` | 17, 21, 23, 25 | Update stale line references |
| 4.3 | `src/v2/AGENTS.md` | various | Update/add notes on fixes |
| 4.4 | `src/session/AGENTS.md` | 17, 29, 52, 94 | Update stale line references |
| 6 | `src/agent/AGENTS.md`, `src/v2/AGENTS.md` | new | Document no-cleanup limitation |

---

## Test Verification

After all changes:

```bash
# V1 task tool tests
cd packages/opencode && bun test test/tool/task.test.ts

# V2 session tests
cd packages/opencode && bun test test/v2/session.test.ts

# Full test suite (order-dependent failures are possible)
cd packages/opencode && bun test

# Typecheck
cd packages/opencode && bun run typecheck
```

**Specific verification for Issue 1 (EffectBridge compatibility):** After changing `runCancel.fork(cancel)` to `Effect.runPromise(cancel).catch(...)`, run `task.test.ts` and confirm the existing cancel test (`execute cancels child session when abort signal fires`, lines 290–338) still passes. If it fails, investigate whether `EffectBridge` requires forked fiber tracking and adjust the implementation.

---

## Implementation Order

1. **Phase 0:** Characterization tests (lock current behavior)
2. **Phase 1.1:** Issue 5 — `Effect.die` standardization (V1)
3. **Phase 1.2:** Issue 2 — Fallback deny rules (V1 + V2, update tests)
4. **Phase 1.3:** Issue 8 — Max nesting depth (V1 + V2, add tests)
5. **Phase 2.1:** Issue 1 — Floating promise fix (V1)
6. **Phase 2.2:** Issue 3 — V2 synthetic message fallback
7. **Phase 2.3:** Issue 4 — V1 empty `<task_result>` fix
8. **Phase 3:** Issue 7 — Missing V2 tests
9. **Phase 4:** Issue 9 — AGENTS.md documentation updates (last, after code is stable)
10. **Phase 5:** Issue 6 — Document no-cleanup limitation
