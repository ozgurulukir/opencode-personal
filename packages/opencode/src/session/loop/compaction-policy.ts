import { Effect } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { NamedError } from "@opencode-ai/core/util/error"
import type { SessionCompaction } from "../compaction"
import * as CompactionTrigger from "../compaction-trigger"
import type { Bus } from "@/bus"
import type { Config } from "@/config/config"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "../message-v2"
import type { SessionID } from "../schema"
import * as Session from "../session"

const elog = EffectLogger.create({ service: "session.compaction-policy" })

export interface CompactionPolicyDeps {
  compaction: SessionCompaction.Interface
  bus: Bus.Interface
  config: Config.Interface
}

export function handleCompactionTask(
  deps: Pick<CompactionPolicyDeps, "compaction">,
  input: {
    task: MessageV2.CompactionPart
    lastUser: MessageV2.User
    sessionID: SessionID
    msgs: MessageV2.WithParts[]
  },
) {
  return Effect.gen(function* () {
    const result = yield* deps.compaction.process({
      messages: input.msgs,
      parentID: input.task.messageID ?? input.lastUser.id,
      sessionID: input.sessionID,
      auto: input.task.auto,
      overflow: input.task.overflow,
    })
    return result
  })
}

export function createAutoCompaction(
  deps: Pick<CompactionPolicyDeps, "compaction" | "bus">,
  input: {
    sessionID: SessionID
    consecutiveAutoCompactions: number
    lastUser: MessageV2.User
    overflow?: boolean
  },
) {
  return Effect.gen(function* () {
    if (CompactionTrigger.breakerTripped(input.consecutiveAutoCompactions)) {
      const error = new NamedError.Unknown({ message: CompactionTrigger.BREAKER_MESSAGE })
      yield* deps.bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
      throw error
    }
    yield* deps.compaction.create({
      sessionID: input.sessionID,
      agent: input.lastUser.agent,
      model: input.lastUser.model,
      auto: true,
      overflow: input.overflow,
      tools: input.lastUser.tools,
      format: input.lastUser.format,
      system: input.lastUser.system,
    })
  })
}

export function pruneAndCheckTurnCompaction(
  deps: CompactionPolicyDeps,
  input: {
    sessionID: SessionID
    lastFinished: MessageV2.Assistant
    isCurrentTurnContinue: boolean
    consecutiveAutoCompactions: number
    lastUser: MessageV2.User
    model: Provider.Model
  },
) {
  return Effect.gen(function* () {
    const slog = elog.with({ sessionID: input.sessionID })

    // Prune only for regular finished turns — a summary turn's output IS
    // the compaction, there is nothing to prune underneath it.
    if (input.lastFinished.summary !== true) {
      const pruned = yield* deps.compaction
        .prune({ sessionID: input.sessionID })
        .pipe(
          Effect.tapError((error) =>
            slog
              .warn("compaction prune failed; proceeding with unpruned token counts", { error: String(error) })
              .pipe(Effect.as(undefined)),
          ),
          Effect.catch(() => Effect.succeed(0)),
        )
      if (pruned > 0) {
        input.lastFinished.tokens = CompactionTrigger.adjustTokensAfterPrune(input.lastFinished.tokens, pruned)
      }
    }

    const cfg = yield* deps.config.get()
    if (
      CompactionTrigger.shouldCompactAfterTurn({
        cfg,
        model: input.model,
        tokens: input.lastFinished.tokens,
        summary: input.lastFinished.summary === true,
        continueTurn: input.isCurrentTurnContinue,
      })
    ) {
      yield* createAutoCompaction(
        { compaction: deps.compaction, bus: deps.bus },
        {
          sessionID: input.sessionID,
          consecutiveAutoCompactions: input.consecutiveAutoCompactions,
          lastUser: input.lastUser,
        },
      )
      return true
    }
    return false
  })
}
