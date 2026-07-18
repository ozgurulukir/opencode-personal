# SyncEvent System

## Global event stream wraps events in a `sync` envelope

`SyncEvent.process()` (`sync/index.ts:322-333`) wraps every event in `{ type: "sync", syncEvent: { type: "message.part.updated.1", ...event } }` before emitting to `GlobalBus`. The `type` field has a version suffix (`.1`) from `versionedType()`. Consumers of the global SSE stream (`/global/event`) must unwrap this envelope and strip the version suffix — the instance SSE stream (`/event`) delivers unwrapped events directly from the per-instance PubSub.

## `convertEvent` transforms bus payloads

The `convertEvent` callback (`sync/index.ts:197, 221`) transforms event data before publishing to the bus. Currently only used for `session.updated` events (`server/projectors.ts:11-24`) to expand the persisted data into a `{ sessionID, info }` shape. Other event types pass through unchanged. Adding a new SyncEvent that needs a different bus shape requires updating this callback.

## BusEvent vs SyncEvent: different delivery paths

`BusEvent` (e.g. `message.part.delta`) goes through `Bus.publish()` directly — no sync envelope, no version suffix, no DB persistence. `SyncEvent` (e.g. `message.part.updated`) goes through `SyncEvent.process()` — persisted to DB, wrapped in sync envelope, versioned. Consumers subscribing to the global event stream see both, but SyncEvents arrive wrapped while BusEvents arrive raw.
