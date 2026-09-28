# Web package guide

This package follows the root [AGENTS.md](../AGENTS.md) for general repo rules.

## Share page — WebSocket message conversion gate

`Share.tsx:128-135` is the sole conversion point for incoming WebSocket messages:

- V1 messages: identified by `"metadata" in d.content`; converted via `fromV1()`.
- V2 messages: pass through as-is; their `parts` must already be populated or the message renders blank.

`SessionMessage.Shell` (`type: "shell"`) is V2-only. Its `metadata` field is optional in the schema and is **not populated by the projector**, so `"metadata" in d.content` returns `false` and shell messages bypass `fromV1()`. They arrive with `parts: []`, causing the `Part` component to render nothing.

**Fix**: Add a `d.content.type === "shell"` check before the metadata check and convert via `fromShell()`, which maps the shell message to an assistant message with a single `tool: "bash"` part.

The current `share-next` producer intentionally sends V1-shaped message/part
payloads at the external share API boundary, so `fromV1()` remains live. Keep
the shell and V2 branches for payloads produced by newer share producers.

## `BashTool` expected state shape

`part.tsx:629-637` (`BashTool`) reads:
- `state.input.command` — the command string
- `state.metadata.output` — the output to render
- `state.metadata.description` — the description shown in the tool title

When constructing a synthetic bash tool part (e.g., from `fromShell()`), match this exact shape or `ContentBash` renders blank.

## Translated docs (English + Turkish only)

Docs ship in English (root) and Turkish (`content/docs/tr/`); locale routing (`src/i18n/locales.ts`) declares only `root` + `tr`. `content/docs/tr/skills.mdx` keeps code blocks byte-identical to the English source; only prose is translated. When editing shared code lines, apply the identical change to the English page and its `tr/` mirror; prose changes must be translated.
