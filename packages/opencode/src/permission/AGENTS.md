# Permission system

## `disabled()` — only catch-all deny hides tools from the LLM

`Permission.disabled()` only removes a tool from the LLM's tool list when there's a catch-all deny (`pattern === "*"`) that isn't overridden by a specific allow/ask rule. Specific pattern denies (e.g., `edit: { "*.env": "deny" }`) never hide the tool — non-matching patterns default to `"ask"` at runtime, so the tool must stay visible for those cases.

## `Wildcard.match` does exact glob matching, not prefix matching

`Wildcard.match('mcp_my-server_get-weather', 'mcp')` returns `false`. A config key like `mcp` does NOT match `mcp_*` permission keys. To match all MCP tools, users must write `mcp_*` (which works via the rest keys schema), not `mcp`. This applies to all permission keys — a short key only matches itself literally, not as a prefix.

## `fromConfig` converts config to ruleset — no special expansion

`Permission.fromConfig()` iterates config entries and creates rules directly. It does NOT expand shorthand keys (e.g., `mcp` → `mcp_*`). Any such expansion would need to be added explicitly in `fromConfig()`.

## `evaluate()` — last-match-wins, default "ask"

`Permission.evaluate(permission, pattern, ...rulesets)` flattens all rulesets then uses `findLast` — the **last** matching rule wins. This means `Permission.merge(agent, session)` puts session rules last, so session overrides agent. If no rule matches, the default is `{ action: "ask" }` — tool calls require user approval unless explicitly allowed.

## `Permission.merge` is `rulesets.flat()` — order matters

`Permission.merge(...rulesets)` simply concatenates: `[...ruleset1, ...ruleset2, ...]`. Combined with `findLast`, later rulesets override earlier ones. When merging agent + session permissions, session comes last and wins conflicts.

## `ask()` evaluation order — DB-persisted approvals vs config rules

`Permission.ask()` calls `evaluate(permission, pattern, approved, ruleset)` where `findLast` processes `[...approved, ...ruleset]`. Because `ruleset` comes **after** `approved`, any matching config rule (agent/session permission) overrides a DB-persisted "always allow" — even if that config rule is just `"ask"`. This silently breaks "always allow" for any permission that has an `"ask"` rule in the agent defaults (e.g., `external_directory: { "*": "ask" }`, `doom_loop: "ask"`, `read: { "*.env": "ask" }`).

The fix in `ask()` splits evaluation: (1) deny from `ruleset` wins immediately (security invariant), (2) "allow" from `approved` overrides "ask" from `ruleset`, (3) config "allow" is still respected, (4) default to "ask". Do NOT change `evaluate()` itself — it is correct for single-ruleset use. The split must happen at the call site.

## Shell ask patterns and always globs are token-aligned

The shell tool derives `patterns` (what `ask()` evaluates on future calls) from `tool/shell/helpers.ts source()` and the `always` globs (what `reply("always")` persists) from `BashArity.prefix(parts()` tokens`) + " *"`. These MUST start at the same first token — if `source()` keeps a prefix that `parts()` drops (PowerShell `&`/`.` invocation operators, bash `VAR=...` assignments, line continuations), the stored glob can never `Wildcard.match` a future ask pattern and "allow always" re-prompts forever. Changes to `PART_TYPES`, `parts()`, or `BashArity.prefix` must keep `source()` in lockstep; the `always patterns match an ask pattern` tests in `test/tool/shell.test.ts` lock this invariant.

## Test isolation — `ScopedCache` state leaks between permission tests

`Permission.layer` uses `InstanceState.make` backed by `ScopedCache`. `disposeAllInstances()` invalidates entries asynchronously (`Effect.runPromise`), so a test that replies `"always"` can leak its `approved` ruleset into subsequent tests that use the same temp directory. This is pre-existing and masked by the old evaluation order (config `ruleset` would override leaked `approved` anyway). When fixing permission logic, verify with `bun test test/permission/ -t "always"` to confirm new tests don't break unrelated ones.

## `reply("always")` persists to database before mutating in-memory state

When the user replies with `"always"`, the candidate ruleset is deduplicated and committed to `PermissionTable` (keyed by `project_id`) before the in-memory `approved` array is mutated in-place via `approved.splice()`. This guarantees that database write errors do not leave the in-memory state out of sync with disk.

## `dedupe()` — O(N) last-match-wins deduplication

`Permission.dedupe(rules)` deduplicates rules by `permission:pattern` key using reverse iteration + `.reverse()`. It is run on service load (`InstanceState.make`), during `reply("always")`, and during revocation operations to prevent duplicate rules in SQLite and memory.

## `ask()` fail-closed guard for empty patterns

When `request.patterns` is empty (`[]`), `Permission.ask()` normalizes it to `["*"]` so that config deny rules (e.g. `bash: "deny"` or Plan Mode `edit: "deny"`) are strictly enforced rather than silently bypassed.

## Revocation APIs — `removeApproved()` and `clearApproved()`

`Permission.Service` exposes `listApproved()`, `removeApproved({ permission, pattern? })`, and `clearApproved()`. Revocation updates both the in-memory `approved` array and the `PermissionTable` database row atomically.

## Timeout alarm must use `Effect.raceFirst`, not `Effect.race`

`ask()` boundaries its `Deferred.await` with `Effect.raceFirst(await, sleep→fail)` (`index.ts`). `Effect.race` returns only the first branch to **succeed**, so a failing timeout branch would be ignored and the hang would persist; `Effect.raceFirst` returns whichever branch completes first (success **or** failure). Use `raceFirst` whenever a timeout branch is intended to win on expiry.

## `ask()` timeout broadcasts a synthetic `Event.Replied(reject)` on expiry

When the permission ask times out (`PERMISSION_ASK_TIMEOUT_MS` default 5 min, overridable via `AskInput.timeoutMs`), `ask()` publishes a synthetic `Event.Replied({ reply: "reject" })` before failing with `TimedOutError`. This is so the TUI/run/store remove the stale pending prompt (they clean up on `reply`, not on the ask error itself). A nested subagent whose ask is never surfaced still hangs until this timeout fires — the synthetic reply is what unblocks the store.
