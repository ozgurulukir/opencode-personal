# FilterCompacted Regression Lock — docs + test (no production change)

Date: 2026-09-15

**Status:** ⬜ PENDING (re-verified 2026-09-23; prior review 2026-09-22) — neither deliverable landed: the regression test for the no-`tail_start_id` pre-boundary-history case is absent from `test/session/messages-pagination.test.ts`, and the false claim still stands at `packages/opencode/src/session/AGENTS.md:76-78` (now with a **confirmed stale internal anchor** — see the Rev 2026-09-23 note under Verified anchors). Plan tracked in `e54ba95`.

Risk mitigated: motivating PR #139 was CLOSED unmerged (re-confirmed via `gh pr view 139` on 2026-09-23), so the load-bearing block survives at `message-v2.ts:662`.
Author: planner (verified against tree)

## Goal

Two deliverables, **docs + test only — no production behavior change**:

1. **Add a regression test** that locks the current, correct behavior of
   `MessageV2.filterCompacted`: when a compaction marker has
   `tail_start_id === undefined` **and** there IS pre-boundary history, the
   pre-boundary messages are dropped and the result is
   `[compaction-user, summary, ...post-summary]`.
2. **Correct a false claim** in `packages/opencode/src/session/AGENTS.md`
   (section "`filterCompacted` has unreachable dead code") that is being used
   verbatim to justify deleting a **load-bearing** block in PR #139.

## Problem statement

PR #139 (`🎨 Palette: Session Module Bug Fixes`) proposes deleting the block at
`packages/opencode/src/session/message-v2.ts:659-666` on the claim — taken
verbatim from `packages/opencode/src/session/AGENTS.md` — that it is
"unreachable dead code."

That claim is **false**:

- `stream()` yields messages **newest-first**: `page()` orders DESC
  (`message-v2.ts:521`), then `items.reverse()` to ASC (`:539`), then `stream()`
  flips back to DESC (`:554-555`).
- Therefore the summary assistant is visited **before** its parent user message,
  so `completed.add(msg.info.parentID)` (`:668`) runs first, and the block at
  `:659-666` **does** fire on the user message. It is reachable.
- The block has two effects:
  1. `retain = part.tail_start_id` + `break`/`continue` — **redundant** with the
     final reorder slice (`:670-697`), safe to drop.
  2. `if (!part.tail_start_id) break` (`:662`) — **NOT redundant.** This is the
     only thing that drops all pre-compaction history when the compaction marker
     has no `tail_start_id`.

