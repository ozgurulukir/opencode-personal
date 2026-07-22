# TUI event context

## `useEvent()` filters sync envelope, not all SyncEvents

`event.ts:11-13` drops events where `payload.type === "sync"`. This only filters the versioned sync envelope copy (path 2 of SyncEvent dual delivery). SyncEvents also arrive as raw `{ type, properties }` payloads via the Bus publish path (path 1), so handlers for `message.updated`, `message.part.updated`, etc. in `sync.tsx` are reachable.

## `message.part.updated.batch` is not in the SDK Event type

The batch variant of part updates (`message.part.updated.batch`, emitted by `sessions.updateParts()`) has no entry in the SDK's `Event` union type (`types.gen.ts`). Adding a handler for it needs `@ts-expect-error` or `as unknown` casts. The event IS delivered at runtime through the Bus path — only the TypeScript type is missing.

## `message.part.updated.batch` handler is easy to miss in `sync.tsx`

`sessions.updateParts()` fires `MessageV2.Event.PartUpdatedBatch` (a single batch event with a `parts` array), NOT individual `message.part.updated` events per part. The TUI sync store at `sync.tsx` had a handler for single `message.part.updated` but not the batch variant. When adding a new SyncEvent that publishes parts in batch, check both the single and batch handler exist.
