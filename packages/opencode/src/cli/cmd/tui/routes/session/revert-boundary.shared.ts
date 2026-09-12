import type { SessionMessage, SessionMessageUser } from "@opencode-ai/sdk/v2"

/**
 * Revert-boundary selection over the session's message list in render order
 * (oldest-first, as produced by the route's `messages()` memo over the
 * newest-first V2 store slice).
 *
 * The boundary is a message id compared lexicographically against other
 * message ids: V2 projected ids (`evt_`) are minted ascending, and the revert
 * state stores a single id that every message in this slice shares a namespace
 * with. These helpers are the one place allowed to make that comparison —
 * undo/redo rendering and command handlers must not re-derive it.
 */

export function lastUserBeforeBoundary(messages: SessionMessage[], boundary: string | undefined) {
  return messages.findLast(
    (x): x is SessionMessageUser => (!boundary || x.id < boundary) && x.type === "user",
  )
}

export function firstUserAfterBoundary(messages: SessionMessage[], boundary: string) {
  return messages.find((x) => x.type === "user" && x.id > boundary)
}

export function usersFromBoundary(messages: SessionMessage[], boundary: string) {
  return messages.filter((x) => x.id >= boundary && x.type === "user")
}
