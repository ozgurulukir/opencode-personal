import type { PermissionRequest, Session } from "@opencode-ai/sdk/v2/client"
import { cmp } from "./utils"
import { SESSION_RECENT_LIMIT, SESSION_RECENT_WINDOW } from "./types"

export function sessionUpdatedAt(session: Session) {
  return session.time.updated ?? session.time.created
}

export function compareSessionRecent(a: Session, b: Session) {
  const aUpdated = sessionUpdatedAt(a)
  const bUpdated = sessionUpdatedAt(b)
  if (aUpdated !== bUpdated) return bUpdated - aUpdated
  return cmp(a.id, b.id)
}

export function takeRecentSessions(sessions: Session[], limit: number, cutoff: number) {
  if (limit <= 0) return [] as Session[]
  const selected: Session[] = []
  const seen = new Set<string>()
  for (const session of sessions) {
    if (!session?.id) continue
    if (seen.has(session.id)) continue
    seen.add(session.id)
    if (sessionUpdatedAt(session) <= cutoff) continue
    const index = selected.findIndex((x) => compareSessionRecent(session, x) < 0)
    if (index === -1) selected.push(session)
    if (index !== -1) selected.splice(index, 0, session)
    if (selected.length > limit) selected.pop()
  }
  return selected
}

export function trimSessions(
  input: Session[],
  options: { limit: number; permission: Record<string, PermissionRequest[]>; now?: number },
) {
  const limit = Math.max(0, options.limit)
  const cutoff = (options.now ?? Date.now()) - SESSION_RECENT_WINDOW

  // ⚡ Bolt Optimization: Replace chained .filter() with a single loop to reduce GC pressure and O(N) traversals
  const roots: Session[] = []
  const children: Session[] = []

  for (let i = 0; i < input.length; i++) {
    const s = input[i]
    if (!s?.id || s.time?.archived) continue

    if (!s.parentID) {
      roots.push(s)
    } else {
      children.push(s)
    }
  }

  roots.sort((a, b) => cmp(a.id, b.id))

  const base = roots.slice(0, limit)
  const recent = takeRecentSessions(roots.slice(limit), SESSION_RECENT_LIMIT, cutoff)
  const keepRoots = [...base, ...recent]

  const keepRootIds = new Set<string>()
  for (let i = 0; i < keepRoots.length; i++) {
    keepRootIds.add(keepRoots[i].id)
  }

  const keepChildren: Session[] = []
  for (let i = 0; i < children.length; i++) {
    const s = children[i]
    if (s.parentID && keepRootIds.has(s.parentID)) {
      keepChildren.push(s)
      continue
    }
    const perms = options.permission[s.id]
    if (perms && perms.length > 0) {
      keepChildren.push(s)
      continue
    }
    if (sessionUpdatedAt(s) > cutoff) {
      keepChildren.push(s)
    }
  }

  return [...keepRoots, ...keepChildren].sort((a, b) => cmp(a.id, b.id))
}
