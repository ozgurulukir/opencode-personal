// Handler for session.error events.
//
// Emits an error scrollback entry when the session encounters an error.
import type { Event } from "@opencode-ai/sdk/v2"
import type { SessionCommit, SessionData, SessionDataOutput } from "../types"
import { formatError, out } from "../utils"

export type SessionErrorEvent = Event & { type: "session.error" }

export function handleSessionError(
  data: SessionData,
  event: SessionErrorEvent,
  sessionID: string,
): SessionDataOutput {
  const commits: SessionCommit[] = []

  if (event.properties.sessionID !== sessionID || !event.properties.error) {
    return out(data, commits)
  }

  commits.push({
    kind: "error",
    text: formatError(event.properties.error),
    phase: "start",
    source: "system",
  })
  return out(data, commits)
}
