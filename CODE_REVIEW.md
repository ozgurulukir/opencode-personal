# Codebase Review - Verification Report

**Branch:** main  ·  **Working dir:** C:/Github/opencode-personal
**Method:** Three agents reviewed different sections (read-only). Each finding was
then re-verified line-by-line against the actual source in this tree.

> ## Integrity notice
> The original report contained several citations that did NOT match the code.
> This document records every finding with its verification status, plus the
> specific corrections and retractions. The goal is a trustworthy list, not a
> longer one.

---

## Verdict summary

| # | Location | Finding | Verified? | Severity |
|---|----------|---------|-----------|----------|
| 1 | run-loop.ts:341-342 | handle.message mutated before persist | YES (re-cited) | Medium |
| 2 | run-loop.ts:361 | compaction.create return discarded -> always continues | YES | Medium |
| 3 | sdk/src/v2/data.ts:12-26 | Hardcoded id "asdasd" collides parts | Real but NO callers (dead code) | Low |
| 4 | sdk/src/v2/data.ts:27 | as Part cast hides type mismatch | YES (latent) | Low |
| RETRACTED | run-loop.ts:94 | step never incremented | NO | - |
| RETRACTED | run-loop.ts:98 | busy never resets to idle | NO | - |
| RETRACTED | transform.ts:231-234 | unsafe literal injected | NO | - |
| RETRACTED | transform.ts:1161-1167 | Gemini sanitize skips nested nodes | NO | - |
| RETRACTED | sdk/src/v2/types.gen.ts | v1 directory required vs v2 optional | NO (invented type) | - |
| WEAK | sdk/src/v2/server.ts:43-103 | readiness not validated; abort race | Largely inaccurate | Low |

---

## Verified findings (real defects / risks)

### 1. handle.message mutated before being persisted -- run-loop.ts:340-343
```ts
if (structured !== undefined) {
  handle.message.structured = structured       // mutate
  handle.message.finish = handle.message.finish ?? "stop"
  yield* deps.sessions.updateMessage(handle.message)   // then persist
}
```
**What is real:** handle.message is mutated in place (.structured, .finish) after
the stream already ran, and *then* saved. Any listener keyed on message identity
(e.g. sync -- see packages/app/src/components/* which read sync.data.message) can
observe the object between the mutation and the persist, or observe a stale
reference once updateMessage swaps in a new view.

**Citation correction:** the original report cited lines 308-309 ("reassign +
mutate"). Those lines are the Effect.gen close bracket and
`const format = lastUser.format ?? ...` -- they are unrelated to handle.message.
The mutation is genuinely at 341-342. Severity reflects a real-but-narrow
concern, not the dramatic "stale-reference hazard" framing used originally.

**Suggestion:** build a fresh copy (spread handle.message with updated fields) and
pass that to updateMessage; do not mutate the live handle object.

### 2. compaction.create result discarded, loop always continues -- run-loop.ts:361-369
```ts
if (result === "compact") {
  yield* deps.compaction.create({...})   // return value ignored
}
return "continue" as const                 // always continues
```
**What is real:** deps.compaction.create returns an Effect of "continue" | "stop".
Its result is not consulted -- when a model emits compact, the loop always
returns "continue" and spins again, even if compaction signalled stop.

**Suggestion:** capture the result of deps.compaction.create and, if it is
"stop", return "break" before falling through.

> **Correction (2026-09-22) — finding #2 is INVALID; recommendation voided.**
> Verified against the working tree: `SessionCompaction.Interface.create`
> returns `Effect.Effect<void>` (`packages/opencode/src/session/compaction.ts:214-223`),
> and its implementation returns nothing (`compaction.ts:677-711`). The
> `"continue" | "stop"` union the finding cites belongs to
> `SessionCompaction.Interface.process` (`compaction.ts:207-213`) — a different
> method that is not called at `run-loop.ts:361`. The loop's own
> `"break" | "continue"` control signal already derives from the processor's
> `Result` (`"compact" | "stop" | "continue"`), which is what `result` at line
> 359 handles; after compaction, `"continue"` is correct because the next
> iteration re-reads the compacted messages. No code change was made for this
> finding; a one-line clarifying comment was added at the `result === "compact"`
> branch to prevent the false positive recurring.

### 3. Hardcoded id "asdasd" in sdk/src/v2/data.ts:12,25
**What is real:** every user-message part gets the identical literal id and the
same messageID. If this module were wired into a request, all parts of every
message would collide and the server could not distinguish them by id.

**Important caveat - VERIFIED:** a repo-wide search for imports of this module
from "./data" / data.message found ZERO callers in packages/sdk/js/src/v2. It
appears to be dead/unused code (the live path uses sync.data.message in the app
and a different client path). The bug is latent: worth deleting or fixing, but
not a live defect today. Severity downgraded to Low.

### 4. as Part cast hides type mismatch -- sdk/src/v2/data.ts:27
**What is real:** the as Part cast suppresses the Omit<Part,...> guard, so a field
that no longer matches Part is silently coerced instead of rejected at compile
time. Latent (see #3: no callers). Severity Low.

---

## Retracted findings (verified as incorrect in this tree)

### RETRACTED: step never incremented -- run-loop.ts
step is declared at line 94, INCREMENTED at line 137 (step++), and used at lines
138 (if (step === 1)), 218 (isLastStep = step >= maxSteps), and 287 (if (step > 1
&& lastFinished)). The step cap and max-steps guard are intact.

### RETRACTED: busy never resets to idle -- run-loop.ts
Busy is reset by the runner onIdle handler in session/run-state.ts:59
(status.set(sessionID, { type: "idle" })), plus a dedicated reset in
processor.ts:736 (status.set(ctx.sessionID, { type: "idle" })) on error/abort.
The busy->idle transition is handled by the SessionRunState state machine, not
inside run-loop.

### RETRACTED: unsafe literal injected into ModelMessageContent -- transform.ts:231-234
This is a legitimate guard that REMOVES a raw image part and returns a safe,
user-facing text message when an image is empty or corrupted ("ERROR: Image file
is empty or corrupted..."). It sanitizes input; it does not inject it. Good code.

### RETRACTED: Gemini enum rewrite skips nested nodes -- transform.ts:1161-1167
sanitizeGemini recurses at transform.ts:1168-1169 (result[key] = sanitizeGemini(value)),
so nested objects DO get the enum->string rewrite. The "skips nested nodes" claim
contradicts the recursion. The legitimate edge is the separate hasCombiner guard
at transform.ts:1180,1191.

### RETRACTED: v1 directory required vs v2 optional -- types.gen.ts
The SessionInfo type the report anchored on does not exist in
packages/sdk/js/src/v2/gen/types.gen.ts. The actual Session type at line 722
declares directory: string (required), and no contradictory v2 variant exists.
The comparison referenced a type that is not in the file -- built on a
hallucinated anchor.

### WEAK: readiness not validated; abort-path race -- server.ts:43-103
Mostly inaccurate. The code resolves on the "opencode server listening" string and
rejects via a setTimeout (line 44-48) that also calls stop(proc). Readiness is
validated through that string match, and the abort path does call stop. This is a
minor robustness nit at most, not a correctness bug.

---

## Recommendations (prioritized)

1. Fix #2 (run-loop.ts:361) -- lowest-effort, real behavior bug: honor the "stop"
   return of compaction.create.
2. Fix #1 (run-loop.ts:341) -- stop mutating handle.message in place; pass an
   updated copy to updateMessage.
3. Decide on data.ts -- either delete the dead message helper or replace the
   "asdasd" placeholder with a real id and drop the as Part cast.
4. No action needed for the retracted items.
