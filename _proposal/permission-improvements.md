# Permission System — Comprehensive Improvement Specification & Architecture

**Date:** 2026-08-16  
**Scope:** `packages/opencode/src/permission/`, `packages/opencode/src/server/routes/instance/httpapi/`, `packages/opencode/src/agent/`, `packages/sdk/js/`  
**Status:** Verified Proposal & Implementation Blueprint  
**Teamwork Audit:** Persistence & Concurrency Specialist, Security & API Surface Specialist, Architectural Reviewer  

---

## Executive Summary

A comprehensive multi-agent audit of the permission subsystem was conducted to verify and expand the initial findings. The audit identified and verified 4 core issues and 2 supplementary architectural edge cases:

1. **Transaction Inversion Bug (High):** `reply("always")` mutated the shared in-memory `approved` array before committing to SQLite (`PermissionTable`), creating split-brain state divergence upon database failures.
2. **Unbounded Duplicate Rules (Medium):** Repeated `reply("always")` invocations append rules without deduplication, causing memory growth, SQLite JSON bloat, and $O(N)$ evaluation latency degradation.
3. **Missing Revocation & Management Surface (Medium):** No programmatic API (Service, HTTP, or SDK) exists to inspect, revoke, or clear persisted `always-allow` rules.
4. **Empty Patterns Fail-Open Security Bypass (Critical):** `Permission.ask()` with `patterns: []` skips the evaluation loop, completely bypassing config deny rules (e.g., `bash: "deny"` or Plan Mode `edit: "deny"`) and auto-allowing tool execution.
5. **Path & Environment Variable Expansion Flaws (Low):** `expand()` in `src/permission/index.ts` contains a substring bug for `$HOME` prefixes and lacks Windows path (`~\`, `%USERPROFILE%`) normalization.
6. **Subagent Deduplication Inefficiency (Low):** `agent/subagent-permissions.ts:dedupe()` used an $O(N^2)$ `unshift` loop instead of an optimal $O(N)$ canonical routine.

This document presents the verified findings, exact code diffs, Effect schema and HTTP API specifications, security proofs, and a phased implementation roadmap.

---

## 1. Item 1: Transaction-First State Synchronization (`reply("always")`)

### 1.1 Problem & Failure Mode
**File:** [`packages/opencode/src/permission/index.ts:300-320`](file:///C:/Github/opencode-personal/packages/opencode/src/permission/index.ts#L300-L320)  
**Severity:** High (State Integrity)

In the current implementation:
```ts
const snapshot = [...approved, ...newRules]
for (const pattern of existing.info.always) {
  approved.push({
    permission: existing.info.permission,
    pattern,
    action: "allow",
  }) // In-memory mutation happens BEFORE DB transaction
}
Database.transaction((db) => {
  db.insert(PermissionTable)
    .values({ project_id: ctx.project.id, data: snapshot })
    .onConflictDoUpdate({ target: PermissionTable.project_id, set: { data: snapshot } })
    .run()
})
```

If `Database.transaction` throws (e.g., `SQLITE_BUSY`, disk I/O error, locking conflict, or unhandled defect):
- The in-memory `approved` array already contains the new rules.
- Subsequent `ask()` calls in the active process evaluate against the mutated `approved` array and allow operations that were never persisted.
- On process restart or cache eviction (`InstanceState` reload), the rules are missing from SQLite.

### 1.2 Resolution: Atomic Commit-First Sequence
1. Prepare the candidate ruleset immutably using the canonical `dedupe` function.
2. Execute the SQLite transaction first.
3. Upon transaction success, update the in-memory `approved` array in-place via `approved.splice(0, approved.length, ...nextApproved)`.
4. Resolve sibling pending requests in the same session.

```ts
// packages/opencode/src/permission/index.ts
const ctx = yield* InstanceState.context
const newRules: Array<{ permission: string; pattern: string; action: "allow" }> = existing.info.always.map((pattern) => ({
  permission: existing.info.permission,
  pattern,
  action: "allow",
}))

// 1. Compute candidate state without mutating approved
const nextApproved = dedupe([...approved, ...newRules])

// 2. Commit to database first
Database.transaction((db) => {
  db.insert(PermissionTable)
    .values({ project_id: ctx.project.id, data: nextApproved })
    .onConflictDoUpdate({ target: PermissionTable.project_id, set: { data: nextApproved } })
    .run()
})

// 3. Mutate in-memory state only after successful commit
approved.splice(0, approved.length, ...nextApproved)

// 4. Resolve sibling pending requests in same session
for (const [id, item] of pending.entries()) {
  if (item.info.sessionID !== existing.info.sessionID) continue
  const ok = item.info.patterns.every(
    (pattern) => evaluate(item.info.permission, pattern, approved).action === "allow",
  )
  if (!ok) continue
  pending.delete(id)
  yield* bus.publish(Event.Replied, {
    sessionID: item.info.sessionID,
    requestID: item.info.id,
    reply: "always",
  })
  yield* Deferred.succeed(item.deferred, undefined)
}
```

---

## 2. Item 2: Canonical $O(N)$ Deduplication Strategy

### 2.1 Problem & Root Cause
**File:** [`packages/opencode/src/permission/index.ts:300-320`](file:///C:/Github/opencode-personal/packages/opencode/src/permission/index.ts#L300-L320) & [`packages/opencode/src/agent/subagent-permissions.ts:10-21`](file:///C:/Github/opencode-personal/packages/opencode/src/agent/subagent-permissions.ts#L10-L21)  
**Severity:** Medium (Performance & Memory)

1. Repeated "always" approvals for identical permissions (or overlapping globs) continuously append to `approved`, inflating SQLite JSON payloads and slowing down `Permission.evaluate()` (`rules.findLast(...)`).
2. The deduplication helper in `agent/subagent-permissions.ts` used `result.unshift(rule)` inside a loop, resulting in $O(N^2)$ execution.

### 2.2 Resolution: Exported Canonical $O(N)$ Deduplication
Define and export `dedupe` in `packages/opencode/src/permission/index.ts`:

```ts
/**
 * Deduplicate a permission ruleset by `permission:pattern` key, preserving
 * last-occurrence order (last match wins in Permission.evaluate).
 * Time complexity: O(N), Space complexity: O(N).
 */
export function dedupe(rules: Ruleset): Ruleset {
  const seen = new Set<string>()
  const result: Rule[] = []
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]
    const key = `${rule.permission}:${rule.pattern}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(rule)
  }
  return result.reverse()
}
```

### 2.3 Integration Points
- **Service Initialization (`InstanceState.make`):** Sanitize legacy DB data on load: `approved: dedupe(row?.data ?? [])`.
- **`reply("always")`:** Dedupe before DB write and in-memory update.
- **Revoke / Clear operations:** Ensure resulting rulesets remain normalized.
- **Subagent Permissions:** Replace local `dedupe` in `agent/subagent-permissions.ts` with `Permission.dedupe`.

---

## 3. Item 3: End-to-End Revocation & Permission Management Surface

### 3.1 Problem
**Files:** [`packages/opencode/src/permission/index.ts:145-149`](file:///C:/Github/opencode-personal/packages/opencode/src/permission/index.ts#L145-L149), [`packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts`](file:///C:/Github/opencode-personal/packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts), [`packages/opencode/src/server/routes/instance/httpapi/handlers/permission.ts`](file:///C:/Github/opencode-personal/packages/opencode/src/server/routes/instance/httpapi/handlers/permission.ts)  
**Severity:** Medium (Feature Gap & Safety)

Currently, `Permission.Service` only supports `ask`, `reply`, and `list` (pending requests). Users cannot inspect approved rules, revoke accidental permissions, or clear persisted grants without manually editing SQLite.

### 3.2 Resolution: Full-Stack Implementation

#### A. Core Service Interface & Implementation (`src/permission/index.ts`)
```ts
export const RemoveApprovedInput = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.optional(Schema.String),
})
  .annotate({ identifier: "PermissionRemoveApprovedInput" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type RemoveApprovedInput = Schema.Schema.Type<typeof RemoveApprovedInput>

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<void, Error>
  readonly reply: (input: ReplyInput) => Effect.Effect<void>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
  readonly listApproved: () => Effect.Effect<ReadonlyArray<Rule>>
  readonly removeApproved: (input: RemoveApprovedInput) => Effect.Effect<boolean>
  readonly clearApproved: () => Effect.Effect<boolean>
}
```

Implementation in `Permission.layer`:
```ts
const listApproved = Effect.fn("Permission.listApproved")(function* () {
  const { approved } = yield* InstanceState.get(state)
  return [...approved]
})

const removeApproved = Effect.fn("Permission.removeApproved")(function* (input: RemoveApprovedInput) {
  const { approved } = yield* InstanceState.get(state)
  const nextApproved = approved.filter((rule) => {
    if (rule.permission !== input.permission) return true
    if (input.pattern !== undefined && rule.pattern !== input.pattern) return true
    return false
  })
  if (nextApproved.length === approved.length) return false

  const ctx = yield* InstanceState.context
  Database.transaction((db) => {
    if (nextApproved.length === 0) {
      db.delete(PermissionTable)
        .where(eq(PermissionTable.project_id, ctx.project.id))
        .run()
    } else {
      db.insert(PermissionTable)
        .values({ project_id: ctx.project.id, data: nextApproved })
        .onConflictDoUpdate({ target: PermissionTable.project_id, set: { data: nextApproved } })
        .run()
    }
  })

  approved.splice(0, approved.length, ...nextApproved)
  return true
})

const clearApproved = Effect.fn("Permission.clearApproved")(function* () {
  const { approved } = yield* InstanceState.get(state)
  if (approved.length === 0) return true

  const ctx = yield* InstanceState.context
  Database.transaction((db) => {
    db.delete(PermissionTable)
      .where(eq(PermissionTable.project_id, ctx.project.id))
      .run()
  })

  approved.splice(0, approved.length)
  return true
})
```

#### B. HttpApi Group Definition (`src/server/routes/instance/httpapi/groups/permission.ts`)
```ts
const RemoveApprovedPayload = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.optional(Schema.String),
})

// Added to HttpApiGroup.make("permission"):
HttpApiEndpoint.get("listApproved", `${root}/approved`, {
  query: WorkspaceRoutingQuery,
  success: described(Schema.Array(Permission.Rule), "List of approved permissions"),
}).annotateMerge(
  OpenApi.annotations({
    identifier: "permission.listApproved",
    summary: "List approved permissions",
    description: "Get all persisted always-allow permission rules for this project.",
  }),
),

HttpApiEndpoint.post("removeApproved", `${root}/approved/remove`, {
  query: WorkspaceRoutingQuery,
  payload: RemoveApprovedPayload,
  success: described(Schema.Boolean, "Approved permission rule removed successfully"),
  error: HttpApiError.BadRequest,
}).annotateMerge(
  OpenApi.annotations({
    identifier: "permission.removeApproved",
    summary: "Revoke approved permission",
    description: "Revoke a specific always-allowed permission rule or all rules for a permission key.",
  }),
),

HttpApiEndpoint.post("clearApproved", `${root}/approved/clear`, {
  query: WorkspaceRoutingQuery,
  success: described(Schema.Boolean, "All approved permissions cleared successfully"),
}).annotateMerge(
  OpenApi.annotations({
    identifier: "permission.clearApproved",
    summary: "Clear all approved permissions",
    description: "Clear all persisted always-allow permission rules for this project.",
  }),
),
```

#### C. HttpApi Handler Layer (`src/server/routes/instance/httpapi/handlers/permission.ts`)
```ts
const listApproved = Effect.fn("PermissionHttpApi.listApproved")(function* () {
  return yield* svc.listApproved()
})

const removeApproved = Effect.fn("PermissionHttpApi.removeApproved")(function* (ctx: {
  payload: { permission: string; pattern?: string }
}) {
  return yield* svc.removeApproved(ctx.payload)
})

const clearApproved = Effect.fn("PermissionHttpApi.clearApproved")(function* () {
  return yield* svc.clearApproved()
})

return handlers
  .handle("list", list)
  .handle("reply", reply)
  .handle("listApproved", listApproved)
  .handle("removeApproved", removeApproved)
  .handle("clearApproved", clearApproved)
```

#### D. SDK Surface (`packages/sdk/js`)
After regenerating via `bun script/build.ts`, the TypeScript SDK gains:
```ts
client.permission.listApproved({ directory?: string, workspace?: string })
client.permission.removeApproved({ permission: string, pattern?: string, directory?: string })
client.permission.clearApproved({ directory?: string, workspace?: string })
```

---

## 4. Item 4: Fail-Closed Protection for Empty Patterns

### 4.1 Problem & Security Vulnerability
**File:** [`packages/opencode/src/permission/index.ts:207-225`](file:///C:/Github/opencode-personal/packages/opencode/src/permission/index.ts#L207-L225)  
**Severity:** Critical (Security Bypass)

In `Permission.ask()`:
```ts
let needsAsk = false
for (const pattern of request.patterns) {
  const configRule = evalRule(request.permission, pattern, ruleset)
  if (configRule.action === "deny") {
    return yield* new DeniedError(...)
  }
  // ...
  needsAsk = true
}
if (!needsAsk) return // Succeeded immediately when patterns === []
```

If any tool passes `patterns: []` (e.g., zero-diff patch in `apply_patch.ts`, unparsed shell tokens in `execute.ts`, or third-party plugin tools), the loop executes 0 times, `needsAsk` remains `false`, and `ask()` returns successfully. **Config deny rules (e.g., `bash: "deny"` or Plan Mode `edit: "deny"`) are completely bypassed.**

### 4.2 Resolution: Fail-Closed Normalization
Normalize `patterns` and `always` to default to `["*"]` when empty:

```ts
const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
  const { approved, pending } = yield* InstanceState.get(state)
  const { ruleset, timeoutMs, ...request } = input

  // Enforce fail-closed defaults: empty patterns evaluate against catch-all "*"
  const patterns = request.patterns.length > 0 ? request.patterns : ["*"]
  const always = request.always.length > 0 ? request.always : patterns
  let needsAsk = false

  for (const pattern of patterns) {
    const configRule = evalRule(request.permission, pattern, ruleset)
    if (configRule.action === "deny") {
      log.info("evaluated", { permission: request.permission, pattern, action: configRule })
      return yield* new DeniedError({
        ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
      })
    }
    const approvedRule = evalRule(request.permission, pattern, approved)
    log.info("evaluated", { permission: request.permission, pattern, config: configRule.action, approved: approvedRule.action })
    if (approvedRule.action === "allow") continue
    if (configRule.action === "allow") continue
    needsAsk = true
  }

  if (!needsAsk) return

  const id = request.id ?? PermissionID.ascending()
  const info = Schema.decodeUnknownSync(Request)({
    id,
    ...request,
    patterns,
    always,
  })
  // ... proceed to prompt user ...
})
```

---

## 5. Supplementary Improvements: Path Expansion & Wildcard Consistency

### 5.1 Environment Variable & Windows Path Expansion
**File:** [`packages/opencode/src/permission/index.ts:346-352`](file:///C:/Github/opencode-personal/packages/opencode/src/permission/index.ts#L346-L352)

**Current Code:**
```ts
function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5) // BUG: Corrupts $HOME_XYZ
  return pattern
}
```

**Refactored Implementation:**
```ts
function expand(pattern: string): string {
  const home = os.homedir()
  const normalized = pattern.replace(/\\/g, "/")
  if (normalized.startsWith("~/")) return home + normalized.slice(1)
  if (normalized === "~") return home
  if (normalized.startsWith("$HOME/")) return home + normalized.slice(5)
  if (normalized === "$HOME") return home
  if (process.platform === "win32" && process.env.USERPROFILE) {
    const userProfile = process.env.USERPROFILE.replace(/\\/g, "/")
    if (normalized.startsWith("%USERPROFILE%/")) return home + normalized.slice(13)
    if (normalized === "%USERPROFILE%") return home
  }
  return pattern
}
```

---

## 6. Testing Strategy & ScopedCache Isolation

### 6.1 Test Hermeticity Rules
Per repository standards in `packages/opencode/test/AGENTS.md`:
1. **Always use `withDir({ git: true }, ...)`**: Generates a distinct temporary git directory with unique `ProjectID`, ensuring separate SQLite keys and `ScopedCache` instances.
2. **Deterministic Pattern Keys**: Use unique pattern names (e.g., `unique-pattern-revoke-1`) across tests.
3. **Verify Instance Disposal and Reload**: Use `reloadTestInstance({ directory: dir })` to guarantee persistence across process restarts.

### 6.2 Target Characterization Tests (`test/permission/next.test.ts`)
- `reply - transaction failure does not corrupt in-memory approved array`
- `reply - deduplicates approved rules on concurrent always replies`
- `removeApproved - revokes rule and persists across instance reload`
- `clearApproved - deletes all approved rules from SQLite and memory`
- `ask - empty patterns array evaluates against catch-all and respects deny rule`
- `expand - correctly handles Windows paths and prevents $HOME_DIR corruption`

---

## 7. Implementation Roadmap & Checklist

| Phase | Description | Files Affected | Risk |
| :--- | :--- | :--- | :--- |
| **Phase 1: Security & Transaction Fix** | Fix `ask()` fail-closed pattern guard, commit-first ordering in `reply("always")`, and $O(N)$ `dedupe()`. | `src/permission/index.ts`, `src/agent/subagent-permissions.ts` | Low (Critical bugfix) |
| **Phase 2: Core Service Revocation** | Implement `listApproved()`, `removeApproved()`, and `clearApproved()` in `Permission.Service`. | `src/permission/index.ts` | Low (Additive) |
| **Phase 3: HttpApi & SDK Wiring** | Add endpoints in `groups/permission.ts`, handlers in `handlers/permission.ts`, and regenerate SDK (`bun script/build.ts`). | `server/routes/.../groups/permission.ts`, `handlers/permission.ts`, `packages/sdk/js` | Low (Additive) |
| **Phase 4: Characterization Tests & Docs** | Add test suite in `test/permission/next.test.ts` and update `packages/opencode/src/permission/AGENTS.md`. | `test/permission/next.test.ts`, `src/permission/AGENTS.md` | Zero |
