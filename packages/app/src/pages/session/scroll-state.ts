export type ScrollState = {
  overflow: boolean
  bottom: boolean
  jump: boolean
}

/**
 * Derive the session scroll state from a scroll container's metrics.
 *
 * - `overflow`: content is taller than the viewport (within a 1px tolerance)
 * - `bottom`: the user is pinned to the bottom (or nothing overflows)
 * - `jump`: the user is far enough from the bottom that new output should not
 *   auto-scroll (distance exceeds a viewport-relative threshold)
 */
export function computeScrollState(input: {
  scrollHeight: number
  clientHeight: number
  scrollTop: number
  jumpThreshold?: number
}): ScrollState {
  const max = input.scrollHeight - input.clientHeight
  const distance = max - input.scrollTop
  const overflow = max > 1
  const bottom = !overflow || distance <= 2
  const threshold = input.jumpThreshold ?? Math.max(400, input.clientHeight)
  const jump = overflow && distance > threshold
  return { overflow, bottom, jump }
}

export function scrollStateChanged(current: ScrollState, next: ScrollState) {
  return current.overflow !== next.overflow || current.bottom !== next.bottom || current.jump !== next.jump
}
