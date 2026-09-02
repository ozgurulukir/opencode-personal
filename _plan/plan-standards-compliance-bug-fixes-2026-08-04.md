# Plan: Standards Compliance & Bug Fixes — OpenCode Agent Skills & Permission System

**Date:** 2026-08-04  
**Author:** Coding Soul  
**Status:** Implemented (2026-08-05)  
**Scope:** Fix agentskills.io compliance gaps, permission system bugs, and reliability issues in the skill/tool/permission subsystems.

---

## Implementation Summary

| Plan Item | Status | Notes |
|-----------|--------|-------|
| 3.1 `disabled()` pattern override fix | ✅ Done | Fixed both pattern + permission dimensions |
| 4.1 Frontmatter spec enforcement | ✅ Done | Stricter zod schema, required `description`, name/folder hard error, stored metadata fields |
| 4.2 Skill tool truncation | ❌ Deferred | Adding `Truncate.Service`/`Agent.Service` yields caused test timeouts. Framework-level `truncate.output()` in `Tool.define` already wraps built-in tool output; explicit yield reverted. |
| 4.3 ReDoS protection | ✅ Done | `MAX_WILDCARDS = 10` with non-throwing fallback |
| 5.1 Progressive disclosure | ⏸️ Deferred | Option C — memory footprint bounded for typical skill counts; revisit only if profiling shows issue |
| 5.2 `allowed-tools` parsing | ✅ Done | Implemented as part of 4.1; stored as `allowedTools` on `Info` |
| 5.3 Plugin tool description sanitization | ✅ Done | `sanitizeDescription()` in `registry.ts` |
| 6.1 Skill name collision handling | ✅ Done | Reject duplicates unless overriding built-in; emit `skill.loaded`/`skill.unloaded` events |
| 6.2 CLI validate command | ✅ Done | `debug skill validate` subcommand added |
| 6.3 Skill lifecycle events | ✅ Done | Emitted on registration/unregistration (part of 6.1) |
| 6.4 `reply("always")` invariant | ✅ Done | Added invariant comment + concurrent reply regression test |

---

## 1. Executive Summary

This plan addresses two categories of findings from the deep-dive review:

