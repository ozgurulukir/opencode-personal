// Handler for message.part.delta events.
//
// Accumulates streaming text deltas into the part's text buffer. Flushes
// to scrollback when the part kind is known and the message role is confirmed
// as assistant. Text is buffered until both conditions are met.
import type { Event } from "@opencode-ai/sdk/v2"
import type { SessionCommit, SessionData, SessionDataOutput } from "../types"
import { flushPart, out, ready } from "../utils"

export type MessagePartDeltaEvent = Event & { type: "message.part.delta" }

export function handleMessagePartDelta(
  data: SessionData,
  event: MessagePartDeltaEvent,
  sessionID: string,
  thinking: boolean,
): SessionDataOutput {
  const commits: SessionCommit[] = []

  if (event.properties.sessionID !== sessionID) {
    return out(data, commits)
  }

  if (
    typeof event.properties.partID !== "string" ||
    typeof event.properties.field !== "string" ||
    typeof event.properties.delta !== "string"
  ) {
    return out(data, commits)
  }

  if (event.properties.field !== "text") {
    return out(data, commits)
  }

  const partID = event.properties.partID
  if (data.ids.has(partID)) {
    return out(data, commits)
  }

  if (typeof event.properties.messageID === "string") {
    data.msg.set(partID, event.properties.messageID)
  }

  const text = data.text.get(partID) ?? ""
  data.text.set(partID, text + event.properties.delta)

  const kind = data.part.get(partID)
  if (!kind) {
    return out(data, commits)
  }

  if (kind === "reasoning" && !thinking) {
    return out(data, commits)
  }

  if (!ready(data, partID)) {
    return out(data, commits)
  }

  flushPart(data, commits, partID)
  return out(data, commits)
}
