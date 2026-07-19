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

## `reply("always")` persists to database

When the user replies with `"always"`, the approved ruleset is persisted to `PermissionTable` (keyed by `project_id`). This means "always allow" decisions survive restarts. The ruleset is loaded from the database on service init via `InstanceState.make()`. The `PermissionTable` is an upsert — each project has at most one row containing the full approved ruleset.
