// Handler for message.updated events.
//
// Learns the message role (assistant/user), replays buffered text parts,
// announces the assistant's first response, formats usage/cost info, and
// emits error commits for failed messages (excluding aborts).
import type { Event } from "@opencode-ai/sdk/v2"
import type { SessionCommit, SessionData, SessionDataOutput } from "../types"
import { formatError, formatUsage, isAbort, modelKey, msgErr, out, patch, replay } from "../utils"

export type MessageUpdatedEvent = Event & { type: "message.updated" }

export function handleMessageUpdated(
  data: SessionData,
  event: MessageUpdatedEvent,
  sessionID: string,
  thinking: boolean,
  limits: Record<string, number>,
): SessionDataOutput {
  const commits: SessionCommit[] = []

  if (event.properties.sessionID !== sessionID) {
    return out(data, commits)
  }

  const info = event.properties.info
  if (typeof info.id === "string") {
    data.role.set(info.id, info.role)
    replay(data, commits, info.id, info.role, thinking)
  }

  if (info.role !== "assistant") {
    return out(data, commits)
  }

  let next: { status?: string; usage?: string } | undefined
  if (!data.announced) {
    data.announced = true
    next = { status: "assistant responding" }
  }

  const usage = formatUsage(
    info.tokens,
    limits[modelKey(info.providerID, info.modelID)],
    typeof info.cost === "number" ? info.cost : undefined,
  )
  if (usage) {
    next = {
      ...next,
      usage,
    }
  }

  if (typeof info.id === "string" && info.error && !isAbort(info.error) && !data.ids.has(msgErr(info.id))) {
    data.ids.add(msgErr(info.id))
    commits.push({
      kind: "error",
      text: formatError(info.error),
      phase: "start",
      source: "system",
      messageID: info.id,
    })
  }

  return out(data, commits, patch(next))
}
