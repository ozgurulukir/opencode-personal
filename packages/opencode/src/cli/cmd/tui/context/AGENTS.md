# TUI event context

## `useEvent()` filters the replay envelope

`event.ts` drops events where `payload.type === "sync"`. This filters only the
versioned replay envelope; native `session.next.*` events arrive through the
raw global event path and are handled directly by `sync.tsx`.

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
