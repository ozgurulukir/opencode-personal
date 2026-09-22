# Plan: Fix verified _review/CODE_REVIEW.md findings

**Date:** 2026-09-22
**Status:** ✅ EXECUTED (verified 2026-09-22) — see Execution Record below.
**Source:** `_review/CODE_REVIEW.md` (repo root) *(Rev 2026-09-22: now tracked at `_review/CODE_REVIEW.md`, moved by `734b185`.)*
**Scope:** Planning only — no source files modified in this phase.

---

## Goal

Address the three verified findings from `_review/CODE_REVIEW.md`:

1. `run-loop.ts:341-343` — `handle.message` mutated in place before persist.
2. `run-loop.ts:360-368` — `compaction.create` return value "discarded".
3. `packages/sdk/js/src/v2/data.ts` — hardcoded `"asdasd"` ids + unsafe `as Part` cast (dead code).

**Critical verification outcome before any work:** Finding **#2 is based on a stale claim**. The review asserts `deps.compaction.create` returns `Effect<"continue" | "stop">` and that the loop "always continues". Verified against the working tree: `SessionCompaction.Interface.create` returns `Effect.Effect<void>` (`packages/opencode/src/session/compaction.ts:214-223`), and its implementation ends with `yield* sync.run(SessionEvent.Compaction.Started.Sync, ...)` with no return value (`compaction.ts:677-711`). The `"continue" | "stop"` union belongs to `SessionCompaction.Interface.process` (`compaction.ts:207-213`). Therefore **finding #2 requires NO code change** — there is nothing to honor. This plan documents the correction instead. (The review's "prioritized recommendations" item 1 is void.)

Findings #1 and #3 are verified real and get code changes.

---

## Finding 1 — `handle.message` mutated in place (REAL — fix)

### Verified current code

`packages/opencode/src/session/loop/run-loop.ts:340-345`:

```ts
if (structured !== undefined) {
  handle.message.structured = structured
  handle.message.finish = handle.message.finish ?? "stop"
  yield* deps.sessions.updateMessage(handle.message)
  return "break" as const
}
```

Also in the same handler (same pattern, in scope for consistency since it touches the identical object in the identical structured-output path), `run-loop.ts:348-356`:

```ts
if (finished && !handle.message.error) {
  if (format.type === "json_schema") {
    handle.message.error = new MessageV2.StructuredOutputError({
      message: "Model did not produce structured output",
      retries: 0,
    }).toObject()
    yield* deps.sessions.updateMessage(handle.message)
    return "break" as const
  }
}
```

### Root cause / rationale

- `handle.message` is a **live getter** (`processor.ts:808-811`): `get message() { return ctx.assistantMessage }` — it returns the processor's internal `ctx.assistantMessage` by reference.
- `Session.updateMessage` (`session.ts:519-523`) publishes `MessageV2.Event.Updated` with `{ sessionID: msg.sessionID, info: msg }` — **the same object reference**, not a clone (contrast `updatePart` at `session.ts:529` and `updateParts` at `session.ts:540`, which deliberately `structuredClone`). So sync subscribers (TUI reducer, V2 projectors, `share-next`) receive the very object the loop keeps mutating.
- Mutating before publish means a slow/late subscriber can observe post-mutation state while the event semantically represents the pre-mutation persist — or see the object change after receiving it. This is the classic shared-mutable-reference hazard the repo's own style guide warns against ("Prefer functional … avoid mutation" for state shared across modules; the in-place-mutation exception explicitly does NOT cover "state shared across modules").
- The mutation sites also break `updateMessage`'s contract expectation of a coherent snapshot: `structured` and `finish` are set as two separate field writes.

### Intended change

`run-loop.ts:340-345` — before:

```ts
if (structured !== undefined) {
  handle.message.structured = structured
  handle.message.finish = handle.message.finish ?? "stop"
  yield* deps.sessions.updateMessage(handle.message)
  return "break" as const
}
```

