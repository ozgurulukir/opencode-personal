import type { MessageID } from "./schema"
import type { MessageV2 } from "./message-v2"
import { Effect } from "effect"
import { isCompactionContinuePart } from "./compaction-trigger"

/**
 * Pure planning functions for session compaction — state in, plan out. No IO,
 * no services, no side effects: the `estimate` callbacks are Effect
 * descriptions that must be deterministic. The compaction layer
 * (compaction.ts) resolves config/model limits and executes the returned plan.
 */

export type Tail = {
  start: number
  id: MessageID
}

type Turn = {
  start: number
  end: number
  id: MessageID
}

export type TailPlan = {
  head: MessageV2.WithParts[]
  tail_start_id: MessageID | undefined
  fallback: boolean
}

export type HeadPlan = {
  head: MessageV2.WithParts[]
  dropped: number
  toolOutputMaxChars: number
  headTokens: number
}

function realUserTurn(msg: MessageV2.WithParts): boolean {
  if (msg.info.role !== "user") return false
  if (msg.parts.some((part) => part.type === "compaction")) return false
  if (msg.parts.some(isCompactionContinuePart)) return false
  return true
}

function turns(messages: MessageV2.WithParts[]): Turn[] {
  const result: Turn[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!realUserTurn(msg)) continue
    result.push({ start: i, end: messages.length, id: msg.info.id })
  }
  for (let i = 0; i < result.length - 1; i++) {
    result[i].end = result[i + 1].start
  }
  return result
}

/**
 * Picks the tail split point within a single turn: the latest message index
 * whose cumulative size (walked backwards) fits the budget. Single O(N)
 * estimation pass (#341). Returns undefined when nothing fits or the turn is
 * a single message.
 */
export const planTailSplit = Effect.fnUntraced(function* (input: {
  messages: MessageV2.WithParts[]
  turn: Turn
  budget: number
  estimate: (messages: MessageV2.WithParts[]) => Effect.Effect<number>
}) {
  if (input.budget <= 0) return undefined
  if (input.turn.end - input.turn.start <= 1) return undefined
  const turnMessages = input.messages.slice(input.turn.start, input.turn.end)
  const sizes = yield* Effect.forEach(
    turnMessages,
    (msg) => input.estimate([msg]),
    { concurrency: 1 },
  )
  let total = 0
  let splitIdx = turnMessages.length
  for (let i = turnMessages.length - 1; i > 0; i--) {
    if (total + sizes[i]! <= input.budget) {
      total += sizes[i]!
      splitIdx = i
    } else {
      break
    }
  }
  if (splitIdx < turnMessages.length && splitIdx > 0) {
    const start = input.turn.start + splitIdx
    return { start, id: input.messages[start]!.info.id }
  }
  return undefined
})

/**
 * Plans which messages are summarized (head) and which are kept verbatim
 * (tail). Keeps the newest `tailTurns` user turns within `budget` tokens,
 * splitting the oldest kept turn at its message boundary when the full turn
 * does not fit.
 */
export const planTail = Effect.fnUntraced(function* (input: {
  messages: MessageV2.WithParts[]
  tailTurns: number
  budget: number
  estimate: (messages: MessageV2.WithParts[]) => Effect.Effect<number>
}) {
  if (input.tailTurns <= 0) return { head: input.messages, tail_start_id: undefined, fallback: false }
  const all = turns(input.messages)
  if (!all.length) return { head: input.messages, tail_start_id: undefined, fallback: false }
  const recent = all.slice(-input.tailTurns)
  const sizes = yield* Effect.forEach(
    recent,
    (turn) => input.estimate(input.messages.slice(turn.start, turn.end)),
    { concurrency: 1 },
  )
  let total = 0
  let keep: Tail | undefined
  for (let i = recent.length - 1; i >= 0; i--) {
    const turn = recent[i]!
    const size = sizes[i]!
    if (total + size <= input.budget) {
      total += size
      keep = { start: turn.start, id: turn.id }
      continue
    }
    const remaining = input.budget - total
    const split = yield* planTailSplit({
      messages: input.messages,
      turn,
      budget: remaining,
      estimate: input.estimate,
    })
    if (split) keep = split
    break
  }
  if (!keep || keep.start === 0) return { head: input.messages, tail_start_id: undefined, fallback: !keep }
  return {
    head: input.messages.slice(0, keep.start),
    tail_start_id: keep.id,
    fallback: false,
  }
})

/**
 * Plans the head passed to the summarizer so it fits `summarizerCapacity`
 * prompt tokens included. Drops oldest messages first, then halves
 * `toolOutputMaxChars` (floored at 200) when messages alone still overflow.
 */
export const planHead = Effect.fnUntraced(function* (input: {
  head: MessageV2.WithParts[]
  promptTokens: number
  summarizerCapacity: number
  toolOutputMaxChars: number
  estimate: (messages: MessageV2.WithParts[], toolOutputMaxChars: number) => Effect.Effect<number>
}) {
  const head = [...input.head]
  let dropped = 0
  let toolOutputMaxChars = input.toolOutputMaxChars
  let headTokens = yield* input.estimate(head, toolOutputMaxChars)

  while (head.length > 1 && headTokens + input.promptTokens > input.summarizerCapacity) {
    head.shift()
    dropped++
    headTokens = yield* input.estimate(head, toolOutputMaxChars)
  }

  if (headTokens + input.promptTokens > input.summarizerCapacity && toolOutputMaxChars > 200) {
    toolOutputMaxChars = Math.max(200, Math.floor(toolOutputMaxChars / 2))
    headTokens = yield* input.estimate(head, toolOutputMaxChars)
  }

  return { head, dropped, toolOutputMaxChars, headTokens }
})




