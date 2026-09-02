# Subagent Implementation Fixes — 2026-08-12

## Goal

Align V2 `subagent()` behavior with the proven V1 `TaskTool` patterns and remove dead code in the subagent data reducer. Fixes are scoped to 6 small, low-risk changes in `packages/opencode`.

---

## Steps

### 1. Add `description` parameter to V2 `subagent()` interface
**File:** `packages/opencode/src/v2/session.ts:117-124`

**What:** Add `description?: string` to the `subagent()` input interface.

**Why:** V1 `TaskTool` accepts a `description` and uses it for the child session title and metadata. V2 currently hardcodes `"Subagent @${input.agent}"`, losing the caller-provided context.

**Change:**
```ts
readonly subagent: (input: {
  id?: EventV2.ID
  parentID: SessionID
  prompt: Prompt
  agent: string
  description?: string        // <-- add
  model?: Modelv2.Ref
  abort?: AbortSignal
}) => Effect.Effect<void, Error>
```

### 2. Use `description` in child session title
**File:** `packages/opencode/src/v2/session.ts:523`

**What:** Incorporate `input.description` into the child session title, matching V1 `tool/task.ts:138`.

**Why:** Makes the child session identifiable in listings and matches V1 behavior.

**Change:**
```ts
title: `${input.description ?? "Subagent"} @${input.agent}`,
```

### 3. Replace `messages.find()` with `MessageV2.latest()`
**File:** `packages/opencode/src/v2/session.ts:562-563`

**What:** Replace array-position-based assistant selection with `MessageV2.latest()`.

**Why:** `messages.find()` assumes the first assistant in the array is the latest. After compaction or reordering, array position is not chronological. `MessageV2.latest()` derives the latest assistant by max `MessageID`, which is monotonic.

**Change:**
- Add `MessageV2` to the import from `@/session/message-v2` (or wherever it's imported — currently not imported in this file).
- Replace:
  ```ts
  const messages = yield* result.messages({ sessionID: session.id, order: "desc" })
  const assistant = messages.find((msg) => msg.type === "assistant")
  ```
  with:
  ```ts
  const messages = yield* result.messages({ sessionID: session.id, order: "desc" })
  const { assistant } = MessageV2.latest(messages)
  ```

### 4. Wrap `cancelChild` in `Effect.catch` to suppress cleanup errors
**File:** `packages/opencode/src/v2/session.ts:606-609`

**What:** Wrap `yield* cancelChild` in `Effect.catch` to log and suppress cleanup errors.

**Why:** If the child has already exited normally, `cancelChild` can throw. V1 `tool/task.ts:173` handles this with `.catch()` on the promise. In V2's `Effect.gen` context, use `Effect.catch` to observe the error without propagating it.

**Change:**
```ts
if (Exit.hasInterrupts(exit) && !cancelled) {
  cancelled = true
  yield* cancelChild.pipe(
    Effect.catch((error) =>
      Effect.sync(() => log.warn("subagent cancel failed", { error: String(error) })),
    ),
  )
}
```

### 5. Use `Cause.squash()` in subagent error handler
**File:** `packages/opencode/src/v2/session.ts:598`

**What:** Replace `cause instanceof Error ? cause.message : String(cause)` with `Cause.squash(cause)`.

**Why:** `Cause.squash()` flattens Effect defects and errors into a single readable message, matching V1 `tool/task.ts:81`. It provides richer context for nested defects.

**Change:**
```ts
text: `Subagent error: ${Cause.squash(cause)}`,
```

### 6. Remove dead code in `reduceSubagentData`
**File:** `packages/opencode/src/cli/cmd/run/subagent-data.ts:782-784`

**What:** Remove the unreachable `message.part.updated` branch in the `sessionID` ternary.

**Why:** The `event.type === "message.part.updated"` case is already handled at lines 760-768 with an early return. The ternary branch at 782-784 is dead code.

**Change:** Delete lines 782-784:
```ts
// REMOVE these lines:
: event.type === "message.part.updated"
  ? event.properties.part.sessionID
  : undefined
```
The ternary should end at line 781 with `: undefined`.

### 7. Add V2 subagent error-path test
**File:** `packages/opencode/test/v2/session.test.ts`

**What:** Add a test that verifies a synthetic error message is posted to the parent when the subagent loop fails.

**Why:** The existing test at line 660 ("subagent posts synthetic error message when loop fails") only covers the happy path. We need coverage for the error path to prevent regressions in `Effect.catchCause` handling.

**Approach:**
- Create a stub `SessionPrompt` layer where `prompt()` fails with a typed error.
- Call `subagent()` and poll parent `messages()` for a `synthetic` message containing the error text.
- Assert the synthetic message text includes the error description.

**Suggested test placement:** After the existing "subagent posts synthetic message to parent after child completes" test (~line 423).

---

## Architecture Decisions

- **V2 stays as delegation bridge:** All changes preserve the V2 design of delegating to V1 services. No new V2-native loop logic is introduced.
- **`MessageV2.latest()` is the SSOT for chronological selection:** Already used in `prompt.ts` and `compaction.ts` to avoid array-position assumptions after `filterCompacted` reorder. Extending it to V2 `subagent()` removes another array-position dependency.
- **Error suppression on cleanup is intentional:** `cancelChild` failures during release are non-critical (the child is already exiting). Logging at `warn` level preserves observability without failing the parent.
- **`Cause.squash()` over manual stringification:** Provides consistent defect flattening across the codebase. V1 already uses it at `tool/task.ts:81`.

---

## Open Questions

- **Test stub for error path:** The current `stubPromptLayer` always succeeds. Should we add a parameter to make `prompt()` fail, or create a separate `failingPromptLayer`? A parameter is cleaner since `stubPromptLayer` already accepts `opts`.
- **`description` default in title:** V1 uses `params.description + ` (@${next.name} subagent)``. V2 currently uses `Subagent @${agent}`. The plan uses `${input.description ?? "Subagent"} @${input.agent}` — should it match V1's ` (@${agent} subagent)` suffix exactly, or is the shorter V2 form acceptable? The V2 AGENTS.md says V2 is a stable delegation bridge, so matching V1 exactly is safer.
