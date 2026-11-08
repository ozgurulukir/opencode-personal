// Extracted from session/prompt.ts Phase 3: handles a subtask (task tool) step
// in the run loop — materializes the assistant message + running tool part,
// invokes the TaskTool, finalizes success/error/cancel states, and appends a
// synthetic summary user message for command subtasks. Deps are passed
// explicitly (deps-object pattern); the `ops` function (closing over the
// sibling prompt/shell/cancel impls) is defined in prompt.ts and threaded in.
// InstanceState.context resolves from the layer context.
import { Cause, DateTime, Effect } from "effect"
import { ulid } from "ulid"
import { NamedError } from "@opencode-ai/core/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { Provider } from "@/provider/provider"
import { Bus } from "@/bus"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { ToolRegistry } from "@/tool/registry"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { InstanceState } from "@/effect/instance-state"
import { Session } from "../session"
import { MessageV2 } from "../message-v2"
import { SessionID, MessageID, PartID } from "../schema"
import { getModel } from "./model"
import { SyncEvent } from "@/sync"
import { SessionEvent } from "@/v2/session-event"
import { Modelv2 } from "@/v2/model"
import { SessionMessage } from "@/v2/session-message"

const log = Log.create({ service: "session.prompt" })

export interface HandleSubtaskDeps {
  ops: () => Effect.Effect<TaskPromptOps>
  registry: ToolRegistry.Interface
  sessions: Session.Interface
  plugin: Plugin.Interface
  agents: Agent.Interface
  bus: Bus.Interface
  permission: Permission.Interface
  provider: Provider.Interface
  sync: SyncEvent.Interface
}

