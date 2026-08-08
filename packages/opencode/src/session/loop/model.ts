// Extracted from session/prompt.ts Phase 2: three model-resolution helpers
// (getModel, currentModel, lastAssistant). Co-located because they share the
// model-resolution domain. Deps are passed explicitly (deps-object pattern);
// Database.use resolves from the layer context.
import { Cause, Effect, Exit, Option } from "effect"
import { eq, Database } from "@/storage/db"
import { SessionTable } from "../session.sql"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionID } from "../schema"
import { Session } from "../session"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { Bus } from "@/bus"

export interface GetModelDeps {
  provider: Provider.Interface
  bus: Bus.Interface
}

export const getModel = Effect.fn("SessionPrompt.getModel")(function* (
  deps: GetModelDeps,
  providerID: ProviderID,
  modelID: ModelID,
  sessionID: SessionID,
) {
  const exit = yield* deps.provider.getModel(providerID, modelID).pipe(Effect.exit)
  if (Exit.isSuccess(exit)) return exit.value
  const err = Cause.squash(exit.cause)
  if (Provider.ModelNotFoundError.isInstance(err)) {
    const hint = err.data.suggestions?.length ? ` Did you mean: ${err.data.suggestions.join(", ")}?` : ""
    yield* deps.bus.publish(Session.Event.Error, {
      sessionID,
      error: new NamedError.Unknown({
        message: `Model not found: ${err.data.providerID}/${err.data.modelID}.${hint}`,
      }).toObject(),
    })
  }
  return yield* Effect.failCause(exit.cause)
})

export interface CurrentModelDeps {
  sessions: Session.Interface
  provider: Provider.Interface
}

export const currentModel = Effect.fnUntraced(function* (deps: CurrentModelDeps, sessionID: SessionID) {
  const current = Database.use((db) =>
    db.select({ model: SessionTable.model }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
  )
  if (current?.model) {
    return {
      providerID: ProviderID.make(current.model.providerID),
      modelID: ModelID.make(current.model.id),
      ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
    }
  }
  const match = yield* deps.sessions.findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
  if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
  return yield* deps.provider.defaultModel()
})

export interface LastAssistantDeps {
  sessions: Session.Interface
}

export const lastAssistant = Effect.fnUntraced(function* (deps: LastAssistantDeps, sessionID: SessionID) {
  const match = yield* deps.sessions.findMessage(sessionID, (m) => m.info.role !== "user")
  if (Option.isSome(match)) return match.value
  const msgs = yield* deps.sessions.messages({ sessionID, limit: 1 })
  if (msgs.length > 0) return msgs[0]
  throw new Error("Impossible")
})
