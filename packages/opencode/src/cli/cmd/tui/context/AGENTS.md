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
