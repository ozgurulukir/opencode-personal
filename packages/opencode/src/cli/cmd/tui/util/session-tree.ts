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