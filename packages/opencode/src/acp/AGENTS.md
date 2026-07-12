# ACP Agent Implementation Guide

## `McpServer` type narrowing

`McpServer` is a union of four variants: `McpServerHttp & { type: "http" }`, `McpServerSse & { type: "sse" }`, `McpServerAcp & { type: "acp" }`, and `McpServerStdio` (no `type` field).

- `McpServerAcp` has `name` and `id` only — no `url` or `headers`. The old `"type" in server` check is insufficient because `McpServerAcp` also has `type`. Check `server.type === "http" || server.type === "sse"` to narrow to variants with `url`/`headers`.
- `McpServerStdio` is the only variant without a `type` field. Use `"type" in server` to distinguish Stdio from the other three.

## `setSessionMode` vs `setSessionConfigOption`

The SDK renamed `unstable_setSessionModel` to `setSessionMode`, but the new method sets the **mode** (not the model). Setting the model is now done via `setSessionConfigOption` with `configId: "model"`. The old `unstable_setSessionModel` method should be removed entirely when upgrading — its functionality is fully covered by `setSessionConfigOption`.
