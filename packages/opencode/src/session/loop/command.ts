// Extracted from session/prompt.ts Phase 5a: the `command` entry point —
// resolves a named slash command, expands $ARGUMENTS / positional placeholders,
// runs inline bash blocks, then delegates to `prompt` (or assembles a subtask).
// Deps are passed explicitly (deps-object pattern); the not-yet-extracted
// `resolvePromptParts` and `prompt` closures are threaded in as callables
// (same pattern as `runner`/`ops` in run-loop.ts). InstanceState.context
// resolves from the layer context.
import { Effect } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { Command } from "@/command"
import { Provider } from "@/provider/provider"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Plugin } from "@/plugin"
import { Agent } from "@/agent/agent"
import { Shell } from "@/shell/shell"
import { ConfigMarkdown } from "@/config/markdown"
import { Process } from "@/util/process"
import { NamedError } from "@opencode-ai/core/util/error"
import { MessageV2 } from "../message-v2"
import { Session } from "../session"
import { bashRegex, argsRegex, placeholderRegex, quoteTrimRegex } from "../prompt/command-regex"
import { currentModel, getModel } from "./model"
import type { CommandInput, PromptInput } from "../prompt"

const elog = EffectLogger.create({ service: "session.prompt" })

export interface CommandDeps {
  commands: Command.Interface
  bus: Bus.Interface
  agents: Agent.Interface
  config: Config.Interface
  plugin: Plugin.Interface
  sessions: Session.Interface
  provider: Provider.Interface
  resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
  prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts>
}

export const command = Effect.fn("SessionPrompt.command")(function* (deps: CommandDeps, input: CommandInput) {
  yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
  const cmd = yield* deps.commands.get(input.command)
  if (!cmd) {
    const available = (yield* deps.commands.list()).map((c) => c.name)
    const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
    yield* deps.bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
    throw error
  }
  const agentName = cmd.agent ?? input.agent ?? (yield* deps.agents.defaultAgent())

  const raw = input.arguments.match(argsRegex) ?? []
  const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
  const templateCommand = yield* Effect.promise(async () => cmd.template)

  const placeholders = templateCommand.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }

  const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex]
  })
  const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
  let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

  if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
    template = template + "\n\n" + input.arguments
  }

  const shellMatches = ConfigMarkdown.shell(template)
  if (shellMatches.length > 0) {
    const cfg = yield* deps.config.get()
    const sh = Shell.preferred(cfg.shell)
    const results = yield* Effect.promise(() =>
      Promise.all(
        shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
      ),
    )
    let index = 0
    template = template.replace(bashRegex, () => results[index++])
  }
  template = template.trim()

  const taskModel = yield* Effect.gen(function* () {
    if (cmd.model) return Provider.parseModel(cmd.model)
    if (cmd.agent) {
      const cmdAgent = yield* deps.agents.get(cmd.agent)
      if (cmdAgent?.model) return cmdAgent.model
    }
    if (input.model) return Provider.parseModel(input.model)
    return yield* currentModel({ sessions: deps.sessions, provider: deps.provider }, input.sessionID)
  })

  yield* getModel({ provider: deps.provider, bus: deps.bus }, taskModel.providerID, taskModel.modelID, input.sessionID)

  const agent = yield* deps.agents.get(agentName)
  if (!agent) {
    const available = (yield* deps.agents.list()).filter((a) => !a.hidden).map((a) => a.name)
    const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
    yield* deps.bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
    throw error
  }

  const templateParts = yield* deps.resolvePromptParts(template)
  const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
  const parts = isSubtask
    ? [
        {
          type: "subtask" as const,
          agent: agent.name,
          description: cmd.description ?? "",
          command: input.command,
          model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
          prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
        },
      ]
    : [...templateParts, ...(input.parts ?? [])]

  const userAgent = isSubtask ? (input.agent ?? (yield* deps.agents.defaultAgent())) : agentName
  const userModel = isSubtask
    ? input.model
      ? Provider.parseModel(input.model)
      : yield* currentModel({ sessions: deps.sessions, provider: deps.provider }, input.sessionID)
    : taskModel

  yield* deps.plugin.trigger(
    "command.execute.before",
    { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
    { parts },
  )

  const result = yield* deps.prompt({
    sessionID: input.sessionID,
    messageID: input.messageID,
    model: userModel,
    agent: userAgent,
    parts,
    variant: input.variant,
  })
  yield* deps.bus.publish(Command.Event.Executed, {
    name: input.command,
    sessionID: input.sessionID,
    arguments: input.arguments,
    messageID: result.info.id,
  })
  return result
})