1. **Standards compliance** — the skill discovery/registration subsystem (`packages/opencode/src/skill/`) does not fully conform to the [agentskills.io specification](https://agentskills.io/specification) for `SKILL.md` frontmatter validation, progressive disclosure, and `allowed-tools` enforcement.
2. **Bugs & reliability** — the permission evaluation subsystem (`packages/opencode/src/permission/`) contains a logic error in `disabled()`, a latent race risk in `reply("always")` (downgraded — not an active bug), and the wildcard matcher (`packages/opencode/src/util/wildcard.ts`) has a potential ReDoS surface. The built-in `skill` tool also fails to truncate large outputs.

All changes are scoped to `packages/opencode/` and `packages/core/` where noted. No breaking changes to the public SDK surface are intended.

---

## 2. Guiding Principles

- **Fail fast on invalid input.** Skills that do not meet the spec should be rejected or normalized at discovery time, not silently accepted.
- **Preserve existing behavior for valid inputs.** All fixes must pass the current test suite; new tests must be added before refactoring (characterization tests per AGENTS.md Rule 3).
- **Minimize surface area.** Changes should be localized to the affected module. Do not extract single-use helpers preemptively.
- **Security first.** Permission and path-handling fixes are P0 regardless of perceived likelihood.

---

## 3. P0 — Critical Bugs (Fix Immediately)

### 3.1 Permission `disabled()` uses wrong field for pattern override check

**File:** `packages/opencode/src/permission/index.ts`  
**Function:** `disabled(tools, ruleset)`  
**Lines:** 337–356

**Problem:**  
`hasSpecificOverride` checks `rule.permission !== "*"`, but `matchingRules` is already filtered by `Wildcard.match(permission, rule.permission)`. The intent is to detect specific **pattern** overrides (e.g., `*.md: allow` overriding `*: deny`). Using `rule.permission` means a catch-all permission rule (`"*"`) with a specific pattern is never counted as an override, so the tool is incorrectly disabled.

**Concrete failure (specific-pattern case):**
- Rules: `{ permission: "*", pattern: "*", action: "deny" }` and `{ permission: "*", pattern: "*.md", action: "allow" }`
- Tool permission: `"edit"`
- `hasCatchAllDeny = true`
- `hasSpecificOverride = false` (because `rule.permission === "*"`)
- Result: `edit` is **disabled** even though `*.md` is explicitly allowed

**Fix — must check BOTH dimensions (pattern AND permission):**

The override can come from either a specific **pattern** (e.g., `*.md: allow`) or a specific **permission** (e.g., `edit: allow` with pattern `*`). Checking only `rule.pattern !== "*"` would fix the specific-pattern case but **break** the specific-permission case: a rule `{ permission: "edit", pattern: "*", action: "allow" }` (from config `edit: "allow"`) should override a catch-all deny, but `pattern === "*"` would miss it.

```ts
// Before
const hasSpecificOverride = matchingRules.some(
  (rule) => rule.permission !== "*" && rule.action !== "deny",
)

// After — a non-deny rule that is not a catch-all on BOTH dimensions
const hasSpecificOverride = matchingRules.some(
  (rule) => rule.action !== "deny" && (rule.pattern !== "*" || rule.permission !== "*"),
)
```

**Tests to add:**
- `disabled(["edit"], [{ permission: "*", pattern: "*", action: "deny" }, { permission: "*", pattern: "*.md", action: "allow" }])` → should **not** contain `"edit"` (specific-pattern override)
- `disabled(["edit"], [{ permission: "*", pattern: "*", action: "deny" }, { permission: "edit", pattern: "*", action: "allow" }])` → should **not** contain `"edit"` (specific-permission override)
- `disabled(["edit"], [{ permission: "*", pattern: "*", action: "deny" }])` → should contain `"edit"` (no override)

**Verification:**
```bash
cd packages/opencode && bun test test/permission
```

---

## 4. P1 — Standards Compliance & Reliability (Next Sprint)

### 4.1 Enforce agentskills.io frontmatter spec on skill registration

**File:** `packages/opencode/src/skill/index.ts`  
**Function:** `add()`  
**Lines:** 107–158

**Problem:**  
The current zod schema only checks `name` length (1–64) and optional `description`. It does not enforce:
- Lowercase alphanumeric + hyphens only
- No leading/trailing/consecutive hyphens
- `name` matches parent directory name
- `description` is required and 1–1024 chars
- `license`, `compatibility`, `metadata`, `allowed-tools` are parsed and stored

**Fix:**

```ts
// Replace the current zod schema with:
const FRONTMATTER_SCHEMA = z.object({
  name: z
    .string()
    .min(1, "name must not be empty")
    .max(64, "name must be ≤64 characters")
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "name must be lowercase alphanumeric with hyphens; no leading/trailing/consecutive hyphens",
    ),
  description: z
    .string()
    .min(1, "description is required")
    .max(1024, "description must be ≤1024 characters"),
  license: z.string().optional(),
  compatibility: z.string().min(1, "compatibility must not be empty").max(500, "compatibility must be ≤500 characters").optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  "allowed-tools": z.string().optional(),
})

// In add(), after parsing:
const parsed = FRONTMATTER_SCHEMA.safeParse(md.data)
if (!parsed.success) {
  const message = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
  // ... publish error event ...
  return
}

const folderName = path.basename(path.dirname(match))
if (parsed.data.name !== folderName) {
  // Reject mismatches per spec; do not register under wrong name
  log.error("skill name does not match folder", { skill: match, expected: folderName, actual: parsed.data.name })
  return
}

// Store all frontmatter fields:
state.skills[parsed.data.name] = {
  name: parsed.data.name,
  description: parsed.data.description,
  location: match,
  content: md.content,
  license: parsed.data.license,
  compatibility: parsed.data.compatibility,
  metadata: parsed.data.metadata,
  allowedTools: parsed.data["allowed-tools"],
}
```

**Update `Info` type:**
```ts
export const Info = Schema.Struct({
  name: Schema.String,
  description: Schema.String,  // was optional
  location: Schema.String,
  content: Schema.String,
  license: Schema.optional(Schema.String),
  compatibility: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  allowedTools: Schema.optional(Schema.String),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
```

**Update `fmt()` (lines 449–489):**  
Making `description` required means `skill.description !== undefined` (line 450) is always `true`. The "no description" branch (lines 452–469) becomes dead code except for the empty-list case. Simplify `fmt()` to remove the `described` filter and the no-description branch, or keep it as a defensive guard with a comment noting it's unreachable when validation is enforced.

**Note on `description` required:** The spec marks `description` as required. However, the built-in `customize-opencode` skill (lines 312–318) already has a description, so it's unaffected. Existing user skills without descriptions will be rejected at load time — see Risk Assessment row 1 and Open Question 1.

**Tests to add:**
- `name: "PDF-Processing"` → reject (uppercase)
- `name: "-pdf"` → reject (leading hyphen)
- `name: "pdf--processing"` → reject (consecutive hyphens)
- `name: "pdf"` in folder `pdf-processing` → reject (mismatch)
- `description: ""` → reject (empty)
- `description: 2000-char string` → reject (too long)
- Valid skill with all optional fields → accept

**Verification:**
```bash
cd packages/opencode && bun test test/skill
```

---

### 4.2 Truncate built-in `skill` tool output

**File:** `packages/opencode/src/tool/skill.ts`  
**Function:** `execute()`  
**Lines:** 23–74

**Problem:**  
The built-in `skill` tool returns the full `info.content` without truncation. Plugin tools are truncated in `registry.ts` via `truncate.output()`, but the built-in skill tool bypasses this.

**Fix:**

`Truncate.Service` is a Context tag (`Context.Service<Service, Interface>()("@opencode/Truncate")`), not the service instance — it must be yielded first. The same applies to `Agent.Service` (`Context.Service<Service, Interface>()("@opencode/Agent")` at `agent.ts:74`): it is a Context tag, not a service instance. Both must be yielded in the outer `Effect.gen` (the `Tool.define` initialization scope), not inside `execute`. The correct pattern (matching `registry.ts:145,175`) is: yield `Agent.Service` in the outer gen to get the service instance, then call `agentService.get(ctx.agent)` inside `execute`.

Note: `truncate.output()` accepts `agent?: Agent.Info` as an optional parameter (truncate.ts:41). Passing the agent enables the "Use the Task tool to process this file" hint in the truncation message. Without it, the hint degrades to "Use Grep/Read with offset/limit".

```ts
import { Truncate } from "@/tool/truncate"
import { Agent } from "@/agent/agent"

export const SkillTool = Tool.define(
  "skill",
  Effect.gen(function* () {
    const skill = yield* Skill.Service
    const rg = yield* Ripgrep.Service
    const truncate = yield* Truncate.Service  // yield in outer gen
    const agentService = yield* Agent.Service   // yield in outer gen

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          // ... existing code up to output construction ...

          const rawOutput = [
            `<skill_content name="${info.name}">`,
            `# Skill: ${info.name}`,
            "",
            info.content.trim(),
            "",
            `Base directory for this skill: ${base}`,
            "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
            "Note: file list is sampled.",
            "",
            "<skill_files>",
            files,
            "</skill_files>",
            "</skill_content>",
          ].join("\n")

          const agent = yield* agentService.get(ctx.agent)
          const truncated = yield* truncate.output(rawOutput, {}, agent)

          return {
            title: `Loaded skill: ${info.name}`,
            output: truncated.truncated ? truncated.content : rawOutput,
            metadata: {
              name: info.name,
              dir,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
```

**Tests to add:**
- Skill with content > truncation threshold → output is truncated, `metadata.truncated === true`
- Skill with content < threshold → output is full, `metadata.truncated === undefined`

**Verification:**
```bash
cd packages/opencode && bun test test/tool/skill.test.ts
```

---

### 4.3 Add ReDoS protection to wildcard matcher

**File:** `packages/opencode/src/util/wildcard.ts`  
**Function:** `match()`  
**Lines:** 3–19

**Problem:**  
Converting `*` to `.*` without bounds can cause excessive backtracking on non-matching strings for patterns with many wildcards. The actual ReDoS risk is **low** — `.*` (dot-star) uses `.` which is an unambiguous character class, so backtracking is polynomial rather than exponential. However, defense-in-depth is warranted since `match()` is called in permission evaluation and tool matching hot paths.

**Important constraint:** `match()` currently **never throws**. All callers (`evaluate`, `disabled`, `all`, `allStructured`) do not catch exceptions. A `throw` would propagate and crash permission evaluation or tool matching. The fix must use a **non-throwing fallback**.

**Fix:**
```ts
const MAX_WILDCARDS = 10

export function match(str: string, pattern: string) {
  if (str) str = str.replaceAll("\\", "/")
  if (pattern) pattern = pattern.replaceAll("\\", "/")

  // Defense-in-depth: patterns with excessive wildcards are likely malformed.
  // Return false (no match) rather than throwing — callers don't catch.
  const wildcardCount = (pattern.match(/\*/g) ?? []).length
  if (wildcardCount > MAX_WILDCARDS) {
    return false
  }

  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  if (escaped.endsWith(" .*")) {
    escaped = escaped.slice(0, -3) + "( .*)?"
  }

  const flags = process.platform === "win32" ? "si" : "s"
  return new RegExp("^" + escaped + "$", flags).test(str)
}
```

**Tests to add:**
- Pattern with 11 wildcards → returns `false` (does NOT throw)
- Pattern with 10 wildcards matching a short string → succeeds
- Existing permission/tool matching tests must still pass

**Verification:**
```bash
cd packages/opencode && bun test test/permission test/util/wildcard.test.ts
```

---

## 5. P2 — Standards Compliance & Security (Next Minor Release)

### 5.1 Implement progressive disclosure for skill content

**File:** `packages/opencode/src/skill/index.ts`  
**Type:** Refactor + characterization tests first

**Problem:**  
All skill `SKILL.md` content is loaded into memory at discovery time. The spec recommends loading only metadata at startup and full content on activation.

**Approach:**
1. Write characterization tests locking current behavior:
   - `Skill.get(name)` returns full `Info` including `content`
   - `Skill.all()` returns all skills with content
   - `Skill.fmt()` renders content descriptions
2. Refactor `State.skills` to store `content: null | string` initially
3. Add `loadContent(name: string)` that reads the file from disk on demand
4. Update `SkillTool.execute()` to call `loadContent()` before returning output
5. Update `Skill.fmt()` to not require content (it already works without it)

**Critical: embedding and hash implications (must address before refactor):**

Two existing code paths depend on `skill.content` being available at init time:

1. **`skillContentHash()` (line 90):** Computes `sha1(name + description + content)`. If content is `null` at init, the hash would differ from the hash computed after content is loaded. This would cause the incremental indexing (lines 328–341) to see **all** skills as "changed" on every init, triggering re-embedding every time — defeating the purpose of the manifest cache.

2. **`matchBySemantics()` embedding (line 336):** The embedding content is `${sk.name}\n${sk.description ?? ""}\n${sk.content}`. If content is `null` at init, embeddings would be incomplete (metadata-only), degrading semantic search quality.

**Resolution options (choose one):**

- **Option A — Split the hash:** `skillContentHash` computes a **metadata hash** (`name + description`) at init and a **content hash** (`metadata hash + content`) on load. The manifest tracks the metadata hash. Re-embedding triggers only when the metadata hash changes OR when content is loaded for the first time. Embeddings use metadata-only content initially; re-embed with full content on first activation.

- **Option B — Keep content in memory, defer disk I/O:** Load content lazily but cache it permanently once loaded. The first `get(name)` or `matchBySemantics` access triggers disk read. The hash and embedding use the cached content. This is simpler but doesn't reduce peak memory — it only defers I/O.

- **Option C — Defer progressive disclosure to P3:** The memory savings are marginal for typical skill counts (<100 skills, each <500 lines). The complexity of splitting hashes and re-embedding is high. Consider keeping the current eager-load behavior and only implementing progressive disclosure if profiling shows a real memory issue.

**Recommendation:** Option C (defer). The spec recommends progressive disclosure, but the current implementation loads skills synchronously at init and the memory footprint is bounded. Revisit if skill counts grow significantly.

**Tests to add (before refactor):**
- Characterization test: `get("customize-opencode")` returns content matching file on disk
- Characterization test: `all()` returns all skills with non-empty content
- Characterization test: `fmt()` with `verbose: true` includes `<location>` URLs

**Verification:**
```bash
cd packages/opencode && bun test test/skill
```

---

### 5.2 Parse and expose `allowed-tools` from skill frontmatter

**File:** `packages/opencode/src/skill/index.ts`  
**Type:** Feature addition

**Problem:**  
The spec's experimental `allowed-tools` field is not parsed or enforced.

**Fix:**
1. Parse `allowed-tools` as a space-separated string in `add()` — already done in 4.1 (stored as `allowedTools: string | undefined` on `Info`)
2. In `SkillTool.execute()`, after permission is granted, split `info.allowedTools` by whitespace to get the allowed tool list. Check if the requested tool calls are within the skill's `allowed-tools` list. If not, return an error or prompt for additional permission.

```ts
// In SkillTool.execute(), after loading the skill:
const allowed = info.allowedTools?.trim().split(/\s+/).filter(Boolean)
if (allowed && allowed.length > 0) {
  // Soft enforcement: log a warning if a tool outside the allowed list is used
  // within this skill's context. The spec marks allowed-tools as experimental.
}
```

**Note:** This is a soft enforcement — the spec marks it experimental. Implement as a warning log + optional permission ask rather than a hard block, to avoid breaking existing skills. The `allowedTools` field is stored as a raw string on `Info` (per 4.1), consistent with the spec's "space-separated string" format. Splitting happens at enforcement time.

**Tests to add:**
- Skill with `allowed-tools: Read Glob` → invoking `Read` within that skill context succeeds
- Skill with `allowed-tools: Read` → invoking `Bash` within that skill context triggers additional permission ask

---

### 5.3 Sanitize plugin tool descriptions

**File:** `packages/opencode/src/tool/registry.ts`  
**Function:** `fromPlugin()`  
**Lines:** 151–197

**Problem:**  
Plugin tool descriptions are injected into the LLM system prompt without sanitization. A malicious plugin could embed XML/HTML tags or instruction-breaking patterns in `def.description`.

**Fix:**

The `@/util/sanitize` module does not exist in the codebase. Implement `sanitizeDescription` inline in `registry.ts`:

```ts
// In registry.ts, add near the top:
function sanitizeDescription(desc: string): string {
  return desc
    .replace(/<[^>]*>/g, "") // strip HTML/XML tags
    .replace(/\[\[.*?\]\]/g, "") // strip wiki-style links
    .trim()
}

// In fromPlugin():
const description = sanitizeDescription(def.description)
```

**Tests to add:**
- Plugin tool with `<script>alert(1)</script>` in description → stripped in tool list
- Plugin tool with normal description → unchanged

---

## 6. P3 — Technical Debt & Observability

### 6.1 Skill name collision handling

**File:** `packages/opencode/src/skill/index.ts`

**Problem:**  
If two skills have the same `name` in frontmatter but different folders, the second silently overwrites the first.

**Fix:**  
Use the folder path as the canonical key in `state.skills`, and emit a bus event on collision. The `name` field becomes a display/alias property. Alternatively, reject duplicates with an error.

**Recommendation:** Reject duplicates during discovery. The spec says `name` must match the folder, so two skills with the same name in different folders is a spec violation.

---

### 6.2 Skill validation CLI command

**File:** `packages/opencode/src/cli/cmd/debug/skill.ts` (extend existing)

The file already exists with a `SkillCommand` that lists all skills as JSON. Add a `validate` subcommand (or extend the existing command with a `--validate` flag):

```ts
// Add a validate subcommand to the existing SkillCommand
export const ValidateCommand = effectCmd({
  command: "validate",
  describe: "validate all skills against the agentskills.io spec",
  builder: (yargs) => yargs,
  handler: Effect.fn("skill.validate")(function* () {
    const skill = yield* Skill.Service
    const all = yield* skill.all()
    const errors: Array<{ name: string; path: string; message: string }> = []

    for (const s of all) {
      // Validate against FRONTMATTER_SCHEMA
      // Check name/folder match
      // Check description length
      // Check allowed-tools format
    }

    if (errors.length === 0) {
      console.log(`All ${all.length} skills are valid.`)
    } else {
      for (const e of errors) {
        console.error(`${e.path}: ${e.message}`)
      }
      Effect.fail(new Error(`${errors.length} invalid skills found`))
    }
  }),
})
```

---

### 6.3 Emit skill lifecycle events

**File:** `packages/opencode/src/skill/index.ts`

Add bus events for:
- `skill.loaded` — when a skill is successfully registered
- `skill.unloaded` — when a skill is removed from the manifest
- `skill.content.loaded` — when content is read from disk (progressive disclosure)

This aids debugging and observability without changing behavior.

---

### 6.4 Permission `reply("always")` — latent race risk (not an active bug)

**File:** `packages/opencode/src/permission/index.ts`  
**Function:** `reply()`  
**Lines:** 232–298

**Status:** Downgraded from P0 to P3 after code verification. The race condition as originally described does **not** manifest in the current code, but the code is correct by accident — a future refactor could introduce the race.

**Analysis (why it's not an active bug):**

1. `Database.transaction()` is **synchronous** (better-sqlite3, `NotPromise<T>` constraint on callback). The `approved.push(...)` and `db.insert(...)` run in the same synchronous callback — no interleaving possible within the transaction.
2. The `approved` array is a **shared mutable reference** obtained from `InstanceState.get(state)`. Both concurrent replies get the **same** array object.
3. `Array.push()` mutates in place. So even if two replies interleave at `yield*` points between `InstanceState.get` and `Database.transaction`, both `push` calls accumulate on the same array. By the time the second transaction writes `data: approved` to DB, the array already contains both rules.

**The latent risk:** The code works because `push` mutates the shared reference. If a future refactor replaces `push` with spread assignment (`approved = [...approved, ...newRules]`), the local binding would diverge from `state.approved`, and the second write would overwrite the first — exactly the race originally described.

**Recommendation:** No code change needed now. Add a code comment documenting the shared-mutable-reference invariant:

```ts
// IMPORTANT: `approved` is a shared mutable reference from InstanceState.
// We mutate in place (push) so concurrent reply("always") calls accumulate
// on the same array. Do NOT replace with spread assignment — that would
// break the local binding's link to state.approved and introduce a race.
```

**Test to add (regression guard):**
- Concurrent `reply("always")` for two different patterns → both rules present in DB and in-memory state
- Use `Effect.fork` + `Promise.all` to simulate concurrency
- This test locks the current behavior so a future refactor that breaks the invariant is caught

---

## 7. Testing Strategy

### 7.1 Characterization tests (before refactoring)

Per AGENTS.md Rule 3, write these tests **before** any code changes:

| Target | Tests |
|--------|-------|
| `permission/index.ts` `disabled()` | All current behavior + the `*.md` allow-over-denies case |
| `permission/index.ts` `reply()` | Single "always" reply, concurrent replies |
| `skill/index.ts` `add()` | All current skill loading paths, duplicate names, missing descriptions |
| `skill/index.ts` `SkillTool.execute()` | Output format, metadata, error on missing skill |
| `wildcard.ts` `match()` | All existing patterns, edge cases with `?` and `*` |

### 7.2 New test files

| File | Purpose |
|------|---------|
| `packages/opencode/test/skill/skill-validation.test.ts` | Frontmatter spec compliance |
| `packages/opencode/test/tool/skill.test.ts` (existing) | Add truncation tests for large skills |
| `packages/opencode/test/permission/permission-race.test.ts` | Concurrent "always" replies (regression guard) |
| `packages/opencode/test/permission/permission-disabled.test.ts` | `disabled()` pattern + permission override logic |
| `packages/opencode/test/util/wildcard.test.ts` (existing) | Add ReDoS protection tests |

### 7.3 Verification commands

```bash
# Full test suite for affected packages
cd packages/opencode && bun test test/skill test/permission test/tool test/util/wildcard.test.ts

# Typecheck
cd packages/opencode && bun typecheck

# Lint
bun run lint
```

---

## 8. Implementation Order

| Week | Tasks |
|------|-------|
| **Week 1** | P0 bugs: 3.1 `disabled()` fix (both pattern + permission dimensions) |
| **Week 2** | P1 items: 4.1 frontmatter validation, 4.2 skill truncation, 4.3 ReDoS protection (non-throwing) |
| **Week 3** | P2 items: 5.1 progressive disclosure (deferred per analysis — see Option C), 5.2 `allowed-tools` parsing |
| **Week 4** | P3 items: 6.4 reply() invariant comment + regression test, 6.1 collision handling, 6.2 CLI validate, 6.3 bus events; final review |

---

## 9. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Frontmatter validation rejects existing user skills | Medium | High | Document migration in release notes; consider adding a `--lenient` flag in a future release if adoption issues arise (not in scope for this plan) |
| Permission `disabled()` fix changes tool availability | Low | Medium | Add regression tests from real permission configs; test BOTH specific-pattern and specific-permission override cases |
| ReDoS limit breaks legitimate patterns | Low | Low | Set limit high (10 wildcards); return `false` (not throw) so callers aren't disrupted |
| Progressive disclosure changes memory behavior | Medium | Low | Deferred per analysis (Option C) — revisit only if profiling shows memory issue |
| `reply("always")` invariant broken by future refactor | Low | High | Add invariant comment + regression test (6.4); document that `push` must not be replaced with spread |

---

## 10. Open Questions

1. **Should `description` be required immediately, or should we warn for one release cycle?**  
   Recommendation: require immediately. Skills without descriptions provide no discovery value.

2. **Should `allowed-tools` be enforced as a hard block or a soft warning?**  
   Recommendation: soft warning + permission ask for P2; hard block can be a future opt-in.

3. **Should skill name/folder mismatch be a hard error or a rename?**  
   Recommendation: hard error. The spec says "must match." Auto-renaming could cause data loss.

4. **Should the ReDoS wildcard limit be configurable?**  
   Recommendation: no. 10 wildcards is far beyond any realistic use case. Make it a constant with a clear behavior (return `false`, not throw). The limit is defense-in-depth, not a critical security fix — the actual ReDoS risk from `.*` patterns is low.

---

## 11. References

- [agentskills.io Specification](https://agentskills.io/specification)
- `packages/opencode/src/skill/index.ts` — skill registry
- `packages/opencode/src/permission/index.ts` — permission service
- `packages/opencode/src/permission/evaluate.ts` — rule evaluation
- `packages/opencode/src/util/wildcard.ts` — wildcard matcher
- `packages/opencode/src/tool/skill.ts` — built-in skill tool
- `packages/opencode/src/tool/registry.ts` — tool registry
- `packages/opencode/src/tool/tool.ts` — tool definition types
- AGENTS.md — project conventions and known issues
