# Share-next consumer boundary

`share-next.ts` observes native `SessionEvent.*.Sync` lifecycle, text, tool,
compaction, diff, update, and delete events. Keep the subscriptions on V2
events; the old `MessageV2.Event.*` stream is not the live output source for
this consumer.

The external share API still accepts V1-shaped `message`/`part` payloads. The
coalesced `syncMessages()` compatibility read and the `MessageV2.stream()` full
sync are therefore intentional conversion boundaries. Do not replace them with
raw `SessionMessage` payloads unless the external share protocol changes too.

When adding a new V2 lifecycle event that changes shared session content, add it
to the subscription set and verify that the queued key semantics still leave
the latest message/part data in the delayed flush.
