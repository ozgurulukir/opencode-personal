import { LEGACY_MESSAGE_ID } from "./session-message"

/**
 * Extracts the V1 (`msg_`) message association from a projected V2 row's
 * metadata, if present. Written by session-message-updater.ts on prompted and
 * step events.
 */
export function legacyMessageID(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const value = (metadata as Record<string, unknown>)[LEGACY_MESSAGE_ID]
  return typeof value === "string" && value.startsWith("msg_") ? value : undefined
}

/**
 * Returns a copy of a decoded message payload with the legacy association
 * stripped from metadata so it never leaks to V2 read consumers.
 */
export function stripLegacyMessageID(data: Record<string, unknown>): Record<string, unknown> {
  const metadata = data.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return data
  if (!(LEGACY_MESSAGE_ID in metadata)) return data
  const { [LEGACY_MESSAGE_ID]: _, ...rest } = metadata as Record<string, unknown>
  return { ...data, metadata: Object.keys(rest).length ? rest : undefined }
}

export interface MatchableMessage {
  info: { role: string; id: { valueOf(): string } | string; time: { created: unknown } }
}

/**
 * Resolves the V1 revert target for a projected V2 row. Matches by the legacy
 * ID association first; falls back to same-role + same-millisecond timestamp
 * for rows written before the association existed. `matchedBy: "timestamp"`
 * means the same-millisecond landmine was stepped on — callers should log a
 * warning (and can later hard-fail once pre-association rows age out).
 */
export function matchLegacyMessage<M extends MatchableMessage>(
  messages: M[],
  role: string,
  legacyID: string | undefined,
  timeCreated: number,
): { target: M | undefined; matchedBy: "legacy-id" | "timestamp" | "none" } {
  const byLegacyID = legacyID
    ? messages.find((message) => message.info.role === role && message.info.id.valueOf() === legacyID)
    : undefined
  if (byLegacyID) return { target: byLegacyID, matchedBy: "legacy-id" }
  const byTimestamp = messages.find(
    (message) => message.info.role === role && message.info.time.created === timeCreated,
  )
  if (byTimestamp) return { target: byTimestamp, matchedBy: "timestamp" }
  return { target: undefined, matchedBy: "none" }
}