`tail_start_id` is genuinely `undefined` in production:
`compaction.ts:275` (`tailTurns <= 0`), `:278` (no turns), `:315`
(`!keep || keep.start === 0`). Tests `compaction.test.ts:1341` and `:1377`
assert `tail_start_id` is `undefined` — proving this state is real ("falls back
to full summary when even one recent turn exceeds preserve token budget").

If the block is removed: `tailIndex === -1`, the reorder guard
`tailIndex >= 0 && ...` (`:690`) is false, and `filterCompacted` returns
`result` = the **entire uncompacted history alongside the summary**. Compaction
stops trimming → context regrows → repeat overflow/compaction (the
double-compaction bug class already documented in AGENTS.md).

**No existing test covers this.** The pagination `filterCompacted` tests either
supply a `tail_start_id` (e.g. "retains original tail…", `:788`) or have no
messages before the compaction boundary (e.g. "stops at compaction boundary…",
`:680`, where the compaction user is the first message). So CI is green on
PR #139 and the regression would ship silently.

## Verified anchors (all confirmed against the current tree)

| Anchor | Status |
| --- | --- |
| `message-v2.ts:659-666` — `if (msg.info.role === "user" && completed.has(msg.info.id))` block; `if (!part.tail_start_id) break` at `:662` | ✅ matches |
| `message-v2.ts:668` — `completed.add(msg.info.parentID)` | ✅ matches |
| `message-v2.ts:521` — `page()` `orderBy(desc(time_created), desc(id))` | ✅ matches |
| `message-v2.ts:539` — `items.reverse()` | ✅ matches |
| `message-v2.ts:554-555` — `stream()` yields newest-first | ✅ matches |
| `message-v2.ts:670-697` — reorder slice; `tailIndex` guard at `:690` | ✅ matches |
| `compaction.ts:275` — `limit <= 0` → `tail_start_id: undefined` | ✅ matches |
| `compaction.ts:278` — no turns → `tail_start_id: undefined` | ✅ matches |
| `compaction.ts:315` — `!keep \|\| keep.start === 0` → `tail_start_id: undefined` | ✅ matches |
| `compaction.test.ts:1341` — `expect(part?.tail_start_id).toBeUndefined()` | ✅ matches |
| `compaction.test.ts:1377` — `expect(part?.tail_start_id).toBeUndefined()` | ✅ matches |
| `messages-pagination.test.ts:662` — `describe("MessageV2.filterCompacted")` | ✅ matches |
| `messages-pagination.test.ts:64` — `addUser` helper | ✅ matches |
| `messages-pagination.test.ts:88` — `addAssistant` helper | ✅ matches |
| `messages-pagination.test.ts:114` — `addCompactionPart(sessionID, messageID, tailStartID?)` | ✅ matches |
| `messages-pagination.test.ts:680` — "stops at compaction boundary" test (compaction user is FIRST message; no pre-boundary history) | ✅ matches — confirms the coverage gap |
| `session/AGENTS.md:76-78` — "### `filterCompacted` has unreachable dead code" | ✅ matches — note its internal line refs (`:651-652`, `:643`) are stale; the actual block is `:659-666` |

No anchor drift. The AGENTS.md section's *internal* line numbers are stale but
the section itself is present verbatim.

> **Rev 2026-09-23 — re-verified; stale-anchor detail CONFIRMED with current lines.** All load-bearing anchors above re-checked against the tree (HEAD `52aafc1`) and still accurate: `if (!part.tail_start_id) break` at `packages/opencode/src/session/message-v2.ts:662`; `filterCompacted` starts at `:649`; the `role === "user" && completed.has(msg.info.id)` block opens at `:659` with the `.find` compaction-part check at `:660` (and the reorder-slice scans: a `.some` at `:674` and a `.find` at `:677-678`); `completed.add(msg.info.parentID)` at `:668`; reorder slice `:670-697`. `tail_start_id` producers unchanged (`compaction.ts:275,278,315`) and consumer tests still assert `undefined` (`compaction.test.ts:1341,1377`).
>
> **Stale AGENTS.md anchor — confirmed and now precisely mapped.** `packages/opencode/src/session/AGENTS.md:76-78` still carries the section "`filterCompacted` has unreachable dead code" citing `message-v2.ts:651-652` plus a "line 643 already handles" reference. In the CURRENT tree `:651-652` is `const completed = new Set<string>()` / `let retain: MessageID | undefined` (declaration lines, not the condition), and the condition the note describes (`msg.info.role === "user" && completed.has(msg.info.id)` with the compaction-part check) now sits at `message-v2.ts:659` (the check itself is a `.find` at `:660`; the later reorder-slice scans use `.some` at `:674` and `.find` at `:677-678`). So the note's own line refs are doubly stale (both `:651-652` and `:643` have drifted) — Step 2's replacement text should cite `:659-666` and drop the `:643` reference.
>
> **Regression test — still absent.** `test/session/messages-pagination.test.ts` (`describe("MessageV2.filterCompacted")` at `:662`; helpers `addUser` `:64`, `addAssistant` `:88`, `addCompactionPart` `:114`) still only covers the `tail_start_id`-present case ("retains original tail when compaction stores tail_start_id", `:788`) and the fork-remap case (`:844`) — no test exercises the `!part.tail_start_id` early-`break` path with pre-boundary history. The "stops at compaction boundary" test (`:680`) still has the compaction user as the first message, so it cannot catch the deletion.
>
> **The AGENTS.md claim itself — still FALSE, still unresolved.** The block remains reachable: `stream()` still yields newest-first (`page()` DESC orderBy at `message-v2.ts:521`, `items.reverse()` at `:539`, `stream()` re-flips to DESC), so the summary assistant is visited before its parent user message and `completed.add(msg.info.parentID)` runs first. The claim was not resolved anywhere since the 2026-09-22 review (`git log` on `message-v2.ts` since then: only `857b145`/`27b6eee`, both predating the plan). Status stays ⬜ PENDING.

## Steps

### Step 1 — Add regression test to `packages/opencode/test/session/messages-pagination.test.ts`

**Where:** inside the existing `describe("MessageV2.filterCompacted", ...)`
block (`:662`), after the "stops at compaction boundary and returns
chronological order" test (`:680-717`). Reuses the existing helpers
`addUser`/`addAssistant`/`addCompactionPart` and the `WithInstance.provide`
pattern already used throughout the file.

**Fixture** (chronological):
- `u1` = `addUser(session.id, "old")` — plain user, pre-boundary
- `u2` = `addUser(session.id, "second")` — plain user, pre-boundary
- `c1` = `addUser(session.id, "compact")` — compaction user
- `await addCompactionPart(session.id, c1)` — **no tail arg** → `tail_start_id` undefined
- `s1` = `addAssistant(session.id, c1, { summary: true, finish: "end_turn" })` + a text part
- `u3` = `addUser(session.id, "after")` — post-boundary

**Assertion:**
```ts
const result = MessageV2.filterCompacted(MessageV2.stream(session.id))
expect(result.map((item) => item.info.id)).toEqual([c1, s1, u3])
```
i.e. `u1` and `u2` are dropped.

**Behavior trace (why the assertion is correct):**
- Stream (newest-first): `u3, s1, c1, u2, u1`.
- `u3` pushed; `s1` pushed + `completed.add(c1)` (`:668`); `c1` pushed, then the
  block at `:659-666` fires: compaction part found, `!part.tail_start_id` →
  `break` at `:662`. `u2`/`u1` never visited.
- `result.reverse()` → `[c1, s1, u3]`. Reorder guard (`:690`) is false
  (`tailIndex === -1` because `tail_start_id` is undefined) → returns
  `[c1, s1, u3]`. ✅

**Acceptance criterion (the point of the test):** with the block at
`message-v2.ts:659-666` deleted, the trace becomes: `u3, s1, c1, u2, u1` all
pushed → reverse → `[u1, u2, c1, s1, u3]` → guard false → returns the **entire
history**. The assertion `toEqual([c1, s1, u3])` **fails**. The test therefore
locks the load-bearing behavior.

**Style notes for the coder:**
- Follow the existing test style in the file (plain `test(...)` + `WithInstance.provide`, `await svc.remove(session.id)` at the end, comment explaining the stream order like the `:686-687` comment).
- The existing `addCompactionPart` helper uses `as any` (`:122`) — reuse the helper as-is; do not add new casts.
- No new dependencies.

### Step 2 — Correct the false claim in `packages/opencode/src/session/AGENTS.md`

**Where:** replace the section at `:76-78`.

**Current (false) text:**
```markdown
### `filterCompacted` has unreachable dead code

`message-v2.ts:651-652` — the condition `msg.info.role === "user" && completed.has(msg.info.id) && msg.parts.some(...)` is unreachable. Line 643 already handles the same condition with `continue`/`break` for all sub-cases. Remove it if found.
```

**Replacement (accurate, terse, consistent with surrounding doc style):**
```markdown
### `filterCompacted` user-in-`completed` block is reachable — do NOT remove the `!part.tail_start_id` break

`message-v2.ts:659-666` — `stream()` yields newest-first (`page()` DESC at `:521`, `stream()` re-flips to DESC at `:554-555`), so the summary assistant is visited before its parent user message and `completed.add(msg.info.parentID)` (`:668`) runs first — the block DOES fire on the compaction user message. The `retain`/`break`/`continue` half is redundant with the reorder slice (`:670-697`), but `if (!part.tail_start_id) break` (`:662`) is load-bearing: it is the only thing that drops all pre-compaction history when the marker has no `tail_start_id` (`compaction.ts:275,278,315`; asserted `undefined` in `compaction.test.ts:1341,1377`). Removing it returns the full uncompacted history alongside the summary (context regrows → repeat compaction). Locked by `messages-pagination.test.ts` "drops pre-compaction history when compaction marker has no tail_start_id".
```

### Step 3 — Verify

From `packages/opencode` (tests cannot run from repo root):

```bash
bun test test/session/messages-pagination.test.ts -t "filterCompacted"
```

- **Passes on current code** — confirms the test locks existing behavior.
- **Acceptance criterion:** temporarily delete `message-v2.ts:659-666`, re-run
  the same command, confirm the new test **fails** (expected `[c1, s1, u3]`,
  got the full history), then restore the block. (The coder must NOT commit the
  temporary deletion — it is a verification-only step.)

Also run the full file once (not just `-t`) to catch order-dependent leakage,
per the repo's testing rules.

## Architecture Decisions

- **Test over production change:** AGENTS.md Rule 3 mandates characterization/
  regression tests before any refactor. PR #139 proposes deleting production
  code; the correct response is to lock the behavior with a test first, then let
  the PR's deletion be judged against it. No production behavior change here.
- **Test home — `messages-pagination.test.ts`:** it already owns the
  `filterCompacted` describe block with the exact helpers needed
  (`addUser`, `addAssistant`, `addCompactionPart(sessionID, messageID, tailStartID?)`)
  and the `WithInstance.provide` harness. No new test file, no new fixtures.
- **Fixture mirrors the existing "stops at compaction boundary" test (`:680`)**
  but adds pre-boundary messages (`u1`, `u2`) — that is precisely the missing
  coverage: the existing test's compaction user is the *first* message, so it
  cannot distinguish "break at boundary" from "return everything."
- **Full-id-array assertion over length/`[0]` checks:** the existing boundary
  test asserts only `result[0]` and `result.length`; asserting the exact id
  array `[c1, s1, u3]` makes the regression unambiguous (the buggy output
  `[u1, u2, c1, s1, u3]` has the same length as the correct one — length alone
  would not catch it).
- **AGENTS.md edit is a correction, not a rewrite:** keep the section header
  style and one-paragraph format of the surrounding Compaction docs; only the
  claim and its line refs change, plus a one-line cross-reference to the new
  test. This is the doc that PR #139 quoted, so fixing it removes the
  justification for the deletion.

## Alternatives considered

- **Fix the behavior instead (drop the block + make reorder handle the
  undefined-tail case):** rejected — out of scope. It changes production
  behavior and risks the double-compaction bug class; the plan's mandate is to
  lock current correct behavior, not refactor.
- **Add the test to `compaction.test.ts`:** rejected — that file tests the
  compaction *producer* (`SessionCompaction.process`); `filterCompacted` is a
  `MessageV2` consumer concern already covered in `messages-pagination.test.ts`.
- **Assert only `result.length === 3`:** rejected — see "Full-id-array
  assertion" above; the buggy output has length 5, so length alone does catch
  it in this fixture, but the id-array assertion is stronger and self-documenting.

## Out of scope

- No production behavior change to `filterCompacted` or any other code.
- No refactor of `message-v2.ts` (the block stays as-is).
- No changes to `compaction.ts` or `compaction.test.ts`.
- No new dependencies; no new `as any` casts (the existing helper's cast is reused).
- PR #139 itself is not modified; this plan only removes the false doc claim it
  relied on and adds the test that would catch the regression.

## Open Questions

- None blocking. (The only judgment call — where the test lives and the exact
  assertion shape — is resolved above. The coder may adjust the fixture's
  message text labels, but must keep the structure: pre-boundary plain users,
  compaction marker with no tail arg, summary assistant, post-boundary user.)
