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

## Test isolation — `ScopedCache` state leaks between permission tests

`Permission.layer` uses `InstanceState.make` backed by `ScopedCache`. `disposeAllInstances()` invalidates entries asynchronously (`Effect.runPromise`), so a test that replies `"always"` can leak its `approved` ruleset into subsequent tests that use the same temp directory. This is pre-existing and masked by the old evaluation order (config `ruleset` would override leaked `approved` anyway). When fixing permission logic, verify with `bun test test/permission/ -t "always"` to confirm new tests don't break unrelated ones.

## `reply("always")` persists to database

When the user replies with `"always"`, the approved ruleset is persisted to `PermissionTable` (keyed by `project_id`). This means "always allow" decisions survive restarts. The ruleset is loaded from the database on service init via `InstanceState.make()`. The `PermissionTable` is an upsert — each project has at most one row containing the full approved ruleset.

## Pre-existing flaky test: `reply - reject cancels all pending for same session`

The test `reply - reject cancels all pending for same session` (`test/permission/next.test.ts`) fails intermittently in the full suite but passes in isolation. Not caused by recent changes.

## Permission snapshot — comment vs reality

The comment in `reply()` says "snapshot prevents race" but the real safety comes from
JavaScript's single-threaded execution and the synchronous `Database.transaction`.
Effect's cooperative scheduling can interleave yields between `approved.push()` and
the upsert, but the snapshot ensures the DB write is atomic regardless. The comment
has been updated to reflect the actual guarantees.

## Timeout alarm must use `Effect.raceFirst`, not `Effect.race`

`ask()` boundaries its `Deferred.await` with `Effect.raceFirst(await, sleep→fail)` (`index.ts`). `Effect.race` returns only the first branch to **succeed**, so a failing timeout branch would be ignored and the hang would persist; `Effect.raceFirst` returns whichever branch completes first (success **or** failure). Use `raceFirst` whenever a timeout branch is intended to win on expiry.

## `ask()` timeout broadcasts a synthetic `Event.Replied(reject)` on expiry

When the permission ask times out (`PERMISSION_ASK_TIMEOUT_MS` default 5 min, overridable via `AskInput.timeoutMs`), `ask()` publishes a synthetic `Event.Replied({ reply: "reject" })` before failing with `TimedOutError`. This is so the TUI/run/store remove the stale pending prompt (they clean up on `reply`, not on the ask error itself). A nested subagent whose ask is never surfaced still hangs until this timeout fires — the synthetic reply is what unblocks the store.
