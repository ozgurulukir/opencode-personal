# App global session sync

## V2 message adapter is the single store boundary

The app rendering chain still consumes V1-shaped `Message`/`Part` slices. Keep
the V2-to-V1 conversion in `v2-adapter.ts`; do not recreate conversion logic in
`sync.tsx`, `event-reducer.ts`, `layout.tsx`, or individual UI components.

- `sessionMessagesToV1()` converts ascending projected V2 history into the
  store's message and part slices. The fetchers request V2 pages newest-first
  and reverse them before conversion.
- The event reducer consumes native `session.next.*` events and uses the same
  factories/part-ID scheme as the load path. Deterministic padded part IDs are
  required for sorted inserts and re-fetch merges.
- Shell and compaction messages expand into the legacy renderer's wrapper
  shapes. Synthetic messages become parts only when `parseCommentNote()` marks
  them as renderable comment notes.
- Optimistic prompt confirmation matches prompt text, not message ID: V2
  message IDs are server event IDs and differ from the client's optimistic ID.
- `question.*`, `lsp.updated`, `vcs.branch.updated`, and
  `server.instance.disposed` remain infrastructure events outside the V2
  message projection. Preserve their existing handlers.

The V1-shaped store and renderer are an intentional compatibility boundary for
this batch. A future renderer migration must replace the adapter and its tests
as one change; it is not part of the deferred 5f deletion pass.

## Tests and completion gate

Update `v2-adapter.test.ts`, `event-reducer.test.ts`, and the optimistic-sync
tests together when changing this boundary. A change is complete when load and
live event paths produce the same V1 shapes, all relevant app tests pass, and
`bun typecheck` passes from `packages/app`.