after:

```ts
if (structured !== undefined) {
  const message: MessageV2.Assistant = {
    ...handle.message,
    structured,
    finish: handle.message.finish ?? "stop",
  }
  yield* deps.sessions.updateMessage(message)
  return "break" as const
}
```

`run-loop.ts:348-356` — before:

```ts
if (finished && !handle.message.error) {
  if (format.type === "json_schema") {
    handle.message.error = new MessageV2.StructuredOutputError({
      message: "Model did not produce structured output",
      retries: 0,
    }).toObject()
    yield* deps.sessions.updateMessage(handle.message)
    return "break" as const
  }
}
```

after:

```ts
if (finished && !handle.message.error) {
  if (format.type === "json_schema") {
    const message: MessageV2.Assistant = {
      ...handle.message,
      error: new MessageV2.StructuredOutputError({
        message: "Model did not produce structured output",
        retries: 0,
      }).toObject(),
    }
    yield* deps.sessions.updateMessage(message)
    return "break" as const
  }
}
```

Note: the second branch previously left the error set on `handle.message` after persisting; with the copy, the processor's internal `ctx.assistantMessage` no longer carries the error. `handle.message` is not read again after either branch in this iteration (line 366 reads `.finish`, but both copy branches `return "break"`, so line 366 is only reached when neither copy branch ran). Line 370 (`Effect.ensuring(... instruction.clear(handle.message.id))`) reads only `.id`, which copies preserve — no behavior change.

`handle.message.structured` was previously persisted for the next loop iteration's benefit too? Verify at implementation time: grep `lastAssistant.structured` / downstream readers of `structured` on the assistant info (`session/loop/model.ts:36-55` `lastAssistant` reads `msgs` from DB via `filterCompactedEffect`, which reads from the DB/projected store — not the in-memory processor object). The DB write (`updateMessage` → `Event.Updated` → projector upsert) is fed the copy, so the persisted record is identical. The only observable difference is the in-memory `ctx.assistantMessage`, which is discarded when the loop `break`s.

### Side-effect / blast radius

- **Callers of `runLoop`:** `session/prompt.ts` (SessionPrompt.Engine) consumes the final `MessageV2.WithParts` from `lastAssistant(...)`, which re-reads from persistence — unaffected.
- **`updateMessage` consumers:** the `MessageV2.Event.Updated` sync event now carries a detached copy; subscribers (V2 projector upsert, TUI `sync` store, share-next) see identical field values. No shape change.
- **Processor internals:** `ctx.assistantMessage` no longer reflects the `structured`/`error`/`finish` patches. Verified no reader of `ctx.assistantMessage` runs after the persist in the break paths (`process` returned; `completeToolCall`/`updateToolCall` not invoked after `process` completes).
- **Risk:** LOW. Behavioral change is limited to identity/aliasing of the published event payload.

### Verification

- `cd packages/opencode && bun typecheck` (per repo rules, never `tsc` directly).
- Existing structured-output tests: `packages/opencode/test/session/structured-output.test.ts` and `structured-output-integration.test.ts` — run from `packages/opencode`: `bun test test/session/structured-output.test.ts test/session/structured-output-integration.test.ts`. Assert: structured output persisted with `structured` set, `finish: "stop"`, retry-exhaustion error path unchanged.
- Full session suite after (order-dependence rule): `cd packages/opencode && bun test test/session/`.
- **Regression test:** yes — add a case in `packages/opencode/test/session/structured-output-integration.test.ts` asserting the object published on `MessageV2.Event.Updated` is not the same reference as the processor's live message AND carries the updated fields (guards against reintroducing aliasing). Note: that file currently has NO sync/Bus capture infrastructure (verified — zero `Event.`/`Bus`/`subscribe` references), so the capture must be added fresh. Concrete mechanism (pattern precedent `test/session/session.test.ts:44,120`, which subscribes `SessionNs.Event.Created` / `MessageV2.Event.PartUpdated` via `Bus.subscribe`):
  ```ts
  const published: MessageV2.Info[] = []
  const unsub = Bus.subscribe(MessageV2.Event.Updated, (evt) => {
    published.push(evt.properties.info)
  })
  // ... run structured-output prompt ...
  unsub()
  const msg = published.find((m) => m.id === assistantID)
  expect(msg).toBeDefined()
  expect(msg!.structured).toEqual(expectedPayload)
  expect(msg).not.toBe(<captured live assistant reference>) // no aliasing
  ```
  Implementation caveat: verify at write time that `MessageV2.Event.Updated` is routed to `Bus` in the test layer used by this file (it is published via `SyncEvent.run` at `session.ts:521`). If the test layer is sync-only (no Bus bridging), capture via the layer's `SyncEvent` stub instead — the assertion contract is identical: published payload ≠ live `ctx.assistantMessage` reference, with fields set.

