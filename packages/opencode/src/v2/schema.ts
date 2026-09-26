import { DateTime, Schema, SchemaGetter } from "effect"

export const DateTimeUtcFromMillis = Schema.Finite.pipe(
  Schema.decodeTo(Schema.DateTimeUtc, {
    decode: SchemaGetter.transform((value) => DateTime.makeUnsafe(value)),
    encode: SchemaGetter.transform((value) => DateTime.toEpochMillis(value)),
  }),
)

/**
 * Rebuilds a `DateTime.Utc` from a value that may have crossed a JSON boundary.
 * Accepts an existing `DateTime` (already-live payloads), a finite epoch-millis
 * number, or an ISO string (the form `JSON.stringify(DateTime)` produces). Any
 * other shape — or an unparseable string — throws: the row is genuinely corrupt,
 * and failing loud beats silently projecting a wrong timestamp.
 */
export function reviveDateTimeUtc(value: unknown): DateTime.Utc {
  if (DateTime.isDateTime(value)) return DateTime.isUtc(value) ? value : DateTime.toUtc(value)
  if (typeof value === "number" && Number.isFinite(value)) return DateTime.makeUnsafe(value)
  if (typeof value === "string") {
    const millis = new Date(value).getTime()
    if (!Number.isFinite(millis)) throw new Error(`reviveDateTimeUtc: unparseable timestamp "${value}"`)
    return DateTime.makeUnsafe(millis)
  }
  throw new Error(`reviveDateTimeUtc: expected DateTime, millis, or ISO string, got ${JSON.stringify(value)}`)
}

export * as V2Schema from "./schema"
