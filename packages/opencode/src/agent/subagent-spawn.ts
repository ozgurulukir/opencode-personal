import { Effect, Exit } from "effect"
import * as Log from "@opencode-ai/core/util/log"
import type { EffectBridge } from "@/effect/bridge"

const log = Log.create({ service: "subagent-spawn" })

/**
 * Abort/cancel choreography shared by V1 TaskTool (`tool/task.ts`) and V2
 * `subagent()` (`v2/session.ts`): an idempotent `onAbort` that cancels the
 * child session once through the EffectBridge (bridging keeps the legacy
 * Instance ALS alive across the async boundary), plus a release handler that
 * removes the abort listener first, then cancels the child on interrupt with
 * log-and-suppress error handling so cleanup never defects.
 *
 * The acquire/release pair feeds `Effect.acquireUseRelease`. Registering the
 * listener inside acquire guarantees removal cannot be skipped if acquire
 * never runs; removal-first ordering is shared by both call sites (V1
 * previously removed the listener last via `Effect.ensuring` — behaviorally
 * equivalent since the cancel branch never throws).
 *
 * Deliberately NOT extracted: the use-block itself. V1 propagates prompt
 * failures to the caller while V2 posts `SessionEvent.Synthetic` — their error
 * policies differ on purpose.
 */
export function subagentAbortGuard(input: {
  abort: AbortSignal | undefined
  cancel: Effect.Effect<void, unknown>
  bridge: EffectBridge.Shape
}): {
  acquire: Effect.Effect<void>
  release: <A, E>(exit: Exit.Exit<A, E>) => Effect.Effect<void>
} {
  let cancelled = false
  const onAbort = () => {
    if (cancelled) return
    cancelled = true
    input.bridge.promise(input.cancel).catch((error) => log.warn("subagent cancel failed", { error: String(error) }))
  }
  return {
    acquire: Effect.sync(() => {
      // An already-aborted signal never fires the event — run the cancel now.
      if (input.abort?.aborted) onAbort()
      else input.abort?.addEventListener("abort", onAbort)
    }),
    release: (exit) =>
      Effect.gen(function* () {
        input.abort?.removeEventListener("abort", onAbort)
        if (Exit.hasInterrupts(exit) && !cancelled) {
          cancelled = true
          yield* input.cancel.pipe(
            Effect.catch((error) =>
              Effect.sync(() => log.warn("subagent cancel failed", { error: String(error) })),
            ),
          )
        }
      }),
  }
}

const NO_OUTPUT_PARTS = "Subagent produced no output parts."
const NO_TEXT_RESPONSE = "Subagent completed without producing a text response."

/**
 * Extract the subagent's final text from its output parts, shared by V1
 * (`tool/task.ts` `<task_result>` output) and V2 (`v2/session.ts` synthetic
 * message). Fallbacks preserve which-fallback-when:
 *
 * - no parts at all → "Subagent produced no output parts."
 * - parts but no trailing `text` part (or empty text) →
 *   "Subagent completed without producing a text response."
 *
 * `findLast` picks the LAST text part; non-text parts are ignored even when
 * they carry a `text` field (e.g. reasoning parts).
 */
export function subagentResultText(parts: readonly { type: string; text?: string }[]): string {
  if (parts.length === 0) return NO_OUTPUT_PARTS
  return parts.findLast((item) => item.type === "text")?.text || NO_TEXT_RESPONSE
}

/**
 * Subagent session title. The format is pinned by consumers that regex-match
 * it (`cli/cmd/tui/routes/session/subagent-footer.tsx`, `app/src/pages/session/
 * message-timeline.tsx` — `/@(\w+) subagent/`) — do not change without updating
 * those. Description defaulting is NOT unified here: V1 uses
 * `params.description || params.prompt.slice(0, 50)`, V2 uses
 * `input.description ?? "Subagent"`.
 */
export function subagentTitle(description: string, agent: string): string {
  return `${description} (@${agent} subagent)`
}
