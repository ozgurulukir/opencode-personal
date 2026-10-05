export const ms = (n?: number, d = 0) => {
  if (n === undefined || Number.isNaN(n)) return
  return `${n.toFixed(d)}ms`
}

export const time = (n?: number) => {
  if (n === undefined || Number.isNaN(n)) return
  return `${Math.round(n)}`
}

export const mb = (n?: number) => {
  if (n === undefined || Number.isNaN(n)) return
  const v = n / 1024 / 1024
  return `${v >= 1024 ? v.toFixed(0) : v.toFixed(1)}MB`
}

export const bad = (n: number | undefined, limit: number, low = false) => {
  if (n === undefined || Number.isNaN(n)) return false
  return low ? n < limit : n > limit
}

export const session = (path: string) => path.includes("/session")

interface SeenEntry {
  at: number
  delay: number
  dur: number
}

/**
 * Prune stale entries from `seen` and return the max delay/dur among the rest.
 * Mutates the map in-place to remove entries older than `span`.
 */
export function pruneAndFindMax(
  seen: Map<number | string, SeenEntry>,
  at: number,
  span: number,
): { delay: number; inp: number } {
  let delay = 0
  let inp = 0
  for (const [key, entry] of seen) {
    if (at - entry.at > span) {
      seen.delete(key)
      continue
    }
    if (entry.delay > delay) delay = entry.delay
    if (entry.dur > inp) inp = entry.dur
  }
  return { delay, inp }
}