export const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (
  deps: HandleSubtaskDeps,
  input: {
    task: MessageV2.SubtaskPart
    model: Provider.Model
    lastUser: MessageV2.User
    sessionID: SessionID
    session: Session.Info
    msgs: MessageV2.WithParts[]
  },
) {
  const { task, model, lastUser, sessionID, session, msgs } = input
  const ctx = yield* InstanceState.context
  const promptOps = yield* deps.ops()
  const { task: taskTool } = yield* deps.registry.named()
  const taskModel = task.model
    ? yield* getModel({ provider: deps.provider, bus: deps.bus }, task.model.providerID, task.model.modelID, sessionID)
    : model
  const assistantMessage: MessageV2.Assistant = yield* deps.sessions.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    parentID: lastUser.id,
    sessionID,
    mode: task.agent,
    agent: task.agent,
    variant: lastUser.model.variant,
    path: { cwd: ctx.directory, root: ctx.worktree },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: taskModel.id,
    providerID: taskModel.providerID,
    time: { created: Date.now() },
  })
  const taskArgs = {
    prompt: task.prompt,
    description: task.description,
    subagent_type: task.agent,
    command: task.command,
  }
  const normalizedInput = SessionMessage.normalizeToolInput(taskArgs)
  let part: MessageV2.ToolPart = yield* deps.sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "tool",
    callID: ulid(),
    tool: TaskTool.id,
    state: {
      status: "running",
      input: taskArgs,
      time: { start: Date.now() },
    },
  })
  const startTs = DateTime.makeUnsafe(Date.now())
  yield* deps.sync.run(SessionEvent.Step.Started.Sync, {
    sessionID,
    legacyMessageID: assistantMessage.id,
    agent: assistantMessage.agent,
    model: {
      id: Modelv2.ID.make(taskModel.id),
      providerID: Modelv2.ProviderID.make(taskModel.providerID),
      variant: Modelv2.VariantID.make(assistantMessage.variant ?? "default"),
    },
    timestamp: startTs,
  })
  yield* deps.sync.run(SessionEvent.Tool.Input.Started.Sync, {
    sessionID,
    callID: part.callID,
    name: TaskTool.id,
    timestamp: startTs,
  })
  yield* deps.sync.run(SessionEvent.Tool.Input.Ended.Sync, {
    sessionID,
    callID: part.callID,
    text: "",
    timestamp: startTs,
  })
  yield* deps.sync.run(SessionEvent.Tool.Called.Sync, {
    sessionID,
    callID: part.callID,
    tool: TaskTool.id,
    input: normalizedInput,
    provider: { executed: false },
    timestamp: startTs,
  })
  yield* deps.plugin.trigger(
    "tool.execute.before",
    { tool: TaskTool.id, sessionID, callID: part.callID },
    { args: taskArgs },
  )

  // Note: `parentRuleset` feeds the spawn deny gate (`taskDenyGateFromRuleset`)
  // inside TaskTool, so it uses the raw agent permission (`parentAgent?.permission ?? []`).
  // Child session permissions are derived separately inside TaskTool via `resolveParentAgent`
  // (which applies FALLBACK_DENY including `task: * -> deny` if the parent agent is missing).
  const parentAgent = yield* deps.agents.get(lastUser.agent)
  const taskAgent = yield* deps.agents.get(task.agent)
  if (!taskAgent) {
    const available = (yield* deps.agents.list()).filter((a) => !a.hidden).map((a) => a.name)
    const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
    yield* deps.bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
    throw error
  }

  const parentRuleset = Permission.merge(parentAgent?.permission ?? [], session.permission ?? [])

  let error: Error | undefined
  const taskAbort = new AbortController()
  const result = yield* taskTool
    .execute(taskArgs, {
      agent: task.agent,
      messageID: assistantMessage.id,
      sessionID,
      abort: taskAbort.signal,
      callID: part.callID,
      extra: { bypassAgentCheck: true, promptOps, permissionRuleset: parentRuleset },
      messages: msgs,
      metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
        Effect.gen(function* () {
          part = yield* deps.sessions.updatePart({
            ...part,
            type: "tool",
            state: { ...part.state, ...val },
          } satisfies MessageV2.ToolPart)
          if (part.state.status !== "running") return
          yield* deps.sync.run(SessionEvent.Tool.Progress.Sync, {
            sessionID: part.sessionID,
            callID: part.callID,
            structured: part.state.metadata ?? {},
            content: [],
            timestamp: DateTime.makeUnsafe(Date.now()),
          })
        }),
      ask: (req: any) =>
        deps.permission
          .ask({
            ...req,
            sessionID,
            tool: { messageID: assistantMessage.id, callID: part.callID },
            ruleset: parentRuleset,
          })
          .pipe(Effect.orDie),
    })
    .pipe(
      Effect.catchCause((cause) => {
        const defect = Cause.squash(cause)
        error = defect instanceof Error ? defect : new Error(String(defect))
        log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
        return Effect.void
      }),
      Effect.onInterrupt(() =>
        Effect.gen(function* () {
          taskAbort.abort()
          const endNow = Date.now()
          const endTs = DateTime.makeUnsafe(endNow)
          assistantMessage.finish = "tool-calls"
          assistantMessage.time.completed = endNow
          yield* deps.sessions.updateMessage(assistantMessage)
          if (part.state.status === "running") {
            yield* deps.sessions.updatePart({
              ...part,
              state: {
                status: "error",
                error: "Cancelled",
                time: { start: part.state.time.start, end: endNow },
                metadata: part.state.metadata,
                input: part.state.input,
              },
            } satisfies MessageV2.ToolPart)
            yield* deps.sync.run(SessionEvent.Tool.Failed.Sync, {
              sessionID,
              callID: part.callID,
              error: { type: "unknown", message: "Cancelled" },
              provider: { executed: false },
              timestamp: endTs,
            })
          }
          yield* deps.sync.run(SessionEvent.Step.Ended.Sync, {
            sessionID,
            finish: "tool-calls",
            cost: assistantMessage.cost,
            tokens: assistantMessage.tokens,
            timestamp: endTs,
          })
        }),
      ),
    )

  const attachments = result?.attachments?.map((attachment) => ({
    ...attachment,
    id: PartID.ascending(),
    sessionID,
    messageID: assistantMessage.id,
  }))

  yield* deps.plugin.trigger(
    "tool.execute.after",
    { tool: TaskTool.id, sessionID, callID: part.callID, args: taskArgs },
    result,
  )

  const completedNow = Date.now()
  const completedTs = DateTime.makeUnsafe(completedNow)
  assistantMessage.finish = "tool-calls"
  assistantMessage.time.completed = completedNow
  yield* deps.sessions.updateMessage(assistantMessage)

  if (result && part.state.status === "running") {
    yield* deps.sessions.updatePart({
      ...part,
      state: {
        status: "completed",
        input: part.state.input,
        title: result.title,
        metadata: result.metadata,
        output: result.output,
        attachments,
        time: { ...part.state.time, end: completedNow },
      },
    } satisfies MessageV2.ToolPart)
    yield* deps.sync.run(SessionEvent.Tool.Success.Sync, {
      sessionID,
      callID: part.callID,
      structured: result.metadata,
      content: [
        {
          type: "text",
          text: result.output,
        },
        ...(attachments?.map((item) => ({
          type: "file" as const,
          uri: item.url,
          mime: item.mime,
          name: item.filename,
        })) ?? []),
      ],
      provider: { executed: false },
      timestamp: completedTs,
    })
  }

  if (!result) {
    const errorMessage = error ? `Tool execution failed: ${error.message}` : "Tool execution failed"
    yield* deps.sessions.updatePart({
      ...part,
      state: {
        status: "error",
        error: errorMessage,
        time: {
          start: part.state.status === "running" ? part.state.time.start : completedNow,
          end: completedNow,
        },
        metadata: part.state.status === "pending" ? undefined : part.state.metadata,
        input: part.state.input,
      },
    } satisfies MessageV2.ToolPart)
    yield* deps.sync.run(SessionEvent.Tool.Failed.Sync, {
      sessionID,
      callID: part.callID,
      error: { type: "unknown", message: errorMessage },
      provider: { executed: false },
      timestamp: completedTs,
    })
  }

  yield* deps.sync.run(SessionEvent.Step.Ended.Sync, {
    sessionID,
    finish: "tool-calls",
    cost: assistantMessage.cost,
    tokens: assistantMessage.tokens,
    timestamp: completedTs,
  })

  if (!task.command) return

  const summaryText = "Summarize the task tool output above and continue with your task."
  const summaryNow = Date.now()
  const summaryUserMsg: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: summaryNow },
    agent: lastUser.agent,
    model: lastUser.model,
  }
  yield* deps.sessions.updateMessage(summaryUserMsg)
  yield* deps.sessions.updatePart({
    id: PartID.ascending(),
    messageID: summaryUserMsg.id,
    sessionID,
    type: "text",
    text: summaryText,
    synthetic: true,
  } satisfies MessageV2.TextPart)
  yield* deps.sync.run(SessionEvent.Synthetic.Sync, {
    sessionID,
    timestamp: DateTime.makeUnsafe(summaryNow),
    text: summaryText,
  })
})
