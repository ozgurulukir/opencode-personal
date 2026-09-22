// The agent loop: streams the LLM, executes tools, persists parts, and exits
// when the assistant finishes without pending tool calls. Extracted from
// session/prompt.ts (was runLoop, prompt.ts:821-1065) in Phase 4 of the
// prompt.ts decomposition. All sibling functions (title, getModel,
// handleSubtask, resolveTools, insertReminders, lastAssistant) are imported
// from this directory and called with their own deps forwarded from `deps`.
// InstanceState.context resolves from the layer context.
import { Effect, Scope } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { MessageV2 } from "../message-v2"
import { MessageID, SessionID } from "../schema"
import * as Session from "../session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { SessionStatus } from "../status"
import { SessionProcessor } from "../processor"
import { SessionCompaction } from "../compaction"
import { SessionSummary } from "../summary"
import { Instruction } from "../instruction"
import { SystemPrompt } from "../system"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "@/mcp"
import { Truncate } from "@/tool/truncate"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { EffectBridge } from "@/effect/bridge"
import { type TaskPromptOps } from "@/tool/task"
import { SyncEvent } from "@/sync"
import { NamedError } from "@opencode-ai/core/util/error"
import { wrapMessageContinuation } from "../message-continuation"
import { createStructuredOutputTool, STRUCTURED_OUTPUT_SYSTEM_PROMPT } from "../prompt/structured-output"
import MAX_STEPS from "../prompt/max-steps.txt"
import type { SystemPrompt as LLMSystemPrompt } from "../llm"
import { LLM } from "../llm"
import { InstanceState } from "@/effect/instance-state"
import { title } from "./title"
import { getModel, lastAssistant } from "./model"
import { handleSubtask } from "./subtask"
import { resolveTools, type CachedToolSchema } from "./tools"
import { insertReminders } from "./reminders"

const elog = EffectLogger.create({ service: "session.prompt" })

export interface RunLoopDeps {
  // runLoop's own services
  sessions: Session.Interface
  status: SessionStatus.Interface
  compaction: SessionCompaction.Interface
  agents: Agent.Interface
  processor: SessionProcessor.Interface
  plugin: Plugin.Interface
  bus: Bus.Interface
  config: Config.Interface
  scope: Scope.Scope
  summary: SessionSummary.Interface
  sys: SystemPrompt.Interface
  instruction: Instruction.Interface
  // forwarded to sibling calls
  provider: Provider.Interface
  llm: LLM.Interface
  registry: ToolRegistry.Interface
  mcp: MCP.Interface
  permission: Permission.Interface
  truncate: Truncate.Interface
  fsys: AppFileSystem.Interface
  runner: () => Effect.Effect<EffectBridge.Shape>
  ops: () => Effect.Effect<TaskPromptOps>
  cachedToolSchema: CachedToolSchema
  sync: SyncEvent.Interface
}

// ⚡ Bolt Optimization: Replace chained .filter().map().join(" ") with a single loop to reduce GC pressure and O(N) traversals
function extractUserText(parts: MessageV2.Part[] | undefined): string | undefined {
  if (!parts) return undefined
  const texts: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.type === "text") {
      texts.push(p.text)
    }
  }
  return texts.join(" ")
}

