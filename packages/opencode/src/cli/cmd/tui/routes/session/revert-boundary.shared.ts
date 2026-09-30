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

/**
 * Drops every message at or past a cleared revert boundary. Mirrors the
 * render filter in routes/session/index.tsx
 * (`<Match when={revert?.messageID && message.id >= revert.messageID}>`),
 * which hides `id >= boundary` while the marker is set. Server-side cleanup
 * deletes those same rows before clearing the marker, but the live TUI store
 * never consumes `message.removed` (V1 `msg_*` ids vs projected `evt_*`
 * rows), so the drop must replay the boundary comparison here once the
 * marker clears. Ordering-agnostic: newest-first store slices and
 * oldest-first render lists filter identically.
 */
export function dropRevertedRange(messages: SessionMessage[], boundary: string) {
  return messages.filter((x) => x.id < boundary)
}

/**
 * Decides whether a revert-clear patch should drop the pre-clear range from
 * the live store, and if so which boundary to drop at. `cleared` must mean
 * the patch explicitly nulls the marker (`"revert" in info && info.revert ==
 * null`) — not merely that the patch omits it. `cleanupSeen` arms only on a
 * full `message.removed` (cleanup path); `unrevert` clears the marker without
 * deleting rows, so an unarmed clear must preserve the hidden rows for redo.
 */
export function revertClearDropBoundary(
  prevBoundary: string | undefined,
  cleared: boolean,
  cleanupSeen: boolean,
): string | undefined {
  if (!prevBoundary || !cleared || !cleanupSeen) return undefined
  return prevBoundary
}
