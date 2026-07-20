// Handler for message.part.updated events.
//
// Handles both text/reasoning parts and tool parts:
//
// - Text/reasoning: registers the part kind, syncs text, flushes to scrollback
//   when the message role is known. Drops user-role text parts when
//   includeUserText is false. Drops reasoning parts when thinking is disabled.
//
// - Tool: emits start/progress/final commits for tool lifecycle (running,
//   completed, error). Syncs permission and question state when tool parts
//   update. Stashes bash output for echo stripping.
import type { Event, ToolPart } from "@opencode-ai/sdk/v2"
import type { SessionCommit, SessionData, SessionDataOutput } from "../types"
import { toolView } from "../../tool"
import {
  doneTool,
  drop,
  failTool,
  flushPart,
  out,
  patch,
  ready,
  startTool,
  stashEcho,
  syncPermission,
  syncQuestion,
  syncText,
  toolStatus,
} from "../utils"

export type MessagePartUpdatedEvent = Event & { type: "message.part.updated" }

export function handleMessagePartUpdated(
  data: SessionData,
  event: MessagePartUpdatedEvent,
  sessionID: string,
  thinking: boolean,
): SessionDataOutput {
  const commits: SessionCommit[] = []
  const part = event.properties.part

  if (part.sessionID !== sessionID) {
    return out(data, commits)
  }

  if (part.type === "tool") {
    return handleToolPart(data, commits, part, sessionID)
  }

  if (part.type !== "text" && part.type !== "reasoning") {
    return out(data, commits)
  }

  if (data.ids.has(part.id)) {
    return out(data, commits)
  }

  const kind = part.type === "text" ? "assistant" : "reasoning"
  if (typeof part.messageID === "string") {
    data.msg.set(part.id, part.messageID)
  }

  const msg = part.messageID
  const role = msg ? data.role.get(msg) : undefined
  if (role === "user" && part.type === "text" && !data.includeUserText) {
    data.ids.add(part.id)
    drop(data, part.id)
    return out(data, commits)
  }

  if (kind === "reasoning" && !thinking) {
    if (part.time?.end) {
      data.ids.add(part.id)
    }
    drop(data, part.id)
    return out(data, commits)
  }

  data.part.set(part.id, role === "user" && kind === "assistant" ? "user" : kind)
  syncText(data, part.id, part.text)

  if (part.time?.end) {
    data.end.add(part.id)
  }

  if (msg && !role) {
    return out(data, commits)
  }

  if (!ready(data, part.id)) {
    return out(data, commits)
  }

  flushPart(data, commits, part.id)

  if (!part.time?.end) {
    return out(data, commits)
  }

  data.ids.add(part.id)
  drop(data, part.id)
  return out(data, commits)
}

function handleToolPart(
  data: SessionData,
  commits: SessionCommit[],
  part: ToolPart,
  sessionID: string,
): SessionDataOutput {
  const view = syncPermission(data, part) ?? syncQuestion(data, part)

  if (part.state.status === "running") {
    if (data.ids.has(part.id)) {
      return out(data, commits, view)
    }

    if (!data.tools.has(part.id)) {
      data.tools.add(part.id)
      commits.push(startTool(part))
    }

    return out(data, commits, view ?? patch({ status: toolStatus(part) }))
  }

  if (part.state.status === "completed") {
    return handleToolCompleted(data, commits, part, view)
  }

  if (part.state.status === "error") {
    return handleToolError(data, commits, part, view)
  }

  return out(data, commits, view)
}

function handleToolCompleted(
  data: SessionData,
  commits: SessionCommit[],
  part: ToolPart,
  view: ReturnType<typeof syncPermission>,
): SessionDataOutput {
  const seen = data.tools.has(part.id)
  const mode = toolView(part.tool)
  data.tools.delete(part.id)
  if (data.ids.has(part.id)) {
    return out(data, commits, view)
  }

  if (!seen) {
    commits.push(startTool(part))
  }

  data.ids.add(part.id)
  stashEcho(data, part)

  const output = (part.state as any).output
  if (mode.output && typeof output === "string" && output.trim()) {
    commits.push({
      kind: "tool",
      text: output,
      phase: "progress",
      source: "tool",
      messageID: part.messageID,
      partID: part.id,
      tool: part.tool,
      part,
      toolState: "completed",
    })
  }

  if (mode.final) {
    commits.push(doneTool(part))
  }

  return out(data, commits, view)
}

function handleToolError(
  data: SessionData,
  commits: SessionCommit[],
  part: ToolPart,
  view: ReturnType<typeof syncPermission>,
): SessionDataOutput {
  const seen = data.tools.has(part.id)
  data.tools.delete(part.id)
  if (data.ids.has(part.id)) {
    return out(data, commits, view)
  }

  if (!seen) {
    commits.push(startTool(part))
  }

  data.ids.add(part.id)
  const error = (part.state as any).error
  const text =
    typeof error === "string" && error.trim() ? error : "unknown error"
  commits.push(failTool(part, text))
  return out(data, commits, view)
}