export const runLoop: (deps: RunLoopDeps, sessionID: SessionID) => Effect.Effect<MessageV2.WithParts> = Effect.fn(
  "SessionPrompt.run",
)(function* (deps: RunLoopDeps, sessionID: SessionID) {
  const ctx = yield* InstanceState.context
  const slog = elog.with({ sessionID })
  let structured: unknown
  let step = 0
  const session = yield* deps.sessions.get(sessionID).pipe(Effect.orDie)

  while (true) {
    yield* deps.status.set(sessionID, { type: "busy" })
    yield* slog.info("loop", { step })

    let msgs = yield* MessageV2.filterCompactedEffect(sessionID)

    const {
      user: lastUser,
      assistant: lastAssistant,
      finished: lastFinished,
      tasks,
    } = MessageV2.latest(msgs) as {
      user: MessageV2.User | undefined
      assistant: MessageV2.Assistant | undefined
      finished: MessageV2.Assistant | undefined
      tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[]
    }

    if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

    const lastAssistantMsg = msgs.findLast(
      (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
    )
    // Some providers return "stop" even when the assistant message contains tool calls.
    // Keep the loop running so tool results can be sent back to the model.
    // Skip provider-executed tool parts — those were fully handled within the
    // provider's stream (e.g. DWS Agent Platform) and don't need a re-loop.
    const hasToolCalls =
      lastAssistantMsg?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

    if (
      lastAssistant?.finish &&
      !["tool-calls"].includes(lastAssistant.finish) &&
      !hasToolCalls &&
      lastUser.id < lastAssistant.id
    ) {
      yield* slog.info("exiting loop")
      break
    }

    step++
    if (step === 1)
      yield* title(
        { agents: deps.agents, provider: deps.provider, llm: deps.llm, sessions: deps.sessions },
        {
          session,
          modelID: lastUser.model.modelID,
          providerID: lastUser.model.providerID,
          history: msgs,
        },
      ).pipe(Effect.ignore, Effect.forkIn(deps.scope))

    const model = yield* getModel(
      { provider: deps.provider, bus: deps.bus },
      lastUser.model.providerID,
      lastUser.model.modelID,
      sessionID,
    )
    const task = tasks.shift()

    if (task?.type === "subtask") {
      yield* handleSubtask(
        {
          ops: deps.ops,
          registry: deps.registry,
          sessions: deps.sessions,
          plugin: deps.plugin,
          agents: deps.agents,
          bus: deps.bus,
          permission: deps.permission,
          provider: deps.provider,
          sync: deps.sync,
        },
        { task, model, lastUser, sessionID, session, msgs },
      )
      continue
    }

    if (task?.type === "compaction") {
      const result = yield* deps.compaction.process({
        messages: msgs,
        parentID: lastUser.id,
        sessionID,
        auto: task.auto,
        overflow: task.overflow,
      })
      if (result === "stop") break
      continue
    }

    const lastUserMsg = msgs.findLast((m) => m.info.id === lastUser.id)
    const isCurrentTurnContinue =
      lastUserMsg?.parts.some((p) => p.type === "text" && p.metadata?.compaction_continue) ?? false

    if (
      lastFinished &&
      lastFinished.summary !== true &&
      !isCurrentTurnContinue &&
      (yield* deps.compaction.isOverflow({ tokens: lastFinished.tokens, model }))
    ) {
      yield* deps.compaction.create({
        sessionID,
        agent: lastUser.agent,
        model: lastUser.model,
        auto: true,
        tools: lastUser.tools,
        format: lastUser.format,
        system: lastUser.system,
      })
      continue
    }

    const agent = yield* deps.agents.get(lastUser.agent)
    if (!agent) {
      const available = (yield* deps.agents.list()).filter((a) => !a.hidden).map((a) => a.name)
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
      yield* deps.bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
      throw error
    }
    const maxSteps = agent.steps ?? Infinity
    const isLastStep = step >= maxSteps
    msgs = yield* insertReminders(
      { sessions: deps.sessions, fsys: deps.fsys },
      { messages: msgs, agent, session },
    )

    const msg: MessageV2.Assistant = {
      id: MessageID.ascending(),
      parentID: lastUser.id,
      role: "assistant",
      mode: agent.name,
      agent: agent.name,
      variant: lastUser.model.variant,
      path: { cwd: ctx.directory, root: ctx.worktree },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: model.id,
      providerID: model.providerID,
      time: { created: Date.now() },
      sessionID,
    }
    yield* deps.sessions.updateMessage(msg)
    const handle = yield* deps.processor.create({
      assistantMessage: msg,
      sessionID,
      model,
    })

    const outcome: "break" | "continue" = yield* Effect.gen(function* () {
      const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
      const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

      const tools = yield* resolveTools(
        {
          registry: deps.registry,
          mcp: deps.mcp,
          permission: deps.permission,
          plugin: deps.plugin,
          truncate: deps.truncate,
          runner: deps.runner,
          ops: deps.ops,
          cachedToolSchema: deps.cachedToolSchema,
          sync: deps.sync,
        },
        {
          agent,
          session,
          model,
          tools: lastUser.tools,
          processor: handle,
          bypassAgentCheck,
          messages: msgs,
        },
      )

      if (lastUser.format?.type === "json_schema") {
        tools["StructuredOutput"] = createStructuredOutputTool({
          schema: lastUser.format.schema,
          onSuccess(output) {
            structured = output
          },
        })
      }

      if (step === 1)
        yield* deps.summary
          .summarize({ sessionID, messageID: lastUser.id })
          .pipe(Effect.ignore, Effect.forkIn(deps.scope))

      if (step > 1 && lastFinished) {
        msgs = wrapMessageContinuation(msgs, lastFinished.id)
      }

      yield* deps.plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

      const cfg = yield* deps.config.get()
      const userText = extractUserText(lastUserMsg?.parts)
      const autoMatchOpts = cfg.skills?.autoMatch
        ? {
            autoMatch: true,
            count: cfg.skills.autoMatchCount ?? 3,
            threshold: cfg.skills.autoMatchThreshold ?? 0.25,
          }
        : undefined

      const [skills, env, instructions, modelMsgs] = yield* Effect.all([
        deps.sys.skills(agent, userText, autoMatchOpts),
        deps.sys.environment(model),
        deps.instruction.system().pipe(Effect.orDie),
        MessageV2.toModelMessagesEffect(msgs, model),
      ])
      const format = lastUser.format ?? { type: "text" as const }
      const suffixParts = [
        ...env,
        ...(skills ? [skills] : []),
        ...(format.type === "json_schema" ? [STRUCTURED_OUTPUT_SYSTEM_PROMPT] : []),
        ...(lastUser.system ? [lastUser.system] : []),
      ]
      const system: LLMSystemPrompt = {
        // Intentionally empty — LLM.stream resolves the prefix from
        // `agent.prompt ?? SystemPrompt.provider(model).prefix`. See the
        // SystemPrompt type JSDoc in llm.ts for the two-phase assembly rationale.
        prefix: "",
        suffix: suffixParts.filter((x) => x).join("\n"),
      }
      const result = yield* handle.process({
        user: lastUser,
        agent,
        permission: session.permission,
        sessionID,
        parentSessionID: session.parentID,
        system,
        messages: [
          ...(instructions.length > 0 ? [{ role: "user" as const, content: instructions.join("\n\n") }] : []),
          ...modelMsgs,
          ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : []),
        ],
        tools,
        model,
        toolChoice: format.type === "json_schema" ? "required" : undefined,
      })

      if (structured !== undefined) {
        const message: MessageV2.Assistant = {
          ...handle.message,
          structured,
          finish: handle.message.finish ?? "stop",
        }
        yield* deps.sessions.updateMessage(message)
        return "break" as const
      }

      const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
      if (finished && !handle.message.error) {
        if (format.type === "json_schema") {
          const message: MessageV2.Assistant = {
            ...handle.message,
            error: new MessageV2.StructuredOutputError({
              message: "Model did not produce structured output",
              retries: 0,
            }).toObject(),
          }
          yield* deps.sessions.updateMessage(message)
          return "break" as const
        }
      }

      if (result === "stop") return "break" as const
      if (result === "compact") {
        // create() is Effect<void>; the next iteration re-reads compacted messages
        yield* deps.compaction.create({
          sessionID,
          agent: lastUser.agent,
          model: lastUser.model,
          auto: true,
          overflow: !handle.message.finish,
        })
      }
      return "continue" as const
    }).pipe(Effect.ensuring(deps.instruction.clear(handle.message.id)))
    if (outcome === "break") break
    continue
  }

  yield* deps.compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(deps.scope))
  return yield* lastAssistant({ sessions: deps.sessions }, sessionID)
})
