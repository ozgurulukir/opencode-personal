// Extracted from session/prompt.ts Phase 2: generates a short title for a new
// session using the small "title" model. Deps are passed explicitly (deps-object
// pattern); context yields (none here) resolve from the layer context.
import { Cause, Effect } from "effect"
import * as Stream from "effect/Stream"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { Session } from "../session"
import { MessageV2 } from "../message-v2"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "@/provider/schema"
import { LLM } from "../llm"

const elog = EffectLogger.create({ service: "session.prompt" })

export interface TitleDeps {
  agents: Agent.Interface
  provider: Provider.Interface
  llm: LLM.Interface
  sessions: Session.Interface
}

export const title = Effect.fn("SessionPrompt.ensureTitle")(function* (
  deps: TitleDeps,
  input: {
    session: Session.Info
    history: MessageV2.WithParts[]
    providerID: ProviderID
    modelID: ModelID
  },
) {
  if (input.session.parentID) return
  if (!Session.isDefaultTitle(input.session.title)) return

  const real = (m: MessageV2.WithParts) =>
    m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
  const idx = input.history.findIndex(real)
  if (idx === -1) return
  if (input.history.filter(real).length !== 1) return

  const context = input.history.slice(0, idx + 1)
  const firstUser = context[idx]
  if (!firstUser || firstUser.info.role !== "user") return
  const firstInfo = firstUser.info

  const subtasks = firstUser.parts.filter((p): p is MessageV2.SubtaskPart => p.type === "subtask")
  const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

  const ag = yield* deps.agents.get("title")
  if (!ag) return
  // Resolution must be total: a stale agent.title.model pin or a broken
  // small_model config must fall through to the turn's model instead of
  // failing this effect — run-loop forks title with Effect.ignore, so an
  // error here silently disables title generation. getModel surfaces the
  // missing-model error as a defect, hence catchDefect (the idiom used for
  // this call in create-user-message.ts), not Effect.catch.
  const mdl = yield* Effect.gen(function* () {
    if (ag.model) {
      const pinned = yield* deps.provider
        .getModel(ag.model.providerID, ag.model.modelID)
        .pipe(Effect.catchDefect(() => Effect.succeed(undefined)))
      if (pinned) return pinned
    }
    const small = yield* deps.provider
      .getSmallModel(input.providerID)
      .pipe(Effect.catchDefect(() => Effect.succeed(undefined)))
    if (small) return small
    return yield* deps.provider
      .getModel(input.providerID, input.modelID)
      .pipe(Effect.catchDefect(() => Effect.succeed(undefined)))
  })
  if (!mdl) return
  const msgs = onlySubtasks
    ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
    : yield* MessageV2.toModelMessagesEffect(context, mdl)
  const text = yield* deps.llm
    .stream({
      agent: ag,
      user: firstInfo,
      system: { prefix: "", suffix: "" },
      small: true,
      tools: {},
      model: mdl,
      sessionID: input.session.id,
      retries: 2,
      messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
    })
    .pipe(
      Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
      Stream.map((e) => e.text),
      Stream.mkString,
      Effect.orDie,
    )
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!cleaned) return
  const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
  yield* deps.sessions
    .setTitle({ sessionID: input.session.id, title: t })
    .pipe(Effect.catchCause((cause) => elog.error("failed to generate title", { error: Cause.squash(cause) })))
})