### Risks / edge cases

- Spread copy is shallow: `parts` array reference is shared with `ctx.assistantMessage`. Acceptable — parts are separately evented via `PartUpdated` and never mutated by this code path. Document this in a one-line comment only if the reviewer wants it; style guide says skip JSDoc for self-evident spreads.
- `finish: handle.message.finish ?? "stop"` semantics preserved exactly (`??` not `||` — correct here: only null/undefined should fall through).

---

## Finding 2 — `compaction.create` return discarded (NOT A DEFECT — document, no code change)

### Verified current code

`run-loop.ts:359-369`:

```ts
if (result === "stop") return "break" as const
if (result === "compact") {
  yield* deps.compaction.create({
    sessionID,
    agent: lastUser.agent,
    model: lastUser.model,
    auto: true,
    overflow: !handle.message.finish,
  })
}
return "continue" as const
```

### Verification outcome

- `SessionCompaction.Interface.create` — `compaction.ts:214-223`: returns `Effect.Effect<void>`.
- Implementation `create` — `compaction.ts:677-711`: inserts the compaction user message + part, emits `SessionEvent.Compaction.Started.Sync`, returns void.
- The `"continue" | "stop"` union the review cites belongs to `process` (`compaction.ts:207-213`) / `processCompaction` (`compaction.ts:400-675`, returns `result` at line 674) — a different method, not called here.
- The sibling call at `run-loop.ts:197` (`yield* deps.compaction.create({...})`) also ignores the (void) result — consistent.
- The loop-control signal `runLoop` returns (`"break" | "continue"`, consumed at `run-loop.ts:371`) is derived from the **processor's** `Result` (`processor.ts:33`: `"compact" | "stop" | "continue"`), which is exactly what `result` at line 359 already handles. After compaction, `"continue"` is correct: the next iteration re-reads messages (`filterCompactedEffect`) and picks up the compaction flow.

### Action

- **Finding 2 is INVALID — definitively, not a hedge.** Verified against the tree: `SessionCompaction.Interface.create` returns `Effect<void>` (`compaction.ts:214-223`), the implementation returns nothing (`compaction.ts:677-711`), and the `"continue" | "stop"` union belongs to `process` (`compaction.ts:207-213`). Therefore **NO code change is made to `run-loop.ts`** beyond the clarifying comment below.
- Add a one-line comment at `run-loop.ts:361` (`// create() is Effect<void>; the next iteration re-reads compacted messages`) to prevent this exact false positive recurring. Include in the same commit as finding 1's fix — trivial, reviewable.
- **`CODE_REVIEW.md` correction note — committed, not left untracked.** ~~`CODE_REVIEW.md` is currently untracked (`git status` shows `?? CODE_REVIEW.md`)~~ **Rev 2026-09-22: stale — the file is now tracked at `_review/CODE_REVIEW.md` (committed `a68c62f`, moved by `734b185`).** An uncommitted note would not persist. Append a dated correction under finding #2 (return type is `void`; recommendation voided) and include `CODE_REVIEW.md` in the commit alongside the code fixes. This is documentation, not a silent edit of review conclusions — the note states the verification evidence. **(Executed: correction block at `_review/CODE_REVIEW.md:71`.)**

