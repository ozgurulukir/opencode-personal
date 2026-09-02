# Permission System — Improvement Opportunities

**Date:** 2026-08-15  
**Scope:** `packages/opencode/src/permission/`  
**Status:** Findings only — no changes applied

## Summary

The permission subsystem is largely well-structured: `evaluate()` is correct, `disabled()` was recently fixed, and the `ask()` split-evaluation logic properly protects the deny-invariant. Four items remain: one active bug, one correctness/memory issue, one missing feature, and one behavioral edge case.

---

## 1. Bug — In-memory state mutated before DB write

**File:** `packages/opencode/src/permission/index.ts:306-319`  
**Severity:** High

`reply("always")` pushes new rules into the in-memory `approved` array **before** the `Database.transaction` upsert runs:

```ts
const snapshot = [...approved, ...newRules]
for (const pattern of existing.info.always) {
  approved.push({ permission, pattern, action: "allow" })  // mutated here
}
Database.transaction((db) => {
  db.insert(PermissionTable).values({ project_id, data: snapshot }).onConflictDoUpdate(...)
})
```

If the transaction throws, `approved` is already mutated but the DB row is unchanged — the in-memory and persisted state diverge. Subsequent `ask()` calls in the same process see the new rules; after a restart they do not.

**Fix:** move the `approved.push(...)` loop inside or after the transaction callback.

---

## 2. Duplicate rules in `approved` from concurrent `reply("always")`

**File:** `packages/opencode/src/permission/index.ts:306-313`  
**Severity:** Medium

Two concurrent "always" replies for the same `(permission, pattern)` both call `approved.push(...)`, producing duplicate entries. Over time this:

- Leaks memory (unbounded growth of the in-memory array)
- Slows `evaluate()` (larger array for `findLast`)
- Risks incorrect results if duplicates ever carry conflicting actions

The same deduplication pattern already exists in `packages/opencode/src/agent/subagent-permissions.ts:dedupe()` — a `(permission, pattern)` key with last-occurrence-wins semantics.

**Fix:** deduplicate `approved` after each `reply("always")`, or dedupe the `snapshot` before the DB upsert.

---

## 3. No way to revoke an "always allow"

**File:** `packages/opencode/src/permission/index.ts:145-149`  
**Severity:** Low (usability)

`Permission.Service` exposes `ask`, `reply`, `list` — but no `remove` or `clear`. A user who accidentally "always allow"s a dangerous pattern has no programmatic undo; the only recourse is deleting the `PermissionTable` row manually.

**Fix:** add `remove(permission, pattern)` and `clear()` methods to the service interface, backed by a delete/upsert on `PermissionTable`.

---

## 4. Empty `patterns` silently auto-allows

**File:** `packages/opencode/src/permission/index.ts:207-223`  
**Severity:** Low (behavioral edge case)

If `request.patterns` is empty, the `for` loop never runs, `needsAsk` stays `false`, and `ask()` returns without prompting. Any tool call that passes no patterns is silently approved regardless of the ruleset.

This may be intentional for internal callers, but it is undocumented and worth either asking by default or adding an explicit guard with a comment.

---

## Priority order

| # | Item | Priority |
|---|------|----------|
| 1 | Mutate-after-DB-write | Fix first — correctness |
| 2 | Duplicate rules in `approved` | Fix second — correctness + memory |
| 3 | Revoke "always allow" | Feature addition |
| 4 | Empty `patterns` auto-allow | Document or guard |
