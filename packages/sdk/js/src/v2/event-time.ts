/**
 * V2 event timestamps are declared as epoch millis on the wire and
 * SyncEvent.process encodes DateTime instances to millis at publish. Kept as a
 * cheap normalizer because legacy EventTable rows (experimental workspaces
 * replay) still carry ISO strings from before that fix.
 */
export function eventTime(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string") return Date.parse(value)
  if (value && typeof value === "object" && "epochMilliseconds" in value)
    return (value as { epochMilliseconds: number }).epochMilliseconds
  return Date.now()
}
