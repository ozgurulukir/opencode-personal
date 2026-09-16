# ACP (Agent Client Protocol) Implementation

This directory contains a clean, protocol-compliant implementation of the [Agent Client Protocol](https://agentclientprotocol.com/) for opencode.

## Architecture

The implementation follows a clean separation of concerns:

### Core Components

- **`agent.ts`** - Implements the `Agent` interface from `@agentclientprotocol/sdk`
  - Handles initialization and capability negotiation
  - Manages session lifecycle and prompt handling
  - Implements client-side capability calls such as permission, file-write,
    and terminal requests on the injected `AgentSideConnection`

- **`session.ts`** - Session state management
  - Creates and tracks ACP sessions
  - Maps ACP sessions to internal opencode sessions
  - Maintains working directory context
  - Handles MCP server configurations

- **`cli/cmd/acp.ts`** - ACP process entry point
  - Starts the internal OpenCode HTTP server
  - Creates the SDK client used by the ACP agent
  - Connects the official JSON-RPC-over-stdio stream

- **`types.ts`** - Type definitions for internal use

## Usage

### Command Line

```bash
# Start the ACP server in the current directory
opencode acp

# Start in a specific directory
opencode acp --cwd /path/to/project
```

### Question Tool Opt-In

ACP excludes `QuestionTool` by default.

```bash
OPENCODE_ENABLE_QUESTION_TOOL=1 opencode acp
```

Enable this only for ACP clients that support interactive question prompts.

### Integration with Zed

Add to your Zed configuration (`~/.config/zed/settings.json`):

```json
{
  "agent_servers": {
    "OpenCode": {
      "command": "opencode",
      "args": ["acp"]
    }
  }
}
```

## Protocol Compliance

This implementation follows the ACP specification v1:

✅ **Initialization**

- Proper `initialize` request/response with protocol version negotiation
- Capability advertisement (`agentCapabilities`)
- Authentication is advertised as an auth method, but the ACP
  `authenticate` request is not implemented; users must run
  `opencode auth login` out-of-band.

✅ **Session Management**

- `session/new` - Create new conversation sessions
- `session/load` - Resume existing sessions (basic support)
- Working directory context (`cwd`)
- MCP server configuration support

✅ **Prompting**

- `session/prompt` - Process user messages
- Content block handling (text, resources)
- Response with stop reasons

✅ **Client Capabilities**

- Client-side file writes for accepted edit permissions; file reads remain local
- Permission requests
- Terminal support via the client terminal backend when advertised

## Current Limitations

### Implemented

1. **Streaming Responses** - Streams progressive responses via `session/update` notifications (text deltas, reasoning chunks)
2. **Tool Call Reporting** - Reports tool execution progress (pending → in_progress → completed/failed) with content, diffs, and raw output
3. **Session Modes** - Mode switching via `setSessionMode` and `setSessionConfigOption`
4. **Session Persistence** - `session/load` replays full conversation history including tool calls
5. **Plan Updates** - `todowrite` tool results are forwarded as `plan` session updates
6. **Usage Tracking** - Token usage and cost reported via `usage_update` notifications
7. **Permission Requests** - Forwarded to ACP client with allow/reject options

### Terminal execution

When the client advertises `clientCapabilities.terminal: true`, ACP shell
commands are created through `terminal/create`. The terminal is embedded in
the tool call for live rendering; final output is collected with `waitForExit`
and `currentOutput`, then the terminal is released. Clients without this
capability use the existing local shell backend. Set
`OPENCODE_ACP_TERMINAL_BACKEND=client` to require the client terminal, or
`local` to disable it; the default `auto` mode selects it only when the
capability is advertised.

Terminal selection is scoped to each ACP session. A failed `terminal/create`
request is not silently retried locally, preventing double execution.
Session close and interrupted executions kill active client terminals before
releasing them, and cleanup is idempotent.

### Not Yet Implemented

1. **Authentication** - No actual auth implementation (stub)
2. **Zed smoke coverage** - A real Zed session is still required for manual
   verification of live terminal rendering.

### Future Enhancements

- **Enhanced Permissions**: More sophisticated permission handling
- **Protocol Authentication**: End-to-end ACP authentication when supported

## Testing

```bash
# Run ACP tests
bun test test/acp.test.ts

# Test manually with stdio
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}' | opencode acp
```

## Design Decisions

### Why the Official Library?

We use `@agentclientprotocol/sdk` instead of implementing JSON-RPC ourselves because:

- Ensures protocol compliance
- Handles edge cases and future protocol versions
- Reduces maintenance burden
- Works with other ACP clients automatically

### Runtime architecture

`opencode acp` starts the normal OpenCode HTTP server and points an
`OpencodeClient` at it. The ACP `Agent` translates protocol requests and V2
session events into ACP responses and notifications. Session state is managed
by `session.ts`; terminal handles are managed per ACP session by
`terminal-backend.ts`. There are no separate `client.ts` or `server.ts`
modules in this implementation.

### Mapping to OpenCode

ACP sessions map cleanly to opencode's internal session model:

- ACP `session/new` → creates internal Session
- ACP `session/prompt` → uses SessionPrompt.prompt()
- Working directory context preserved per-session
- Tool execution uses existing ToolRegistry

## References

- [ACP Specification](https://agentclientprotocol.com/)
- [TypeScript Library](https://github.com/agentclientprotocol/typescript-sdk)
- [Protocol Examples](https://github.com/agentclientprotocol/typescript-sdk/tree/main/src/examples)
