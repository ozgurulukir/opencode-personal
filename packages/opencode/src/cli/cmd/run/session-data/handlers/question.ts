// Handlers for question.* events.
//
// Manages the question request queue and drives footer view transitions.
// When a question is asked, it's added to the queue. When replied or rejected,
// it's removed and the footer falls back to the next pending question or prompt.
import type { Event } from "@opencode-ai/sdk/v2"
import type { SessionCommit, SessionData, SessionDataOutput } from "../types"
import { out, queueOut, remove, upsert } from "../utils"

export type QuestionAskedEvent = Event & { type: "question.asked" }
export type QuestionRepliedEvent = Event & { type: "question.replied" }
export type QuestionRejectedEvent = Event & { type: "question.rejected" }

export function handleQuestionAsked(
  data: SessionData,
  event: QuestionAskedEvent,
  sessionID: string,
): SessionDataOutput {
  const commits: SessionCommit[] = []

  if (event.properties.sessionID !== sessionID) {
    return out(data, commits)
  }

  upsert(data.questions, event.properties)
  return queueOut(data, commits)
}

export function handleQuestionReplied(
  data: SessionData,
  event: QuestionRepliedEvent,
  sessionID: string,
): SessionDataOutput {
  const commits: SessionCommit[] = []

  if (event.properties.sessionID !== sessionID) {
    return out(data, commits)
  }

  if (!remove(data.questions, event.properties.requestID)) {
    return out(data, commits)
  }

  return queueOut(data, commits)
}

export function handleQuestionRejected(
  data: SessionData,
  event: QuestionRejectedEvent,
  sessionID: string,
): SessionDataOutput {
  const commits: SessionCommit[] = []

  if (event.properties.sessionID !== sessionID) {
    return out(data, commits)
  }

  if (!remove(data.questions, event.properties.requestID)) {
    return out(data, commits)
  }

  return queueOut(data, commits)
}
