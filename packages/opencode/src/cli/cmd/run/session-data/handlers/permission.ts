// Handlers for permission.* events.
//
// Manages the permission request queue and drives footer view transitions.
// When a permission is asked, it's added to the queue. When replied, it's
// removed and the footer falls back to the next pending permission or prompt.
import type { Event } from "@opencode-ai/sdk/v2"
import type { SessionCommit, SessionData, SessionDataOutput } from "../types"
import { enrichPermission, out, queueOut, remove, upsert } from "../utils"

export type PermissionAskedEvent = Event & { type: "permission.asked" }
export type PermissionRepliedEvent = Event & { type: "permission.replied" }

export function handlePermissionAsked(
  data: SessionData,
  event: PermissionAskedEvent,
  sessionID: string,
): SessionDataOutput {
  const commits: SessionCommit[] = []

  if (event.properties.sessionID !== sessionID) {
    return out(data, commits)
  }

  upsert(data.permissions, enrichPermission(data, event.properties))
  return queueOut(data, commits)
}

export function handlePermissionReplied(
  data: SessionData,
  event: PermissionRepliedEvent,
  sessionID: string,
): SessionDataOutput {
  const commits: SessionCommit[] = []

  if (event.properties.sessionID !== sessionID) {
    return out(data, commits)
  }

  if (!remove(data.permissions, event.properties.requestID)) {
    return out(data, commits)
  }

  return queueOut(data, commits)
}
