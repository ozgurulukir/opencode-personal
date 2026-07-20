// Core reducer for direct interactive mode.
//
// Takes raw SDK events and produces two outputs:
//   - StreamCommit[]: append-only scrollback entries (text, tool, error, etc.)
//   - FooterOutput:   status bar patches and view transitions (permission, question)
//
// The reducer mutates SessionData in place for performance but has no
// external side effects -- no IO, no footer calls. The caller
// (stream.transport.ts) feeds events in and forwards output to the footer
// through stream.ts.
//
// This file is a thin orchestrator. All event-specific logic lives in
// session-data/handlers/*.ts, shared utilities in session-data/utils.ts,
// and type definitions in session-data/types.ts.
import type { SessionData, SessionDataInput, SessionDataOutput } from "./session-data/types"
import { out } from "./session-data/utils"
import { handleMessageUpdated } from "./session-data/handlers/message-updated"
import { handleMessagePartDelta } from "./session-data/handlers/message-part-delta"
import { handleMessagePartUpdated } from "./session-data/handlers/message-part-updated"
import { handlePermissionAsked, handlePermissionReplied } from "./session-data/handlers/permission"
import { handleQuestionAsked, handleQuestionReplied, handleQuestionRejected } from "./session-data/handlers/question"
import { handleSessionError } from "./session-data/handlers/session-error"

// Re-export public API
export { createSessionData, bootstrapSessionData, flushInterrupted } from "./session-data/utils"
export { pickBlockerView, blockerStatus, formatError } from "./session-data/utils"
export type { SessionData, SessionDataInput, SessionDataOutput } from "./session-data/types"

// The main reducer. Takes one SDK event and returns scrollback commits and
// footer updates. Called once per event from the stream transport's watch loop.
//
// Event handling follows the SDK event types:
//   message.updated      → learn role, flush buffered parts, track usage
//   message.part.delta   → accumulate text, flush if ready
//   message.part.updated → handle text/reasoning/tool state transitions
//   permission.*         → manage the permission queue, drive footer view
//   question.*           → manage the question queue, drive footer view
//   session.error        → emit error scrollback entry
export function reduceSessionData(input: SessionDataInput): SessionDataOutput {
  const data = input.data
  const event = input.event

  if (event.type === "message.updated") {
    return handleMessageUpdated(data, event as any, input.sessionID, input.thinking, input.limits)
  }

  if (event.type === "message.part.delta") {
    return handleMessagePartDelta(data, event as any, input.sessionID, input.thinking)
  }

  if (event.type === "message.part.updated") {
    return handleMessagePartUpdated(data, event as any, input.sessionID, input.thinking)
  }

  if (event.type === "permission.asked") {
    return handlePermissionAsked(data, event as any, input.sessionID)
  }

  if (event.type === "permission.replied") {
    return handlePermissionReplied(data, event as any, input.sessionID)
  }

  if (event.type === "question.asked") {
    return handleQuestionAsked(data, event as any, input.sessionID)
  }

  if (event.type === "question.replied") {
    return handleQuestionReplied(data, event as any, input.sessionID)
  }

  if (event.type === "question.rejected") {
    return handleQuestionRejected(data, event as any, input.sessionID)
  }

  if (event.type === "session.error") {
    return handleSessionError(data, event as any, input.sessionID)
  }

  return out(data, [])
}
