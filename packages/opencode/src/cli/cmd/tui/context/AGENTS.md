# TUI event context

## `useEvent()` filters the replay envelope

`event.ts` drops events where `payload.type === "sync"`. This filters only the
versioned replay envelope; native `session.next.*` events arrive through the
raw global event path and are handled directly by `sync.tsx`.

Message-state events (`prompted`, `step.*`, `text.*`, `tool.*`, `reasoning.*`,
`compaction.*`, `shell.*`, `synthetic`) route through one fall-through case
group into `reduceMessageEvent` (`sync-messages.shared.ts`) — a pure reducer
that mutates the caller-owned message draft in place, newest-first. Do not add
new message-state logic inline in `sync.tsx`; extend the reducer and pin the
behavior in `test/cli/cmd/tui/sync-messages.test.ts` (the tool
pending/running guards and out-of-order no-ops are the fragile part).
`eventTime` for timestamp normalization comes from
`@opencode-ai/sdk/v2/event-time` — do not re-copy it.

## Native permission payloads

`session.next.permission.asked` keeps the established `PermissionRequest`
object under `event.properties.request`. The V2 schema intentionally exposes
that field as `unknown`, so the TUI narrows it once at the event boundary.

The TUI message and part slices are V2-backed now. `question.*`, `lsp.updated`,
`vcs.branch.updated`, and `server.instance.disposed` remain V1-vocabulary
infrastructure events until their separate migration is scheduled.

## `session.next.updated` is a partial patch keyed by `sessionID`

`session.next.updated` carries `info` as a **partial patch**, not a full
session — e.g. `{title}`, or `{summary, time, revert}`, with **no `id`**
(emitted by `Session.setRevert`/`patch`). `sync.tsx` reconciles by the event's
`sessionID` and merges the patch onto the existing entry, including nested
`time` fields, while preserving unrelated session metadata. Unknown IDs are
ignored until a full session load supplies the required fields. Do NOT search
the store by `info.id` (often `undefined` for partial patches) — that fails to
find the session, mis-inserts a broken entry, and leaves the session stale (e.g.
the TUI never learns about a `session.revert`, so undo can't clear the screen
back to the previous state).

## Live session synchronization and tool-event ordering

- `sync.tsx` handles `session.created`, `session.updated`, and `session.deleted`
  on the live event stream. New sessions must be inserted into the id-sorted
  `store.session` immediately; waiting for bootstrap/refresh makes subagent
  sessions unreachable from TUI navigation, including Ctrl+X.
- A live `session.created` event must use the same `sessionListQuery()` path
  semantics as `session.list`: an empty/undefined path is project-wide, while a
  non-empty path accepts only that path or a descendant, with Windows path
  separators normalized to `/`. Events from another directory must not leak
  into the active session list.
- `session.next.tool.progress` can arrive before `session.next.tool.called`.
  `reduceMessageEvent` must preserve pending tool metadata/content and promote
  the pending tool to running when progress is the first event; otherwise task
  navigation loses the child `sessionId` and structured metadata.
- `session.next.permission.asked` keeps the child request's `sessionID`. The
  session route aggregates pending permission/question requests across the full
  descendant subtree, so nested subagent asks reach the parent TUI and replies
  are sent back to the child session that is waiting.
