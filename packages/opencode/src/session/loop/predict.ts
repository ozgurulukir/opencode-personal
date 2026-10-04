// Extracted from session/prompt.ts Phase 5a: ghost-text next-prompt prediction.
// Called from the TUI after each turn so the empty input can show a gray
// suggested follow-up the user accepts with Tab. The implementation deliberately
// bypasses `llm.stream` and the session-coupled plugin hooks — this is a
// side-channel call that must not appear in the session trajectory, must not
// publish memory instructions, and must not trigger chat.params/headers/transform.
// The small ("title") model is preferred; we fall back to the last assistant
// model and finally to getSmallModel for the last assistant's provider.
// Deps are passed explicitly (deps-object pattern); InstanceState.context
// resolves from the layer context.
import { Cause, Effect } from "effect"
import { streamText, wrapLanguageModel } from "ai"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { ProviderTransform, isQwen3Model } from "@/provider/transform"
import { Config } from "@/config/config"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { cleanPrediction, PREDICT_NUDGE, PREDICT_SYSTEM } from "../prompt/predict"
import { MessageV2 } from "../message-v2"
import { SessionID } from "../schema"
import { Session } from "../session"

const elog = EffectLogger.create({ service: "session.prompt" })

export interface PredictDeps {
  config: Config.Interface
  sessions: Session.Interface
  agents: Agent.Interface
  provider: Provider.Interface
}

export const predict = Effect.fn("SessionPrompt.predict")(function* (
  deps: PredictDeps,
  input: { sessionID: SessionID },
) {
  const cfg = yield* deps.config.get()
  if (cfg.experimental?.predict_next_prompt === false) return ""

  const history = yield* deps.sessions.messages({ sessionID: input.sessionID })
  const real = (m: MessageV2.WithParts) =>
    m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
  let userIdx = -1
  // ⚡ Bolt Optimization: Using backward loop instead of .findLastIndex() to avoid GC pressure and O(N) traversal overhead
  for (let i = history.length - 1; i >= 0; i--) {
    if (real(history[i])) {
      userIdx = i
      break
    }
  }
  if (userIdx === -1) return ""
  const lastUser = history[userIdx]
  if (lastUser.info.role !== "user") return ""

  // Only the assistant turn that actually answered this user message
  // counts. Bail if any assistant after it is still running, so we never
  // pair the newest prompt with a stale/older result.
  const assistants = history
    .slice(userIdx + 1)
    .filter((m): m is MessageV2.WithParts & { info: MessageV2.Assistant } => m.info.role === "assistant")
  if (assistants.length === 0) return ""
  if (assistants.some((m) => m.info.time.completed === undefined)) return ""
  const lastAssistant = assistants[assistants.length - 1]

  // Context fed to the prediction: up to 3 most recent real user queries
  // (chronological) plus the latest assistant turn (which carries tool
  // outputs + final assistant text). Earlier assistant turns are dropped
  // to keep the prompt small.
  const recentUsers = history.filter(real).slice(-3)
  const contextMsgs = [...recentUsers, lastAssistant]

  // Prefer the small ("title") model for cost; fall back to the assistant's
  // own model, and finally to getSmallModel for the assistant's provider.
  // Each step is wrapped in Effect.catch -> succeed(undefined) so a
  // missing provider/model just leaves us with the next fallback rather
  // than failing the whole prediction.
  const titleAg = yield* deps.agents.get("title")
  const mdl = yield* Effect.gen(function* () {
    if (titleAg?.model) {
      return yield* deps.provider
        .getModel(titleAg.model.providerID, titleAg.model.modelID)
        .pipe(Effect.catch(() => Effect.succeed(undefined)))
    }
    return undefined
  })
  const fallback = yield* Effect.gen(function* () {
    if (mdl) return mdl
    return yield* deps.provider
      .getModel(lastAssistant.info.providerID, lastAssistant.info.modelID)
      .pipe(
        Effect.catch(() =>
          deps.provider
            .getSmallModel(lastAssistant.info.providerID)
            .pipe(Effect.catch(() => Effect.succeed(undefined))),
        ),
      )
  })
  if (!fallback) return ""
  const model = mdl ?? fallback

  const msgs = yield* MessageV2.toModelMessagesEffect(contextMsgs, model, { stripMedia: true })
  const language = yield* deps.provider.getLanguage(model)

  // Wrap the language model so we share the prompt-format transform used by
  // the main run loop. The middleware touches only `args.params.prompt`,
  // which is provider-agnostic shape, so wrapping here is safe.
  const wrapped = wrapLanguageModel({
    model: language,
    middleware: [
      {
        specificationVersion: "v3" as const,
        async transformParams(args) {
          if (args.type === "generate" || args.type === "stream") {
            // @ts-expect-error — ai's prompt type is not exported under a stable name
            args.params.prompt = ProviderTransform.message(args.params.prompt, model, {})
          }
          return args.params
        },
      },
    ],
  })

  // Qwen3 chat templates require the system message at index 0.
  const qwen3 = isQwen3Model(model)
  const predictMessages = qwen3
    ? [{ role: "system" as const, content: PREDICT_SYSTEM }, ...msgs, { role: "user" as const, content: PREDICT_NUDGE }]
    : [...msgs, { role: "user" as const, content: PREDICT_NUDGE }]

  const text = yield* Effect.tryPromise(() =>
    streamText({
      model: wrapped,
      allowSystemInMessages: true,
      system: qwen3 ? undefined : PREDICT_SYSTEM,
      messages: predictMessages,
      maxOutputTokens:
        // Mirrors the codex plugin's chat.params rule, which strips
        // maxOutputTokens for openai models ("Match codex cli") because the
        // ChatGPT backend rejects the parameter. predict bypasses plugin
        // hooks by design, so the rule has to be duplicated here — sending
        // max_output_tokens to an openai OAuth session fails the request and
        // silently kills the ghost-text suggestion.
        model.providerID !== "openai" && ProviderTransform.supportsMaxOutputTokens(model)
          ? ProviderTransform.maxOutputTokens(model)
          : undefined,
      temperature: model.capabilities.temperature ? 0.7 : undefined,
      providerOptions: ProviderTransform.providerOptions(model, ProviderTransform.smallOptions(model)),
      headers: {
        ...model.headers,
        "User-Agent": `opencode/${InstallationVersion}`,
      },
      maxRetries: 1,
    }).text,
  ).pipe(
    Effect.catchCause((cause) =>
      elog.warn("predict failed", { error: Cause.pretty(cause) }).pipe(Effect.as(undefined)),
    ),
  )
  if (!text) return ""
  return cleanPrediction(text)
})