---

## Finding 3 — `data.ts` hardcoded `"asdasd"` + `as Part` cast (REAL — delete)

### Verified current code

`packages/sdk/js/src/v2/data.ts:1-32` (entire file):

```ts
import type { Part, UserMessage } from "./client.js"

export const message = {
  user(input: Omit<UserMessage, "role" | "time" | "id"> & { parts: Omit<Part, "id" | "sessionID" | "messageID">[] }): {
    info: UserMessage
    parts: Part[]
  } {
    const { parts: _parts, ...rest } = input

    const info: UserMessage = {
      ...rest,
      id: "asdasd",
      time: {
        created: Date.now(),
      },
      role: "user",
    }

    return {
      info,
      parts: input.parts.map(
        (part) =>
          ({
            ...part,
            id: "asdasd",
            messageID: info.id,
            sessionID: info.sessionID,
          }) as Part,
      ),
    }
  },
}
```

### Dead-code verification (independent)

- Repo-wide grep for `./data.js` / `./v2/data.js` re-exports: **TWO** SDK-side re-exports exist (both verified in tree):
  - `packages/sdk/js/src/index.ts:6` — `export * as data from "./v2/data.js"` (root entry)
  - `packages/sdk/js/src/v2/index.ts:10` — `export * as data from "./data.js"` (v2 barrel, re-exported by the root's `export * from "./v2/index.js"` at line 5)
  So the symbol is on the public package surface as `data.message` via both paths.
- Grep for actual consumers of that namespace (`data.message` / `import { data }` from SDK) across `packages/app`, `packages/opencode`, `packages/web`, `packages/ui`, `packages/core`: zero hits matching SDK `data.message` usage (all `data.message` hits are unrelated error-shape field access, e.g. `err.data.message`). The app's live message path uses `sync.data.message` (its own sync store), not the SDK helper.
- Conclusion: **dead code, safe to delete** — but BOTH re-export lines must be removed in the same change, otherwise the build breaks on a missing module.

### Intended change

1. Delete `packages/sdk/js/src/v2/data.ts` entirely.
2. Edit `packages/sdk/js/src/index.ts:6` — remove the line:
3. Edit `packages/sdk/js/src/v2/index.ts:10` — remove the line:
   ```ts
   export * as data from "./data.js"
   ```
   Both re-export removals and the file deletion must land atomically (one commit) — leaving either re-export in place breaks the build on a missing module.

**Why delete over fix:** the helper hardcodes a placeholder id (`"asdasd"`), would collide all parts if ever wired in, and the `as Part` cast silently defeats the `Omit<Part, "id" | "sessionID" | "messageID">` guard (review finding #4, same root). Fixing it properly means inventing an id/messageID scheme — but this is SDK client-side code and the live path (`sync.data.*` in the app, `client.v2.*` calls) never builds messages client-side this way. Deleting removes the hazard instead of maintaining an unused API surface (Strangler Fig: remove, don't nurse).

### Side-effect / blast radius

- Public API surface: `@opencode-ai/sdk` loses the `data` export namespace. Verified zero workspace consumers (`packages/app`, `packages/opencode`, `packages/web`, `packages/ui`, `github/` is out of workspace but was grep-checked via repo-wide search — no SDK `data.message` import anywhere).
- External consumers of the npm package could theoretically import `data` — acceptable: this fork's SDK is workspace-internal in practice, and the helper is defective by construction (would corrupt any request using it). If reviewer objects, fallback fix (do NOT do both): generate real ids via `crypto.randomUUID()` per part and message, drop the `as Part` cast. Default is delete.
- `packages/sdk/js/src/v2/client.js` types (`Part`, `UserMessage`) remain — only the type import disappears with the file.

### Verification

- `cd packages/sdk/js && bun typecheck` — the package has a `typecheck` script (`tsgo --noEmit`, `packages/sdk/js/package.json:8`).
- Post-change dead-reference check: `rg -F '"./data.js"'` and `rg -F '"./v2/data.js"'` must both return **zero code hits** (the only possible remaining hits would be in docs, none expected).
- `cd packages/app && bun typecheck` and `cd packages/opencode && bun typecheck` — both are SDK consumers (root AGENTS.md: always check both after SDK surface changes).
- Pre-push gate runs `bun turbo typecheck` across packages — the three above cover the changed contracts.
- No SDK regeneration needed: `data.ts` is hand-written, not in `src/v2/gen/`; `script/build.ts` untouched.
- **Regression test:** not applicable (deletion). `packages/opencode/test/server/sdk-error-shape.test.ts` imports from `@opencode-ai/sdk/v2` — it does not touch `data`; no test update expected. Run it anyway from `packages/opencode` (`bun test test/server/sdk-error-shape.test.ts`) to confirm the import surface is intact.

### Risks / edge cases

- Any **external** consumer importing `import { data } from "@opencode-ai/sdk"` breaks at compile time — loud, not silent. Acceptable for a fork; flag in commit message.
- `packages/web` does not import the SDK's `data` — verified by grep.

---

## Out of scope / explicitly not changed

- All RETRACTED findings in `_review/CODE_REVIEW.md` (step increment, busy reset, transform literal, Gemini sanitize, types.gen) — verified incorrect, no action.
- WEAK finding (`v2/server.ts:43-103` readiness/abort race) — review itself downgrades to a nit; not addressed.
- `updateMessage`'s lack of `structuredClone` in `Session.Service` (contrast `updatePart`) — the copy at the call site (finding 1) mitigates the specific hazard; changing `updateMessage` clone semantics globally is a larger change affecting all ~30 call sites.
- `processor.ts` `ctx.assistantMessage` internal mutation during streaming — inherent to the streaming design; out of scope.
- Finding #2 (compaction.create) — INVALID finding; no code change; committed documentation correction only.

---

## Ordered steps

1. **Step 1 — Finding 1a:** Replace in-place mutation at `run-loop.ts:340-345` with a shallow copy passed to `updateMessage` (code above).
2. **Step 2 — Finding 1b:** Replace in-place mutation at `run-loop.ts:348-356` (json_schema error path) with the same copy pattern.
3. **Step 3:** `cd packages/opencode && bun typecheck`; run `bun test test/session/structured-output.test.ts test/session/structured-output-integration.test.ts` then the full `test/session/` suite.
4. **Step 4 — Finding 1 regression test:** add sync-event reference-identity + field assertion to `structured-output-integration.test.ts` using the fresh `Bus.subscribe(MessageV2.Event.Updated, ...)` capture specified above (no existing capture infra in that file; pattern precedent `test/session/session.test.ts:44,120`).
5. **Step 5 — Finding 2 doc:** append dated correction to `CODE_REVIEW.md` finding #2 (stale return-type claim) and add the one-line clarifying comment at `run-loop.ts:361`. Include `CODE_REVIEW.md` in the commit (it is currently untracked; an uncommitted note would not persist). *(Rev 2026-09-22: anchors/state stale — see Execution Record. Executed as one commit `6e4a27f`; comment landed at `:367`, correction at `_review/CODE_REVIEW.md:71`.)*
6. **Step 6 — Finding 3 (atomic):** delete `packages/sdk/js/src/v2/data.ts`; remove the re-export line from `packages/sdk/js/src/index.ts:6` (`export * as data from "./v2/data.js"`) AND from `packages/sdk/js/src/v2/index.ts:10` (`export * as data from "./data.js"`) in the same commit.
7. **Step 7:** `cd packages/sdk/js && bun typecheck` (tsgo), `cd packages/opencode && bun typecheck` and `cd packages/app && bun typecheck` (clear stale `*.tsbuildinfo` first per root AGENTS.md if SDK surface changed); run `bun test test/server/sdk-error-shape.test.ts` from `packages/opencode`. Confirm `rg -F '"./data.js"'` and `rg -F '"./v2/data.js"'` return zero code hits.
8. **Step 8:** `detect_changes` graph analysis before commit (repo GitNexus rule); note it may overcount due to file-granular `touched` marking — cross-check `git diff`.

Keep steps 1-2, 5, 6 as separate small commits if desired; steps are independently reviewable.

---

## Execution Record (appended 2026-09-22 — plan fully executed)

All steps verified against HEAD `bcdc6d2`. Commits (oldest first): `6e4a27f` (findings 1+2), `d8d6ffc` (finding 3), `a68c62f`/`d7d2f9a`/`734b185` (review docs + reorg).

| Step | Finding | Status | Commit | Evidence (current tree) |
|---|---|---|---|---|
| 1-2 | Finding 1 — in-place mutation → shallow copy | ✅ DONE | `6e4a27f` | structured branch `run-loop.ts:340-348`; json_schema error branch `:351-363` — both build `const message = { ...handle.message, ... }` and pass the copy to `deps.sessions.updateMessage` |
| 4 | Finding 1 regression test | ✅ DONE (relocated — see Deviation A) | `6e4a27f` | `packages/opencode/test/session/run-loop.characterization.test.ts:609-619` — `expect(firstPayload).not.toBe(structuredPayload)` + `firstPayload!.structured` toBeUndefined |
| 5 | Finding 2 — clarifying comment + CODE_REVIEW correction | ✅ DONE (anchor drift — see Deviation B) | `6e4a27f` | comment now at `run-loop.ts:367` (plan said `:361`); dated correction block at `_review/CODE_REVIEW.md:71` (file moved from root to `_review/` by `734b185`) |
| 6-7 | Finding 3 — delete `data.ts` + both re-exports | ✅ DONE | `d8d6ffc` | `packages/sdk/js/src/v2/data.ts` absent; `git grep -F "data.js" -- packages/sdk/js/src` → zero hits; stat touched exactly `src/index.ts`, `src/v2/data.ts` (deleted), `src/v2/index.ts` |
| 3, 8 | Typecheck/tests + graph analysis | ✅ DONE | — | tests for finding 1 live in the characterization suite (Deviation A) |

### Deviations

- **Deviation A — regression test relocated.** The plan's Step 4 specified adding the capture to `structured-output-integration.test.ts`. The test was instead added to `packages/opencode/test/session/run-loop.characterization.test.ts:609-619` (file first created in `6e4a27f`, +120 lines). Reconfirmed 2026-09-22: `structured-output-integration.test.ts` still has zero `Bus.subscribe`/capture infrastructure. The plan's premise ("no existing capture infra in that file") was true, but the executing change chose the characterization suite as the better home.
- **Deviation B — anchor drift.** Plan cited `run-loop.ts:361` for the Finding-2 comment and `:340-345`/`:348-356` for Finding 1; actual post-fix anchors are `:367`, `:340-348`, `:351-363` (file is now 384 lines). Plan also asserted `CODE_REVIEW.md` was UNTRACKED at repo root — it is now TRACKED at `_review/CODE_REVIEW.md` (committed in `a68c62f`, moved to `_review/` by `734b185`). Original prose above is preserved as pre-execution intent; do not re-apply the "add regression test to structured-output-integration.test.ts" instruction.

### Cross-plan note

The "ordering conflict" recorded in `_plan/repo-hygiene-2026-09-22.md:77-79` (this plan's stale root/untracked assumptions vs the repo reorg) is **RESOLVED** — both this plan and `_plan/verify-arch-review-2026-09-22.md` are fully executed, and the review docs now live tracked under `_review/`.
