# MCP system

## Tool permission keys use `mcp_` prefix

MCP tool permission keys are `mcp_<sanitized_server>_<sanitized_tool>` (e.g., `mcp_my-server_get-weather`). The `mcp_` prefix is added in `mcp/index.ts:838` so users can configure blanket rules like `mcp_*: "deny"` or `mcp_my-server_*: "allow"` via the permission config rest keys.

## MCP tool patterns derived from args, not always `["*"]`

MCP tools call `ctx.ask()` with patterns derived from the tool's input arguments via `deriveMcpPatterns()` in `session/prompt/mcp-patterns.ts`. It checks common path/URL fields (`filepath`, `path`, `url`, `directory`, `file`, `pattern`, `repo`, `repository`) and falls back to `["*"]` when none are found. This means "always allow" grants access to a specific resource, not all invocations.

## MCP tools go through `Permission.disabled()` filtering

MCP tools are added to the tool map inside `SessionPrompt.resolveTools()` (`session/loop/tools.ts:56`) alongside registry tools. The full map is passed to `llm.stream()` via `StreamInput.tools`, and `llm.ts:492` applies `Permission.disabled()` to all tools including MCP. There is no bypass — MCP tools are filtered the same as built-in tools.
