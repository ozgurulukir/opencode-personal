import { PartID } from "@/session/schema"
import type { PromptInfo } from "./history"
import type { SessionMessageUser } from "@opencode-ai/sdk/v2"

type Item = PromptInfo["parts"][number]

export function strip(part: Item & { id: string; messageID: string; sessionID: string }): Item {
  const { id: _id, messageID: _messageID, sessionID: _sessionID, ...rest } = part
  return rest
}

// Restores a V2 user message into the prompt composer. V2 keeps the prompt
// inline (text + files + agents) instead of separate part rows. File sources
// are not restored: V2 FileAttachment drops the path/type the V1 FileSource
// union requires — the @-mention text survives inside msg.text.
export function fromUserMessage(msg: SessionMessageUser): PromptInfo {
  return {
    input: msg.text,
    parts: [
      ...(msg.files ?? []).map(
        (f): Item => ({
          type: "file",
          url: f.uri,
          mime: f.mime,
          filename: f.name,
        }),
      ),
      ...(msg.agents ?? []).map(
        (a): Item => ({
          type: "agent",
          name: a.name,
          source: a.source ? { value: a.source.text, start: a.source.start, end: a.source.end } : undefined,
        }),
      ),
    ],
  }
}

export function assign(part: Item): Item & { id: PartID } {
  return {
    ...part,
    id: PartID.ascending(),
  }
}
