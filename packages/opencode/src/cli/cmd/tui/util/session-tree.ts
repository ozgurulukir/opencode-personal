/**
 * Collects the root session's ID plus every descendant reachable through the
 * `parentID` chain (any depth, cycle-safe via a `seen` set).
 *
 * Mirrors packages/app/src/pages/session/composer/session-request-tree.ts, so the
 * TUI aggregation of pending permission/question prompts matches the web app's
 * recursive descendant walk. Any falsy `parentID` (`""`, `null`, `undefined`) is
 * treated as "not a child", so root sessions and the well-known `parentID = ""`
 * sentinel are never linked to a parent.
 */
export function collectSessionDescendants(
  sessions: ReadonlyArray<{ id: string; parentID?: string | null }>,
  rootID: string,
): Set<string> {
  const children = new Map<string, string[]>()
  for (const item of sessions) {
    if (!item.parentID) continue
    const list = children.get(item.parentID)
    if (list) list.push(item.id)
    else children.set(item.parentID, [item.id])
  }

  const seen = new Set<string>([rootID])
  const queue = [rootID]
  for (let i = 0; i < queue.length; i++) {
    const siblings = children.get(queue[i])
    if (!siblings) continue
    for (const id of siblings) {
      if (seen.has(id)) continue
      seen.add(id)
      queue.push(id)
    }
  }
  return seen
}

export type NavigableSession = {
  id: string
  parentID?: string | null
  time?: { created: number }
}

/**
 * Returns direct children of `parentID` sorted chronologically (oldest-first)
 * with a deterministic `id` tiebreaker. Because `SessionID` is descending
 * (newest session has the smallest lexicographical ID), sorting by `id` alone
 * would invert chronological order compared to `SubagentFooter`.
 */
export function sortChildSessions<T extends NavigableSession>(sessions: ReadonlyArray<T>, parentID: string): T[] {
  return sessions
    .filter((x) => x.parentID === parentID)
    .toSorted((a, b) => {
      const diff = (a.time?.created ?? 0) - (b.time?.created ?? 0)
      if (diff !== 0) return diff
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
}

/**
 * First direct child of `sessionID` (chronologically oldest), enabling
 * navigation from a root session to its first child AND from a child session
 * into its first grandchild.
 */
export function firstChildSession<T extends NavigableSession>(
  sessions: ReadonlyArray<T>,
  sessionID: string,
): T | undefined {
  return sortChildSessions(sessions, sessionID)[0]
}

/**
 * Next (+1) or previous (-1) sibling of `sessionID` among sessions sharing
 * the same `parentID`, ordered chronologically (matching `SubagentFooter`'s
 * `1 of N` index) and wrapping around at the ends.
 */
export function nextSiblingSession<T extends NavigableSession>(
  sessions: ReadonlyArray<T>,
  sessionID: string,
  direction: 1 | -1,
): T | undefined {
  const current = sessions.find((x) => x.id === sessionID)
  if (!current?.parentID) return undefined
  const siblings = sortChildSessions(sessions, current.parentID)
  if (siblings.length === 0) return undefined
  const idx = siblings.findIndex((x) => x.id === sessionID)
  if (idx === -1) return siblings[0]
  const next = (idx + direction + siblings.length) % siblings.length
  return siblings[next]
}