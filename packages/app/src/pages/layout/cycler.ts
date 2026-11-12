/**
 * Pure wraparound pick shared by the theme, color-scheme and language cyclers
 * in the Layout component. Unknown current values restart at the head of the
 * list; an empty list yields undefined so callers keep their own no-op guard.
 */
export function pickCycleNext<T>(list: readonly T[], current: T, direction = 1): T | undefined {
  if (list.length === 0) return undefined
  const currentIndex = list.indexOf(current)
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + list.length) % list.length
  return list[nextIndex]
}
