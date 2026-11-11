/**
 * Pure index math behind the layout command-palette navigation commands
 * (project.previous/next, session.previous/next, session.previous.unseen/next.unseen).
 * Side effects (prefetch, warm, navigate) stay in the Layout component; these
 * helpers only decide the target index.
 */

export function pickOffsetIndex(input: { offset: number; length: number; activeIndex: number }): number {
  if (input.activeIndex === -1) return input.offset > 0 ? 0 : input.length - 1
  return (input.activeIndex + input.offset + input.length) % input.length
}

export function pickUnseenOffsetIndex(input: {
  offset: number
  length: number
  activeIndex: number
  unseen: (index: number) => boolean
}): number | undefined {
  const start = input.activeIndex === -1 ? (input.offset > 0 ? -1 : 0) : input.activeIndex
  for (let i = 1; i <= input.length; i++) {
    const index = input.offset > 0 ? (start + i) % input.length : (start - i + input.length) % input.length
    if (input.unseen(index)) return index
  }
  return undefined
}
