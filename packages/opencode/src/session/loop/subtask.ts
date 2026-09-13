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
  const taskModel = task.model ? yield* getModel({ provider: deps.provider, bus: deps.bus }, task.model.providerID, task.model.modelID, sessionID) : model
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
  let part: MessageV2.ToolPart = yield* deps.sessions.updatePart({
    id: PartID.ascending(),
    messageID: assistantMessage.id,
    sessionID: assistantMessage.sessionID,
    type: "tool",
    callID: ulid(),
    tool: TaskTool.id,
    state: {
      status: "running",
      input: {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      },
      time: { start: Date.now() },
    },
  })
  const taskArgs = {
    prompt: task.prompt,
    description: task.description,
    subagent_type: task.agent,
    command: task.command,
  }
  yield* deps.plugin.trigger(
    "tool.execute.before",
    { tool: TaskTool.id, sessionID, callID: part.id },
    { args: taskArgs },
  )

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
          assistantMessage.finish = "tool-calls"
          assistantMessage.time.completed = Date.now()
          yield* deps.sessions.updateMessage(assistantMessage)
          if (part.state.status === "running") {
            yield* deps.sessions.updatePart({
              ...part,
              state: {
                status: "error",
                error: "Cancelled",
                time: { start: part.state.time.start, end: Date.now() },
                metadata: part.state.metadata,
                input: part.state.input,
              },
            } satisfies MessageV2.ToolPart)
          }
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
    { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
    result,
  )

  assistantMessage.finish = "tool-calls"
  assistantMessage.time.completed = Date.now()
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
        time: { ...part.state.time, end: Date.now() },
      },
    } satisfies MessageV2.ToolPart)
  }

  if (!result) {
    yield* deps.sessions.updatePart({
      ...part,
      state: {
        status: "error",
        error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
        time: {
          start: part.state.status === "running" ? part.state.time.start : Date.now(),
          end: Date.now(),
        },
        metadata: part.state.status === "pending" ? undefined : part.state.metadata,
        input: part.state.input,
      },
    } satisfies MessageV2.ToolPart)
  }

  if (!task.command) return

  const summaryUserMsg: MessageV2.User = {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: lastUser.agent,
    model: lastUser.model,
  }
  yield* deps.sessions.updateMessage(summaryUserMsg)
  yield* deps.sessions.updatePart({
    id: PartID.ascending(),
    messageID: summaryUserMsg.id,
    sessionID,
    type: "text",
    text: "Summarize the task tool output above and continue with your task.",
    synthetic: true,
  } satisfies MessageV2.TextPart)
})
