// Extracted from session/prompt.ts Phase 5a: the `shellImpl` entry point —
// materializes user + assistant messages and a running shell tool part, spawns
// the child process via the ChildProcessSpawner service, streams output into
// the part, finalizes success/abort/error, and emits v2 sync events. Deps are
// passed explicitly (deps-object pattern); InstanceState.context resolves from
// the layer context.
import { Cause, Effect, Exit, Latch } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as Stream from "effect/Stream"
import * as DateTime from "effect/DateTime"
import { ulid } from "ulid"
import { Shell } from "@/shell/shell"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Flag } from "@opencode-ai/core/flag/flag"
import { NamedError } from "@opencode-ai/core/util/error"
import { SyncEvent } from "@/sync"
import { SessionEvent } from "@/v2/session-event"
import { InstanceState } from "@/effect/instance-state"
import { MessageV2 } from "../message-v2"
import { MessageID, PartID } from "../schema"
import { Session } from "../session"
import { SessionRevert } from "../revert"
import { ShellID } from "@/tool/shell/id"
import { currentModel } from "./model"
import type { ShellInput } from "../prompt"

export interface ShellImplDeps {
  sessions: Session.Interface
  revert: SessionRevert.Interface
  agents: Agent.Interface
  bus: Bus.Interface
  plugin: Plugin.Interface
  config: Config.Interface
  provider: Provider.Interface
  spawner: ChildProcessSpawner["Service"]
  sync: SyncEvent.Interface
}

export const shellImpl = Effect.fn("SessionPrompt.shellImpl")(
  function* (deps: ShellImplDeps, input: ShellInput, ready?: Latch.Latch) {
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
        const { msg, part, cwd } = yield* Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const session = yield* deps.sessions.get(input.sessionID).pipe(Effect.orDie)
          if (session.revert) {
            yield* deps.revert.cleanup(session)
          }
          const agent = yield* deps.agents.get(input.agent)
          if (!agent) {
            const available = (yield* deps.agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
            yield* deps.bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
            throw error
          }
          const model = input.model ?? agent.model ?? (yield* currentModel({ sessions: deps.sessions, provider: deps.provider }, input.sessionID))
          const userMsg: MessageV2.User = {
            id: input.messageID ?? MessageID.ascending(),
            sessionID: input.sessionID,
            time: { created: Date.now() },
            role: "user",
            agent: input.agent,
            model: { providerID: model.providerID, modelID: model.modelID },
          }
          yield* deps.sessions.updateMessage(userMsg)
          const userPart: MessageV2.Part = {
            type: "text",
            id: PartID.ascending(),
            messageID: userMsg.id,
            sessionID: input.sessionID,
            text: "The following tool was executed by the user",
            synthetic: true,
          }
          yield* deps.sessions.updatePart(userPart)

          const msg: MessageV2.Assistant = {
            id: MessageID.ascending(),
            sessionID: input.sessionID,
            parentID: userMsg.id,
            mode: input.agent,
            agent: input.agent,
            cost: 0,
            path: { cwd: ctx.directory, root: ctx.worktree },
            time: { created: Date.now() },
            role: "assistant",
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.modelID,
            providerID: model.providerID,
          }
          yield* deps.sessions.updateMessage(msg)
          const callID = ulid()
          const started = Date.now()
          const part: MessageV2.ToolPart = {
            type: "tool",
            id: PartID.ascending(),
            messageID: msg.id,
            sessionID: input.sessionID,
            tool: ShellID.ToolID,
            callID: ulid(),
            state: {
              status: "running",
              time: { start: started },
              input: { command: input.command },
            },
          }
          yield* deps.sessions.updatePart(part)
          if (Flag.OPENCODE_EXPERIMENTAL_EVENT_SYSTEM) {
            yield* deps.sync.run(SessionEvent.Shell.Started.Sync, {
              sessionID: input.sessionID,
              timestamp: DateTime.makeUnsafe(started),
              callID,
              command: input.command,
            })
          }
          return { msg, part, cwd: ctx.directory }
        }).pipe(Effect.ensuring(markReady))

        const cfg = yield* deps.config.get()
        const sh = Shell.preferred(cfg.shell)
        const args = Shell.args(sh, input.command, cwd)
        let output = ""
        let aborted = false

        const finish = Effect.uninterruptible(
          Effect.gen(function* () {
            if (aborted) {
              output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
            }
            const completed = Date.now()
            if (Flag.OPENCODE_EXPERIMENTAL_EVENT_SYSTEM) {
              yield* deps.sync.run(SessionEvent.Shell.Ended.Sync, {
                sessionID: input.sessionID,
                timestamp: DateTime.makeUnsafe(completed),
                callID: part.callID,
                output,
              })
            }
            if (!msg.time.completed) {
              msg.time.completed = completed
              yield* deps.sessions.updateMessage(msg)
            }
            if (part.state.status === "running") {
              part.state = {
                status: "completed",
                time: { ...part.state.time, end: completed },
                input: part.state.input,
                title: "",
                metadata: { output, description: "" },
                output,
              }
              yield* deps.sessions.updatePart(part)
            }
          }),
        )

        const exit = yield* restore(
          Effect.gen(function* () {
            const shellEnv = yield* deps.plugin.trigger(
              "shell.env",
              { cwd, sessionID: input.sessionID, callID: part.callID },
              { env: {} },
            )
            const cmd = ChildProcess.make(sh, args, {
              cwd,
              extendEnv: true,
              env: { ...shellEnv.env, TERM: "dumb" },
              stdin: "ignore",
              forceKillAfter: "3 seconds",
            })
            const handle = yield* deps.spawner.spawn(cmd)
            yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
              Effect.gen(function* () {
                output += chunk
                if (part.state.status === "running") {
                  part.state.metadata = { output, description: "" }
                  yield* deps.sessions.updatePart(part)
                }
              }),
            )
            yield* handle.exitCode
          }).pipe(Effect.scoped, Effect.orDie),
        ).pipe(Effect.exit)

        if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
          aborted = true
        }
        yield* finish

        if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
          return yield* Effect.failCause(exit.cause)
        }

        return { info: msg, parts: [part] }
      }),
    )
  },
)
