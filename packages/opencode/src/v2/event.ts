import { Identifier } from "@/id/id"
import { SyncEvent } from "@/sync"
import { withStatics } from "@opencode-ai/core/schema"
import * as Schema from "effect/Schema"
import { reviveDateTimeUtc } from "./schema"

/**
 * Rebuilds `data.timestamp` into a `DateTime.Utc` before a V2 event reaches its
 * projector. Every V2 event spreads `Base`, so one wiring covers them all.
 * Live emissions already carry a `DateTime` (idempotent no-op); replayed rows
 * carry the encoded form (`DateTime` → ISO string under JSON serialization).
 */
function reviveEventTimestamp(data: unknown): unknown {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return data
  const record = data as Record<string, unknown>
  if (!("timestamp" in record)) return data
  return { ...record, timestamp: reviveDateTimeUtc(record.timestamp) }
}

export const ID = Schema.String.pipe(
  Schema.brand("Event.ID"),
  withStatics((s) => ({
    create: () => s.make(Identifier.create("evt", "ascending")),
  })),
)
export type ID = Schema.Schema.Type<typeof ID>

export function define<const Type extends string, Fields extends Schema.Struct.Fields>(input: {
  type: Type
  schema: Fields
  aggregate: string
  version?: number
}) {
  const Payload = Schema.Struct({
    id: ID,
    metadata: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
    type: Schema.Literal(input.type),
    data: Schema.Struct(input.schema),
  }).annotate({
    identifier: input.type,
  })

  const Sync = SyncEvent.define({
    type: input.type,
    version: input.version ?? 1,
    aggregate: input.aggregate,
    schema: Payload.fields.data,
    revive: reviveEventTimestamp,
  })

  return Object.assign(Payload, {
    Sync,
    version: input.version,
    aggregate: input.aggregate,
  })
}

export * as EventV2 from "./event"
