# Web package guide

This package follows the root [AGENTS.md](../AGENTS.md) for general repo rules.

## Share page — WebSocket message conversion gate

`Share.tsx:128-135` is the sole conversion point for incoming WebSocket messages:

- V1 messages: identified by `"metadata" in d.content`; converted via `fromV1()`.
- V2 messages: pass through as-is; their `parts` must already be populated or the message renders blank.

`SessionMessage.Shell` (`type: "shell"`) is V2-only. Its `metadata` field is optional in the schema and is **not populated by the projector**, so `"metadata" in d.content` returns `false` and shell messages bypass `fromV1()`. They arrive with `parts: []`, causing the `Part` component to render nothing.

**Fix**: Add a `d.content.type === "shell"` check before the metadata check and convert via `fromShell()`, which maps the shell message to an assistant message with a single `tool: "bash"` part.

## `BashTool` expected state shape

`part.tsx:629-637` (`BashTool`) reads:
- `state.input.command` — the command string
- `state.metadata.output` — the output to render
- `state.metadata.description` — the description shown in the tool title

When constructing a synthetic bash tool part (e.g., from `fromShell()`), match this exact shape or `ContentBash` renders blank.

## Translated docs share identical code blocks

`content/docs/<locale>/skills.mdx` mirrors (17 locales) keep code blocks byte-identical to the English source; only prose is translated. Bulk doc edits can string-replace the shared code line across all locales in one pass; prose changes must be translated per locale.
