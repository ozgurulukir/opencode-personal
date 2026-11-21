import path from "path"
import os from "os"
import { SessionID, MessageID } from "./schema"
import { MessageV2 } from "./message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { SessionRevert } from "./revert"
import * as Session from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"
import { SessionCompaction } from "./compaction"
import { Bus } from "../bus"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "./system"

import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { toolsToPermissions } from "@/permission/tools"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Truncate } from "@/tool/truncate"
import { decodeDataUrl } from "@/util/data-url"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Types } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import { type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { EffectBridge } from "@/effect/bridge"
import { SyncEvent } from "@/sync"
import { SessionEvent } from "@/v2/session-event"
import { AgentAttachment, FileAttachment, Source } from "@/v2/session-prompt"
import * as DateTime from "effect/DateTime"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { SessionTable } from "./session.sql"
import { getModel, currentModel, lastAssistant } from "./loop/model"
import { runLoop } from "./loop/run-loop"
import { predict } from "./loop/predict"
import { command } from "./loop/command"
import { shellImpl } from "./loop/shell"
import { createUserMessage } from "./loop/create-user-message"
import { PromptInput, LoopInput, ShellInput, CommandInput } from "./loop/types"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const log = Log.create({ service: "session.prompt" })
const elog = EffectLogger.create({ service: "session.prompt" })

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts>
  readonly loop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts>
  readonly command: (input: CommandInput) => Effect.Effect<MessageV2.WithParts>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
  readonly predict: (input: { sessionID: SessionID }) => Effect.Effect<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

/**
 * Shared prompt engine used by both the V1 compatibility service and V2 session
 * writes. Keeping the engine behind its own service lets V2 use the same
 * persistence and loop orchestration without depending on the V1 facade.
 */
export class Engine extends Context.Service<Engine, Interface>()("@opencode/SessionPromptEngine") {}

export const engineLayer = Layer.effect(
  Engine,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* AppFileSystem.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const sync = yield* SyncEvent.Service
    const runner = Effect.fn("SessionPrompt.runner")(function* () {
      return yield* EffectBridge.make()
    })
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input),
      } satisfies TaskPromptOps
    })

    type ToolSchemaCacheEntry = { schema: Record<string, any> }
    const toolSchemaCache = new Map<string, ToolSchemaCacheEntry>()

    const cachedToolSchema = Effect.fnUntraced(function* (
      source: "registry" | "mcp",
      model: Provider.Model,
      toolID: string,
      getSchema: () => Record<string, any>,
    ) {
      const sourceSchema = getSchema()
      const key = `${source}:${model.providerID}:${model.api.id}:${toolID}:${JSON.stringify(sourceSchema)}`
      const cached = toolSchemaCache.get(key)
      if (cached) return cached.schema
      const transformed = ProviderTransform.schema(model, sourceSchema)
      // Bound the cache: keys embed the full serialized schema, so MCP tool-list
      // churn creates new entries that would otherwise accumulate forever (same
      // cap pattern as the caches in server/shared/ui.ts).
      if (toolSchemaCache.size > 256) {
        const firstKey = toolSchemaCache.keys().next().value
        if (firstKey) toolSchemaCache.delete(firstKey)
      }
      toolSchemaCache.set(key, { schema: transformed })
      return transformed
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* elog.info("cancel", { sessionID })
      yield* state.cancel(sessionID)
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (seen.has(name)) return
          seen.add(name)
          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.shell")(
      function* (input: ShellInput) {
        const ready = yield* Latch.make()
        return yield* state.startShell(
          input.sessionID,
          lastAssistant({ sessions }, input.sessionID),
          shellImpl({ sessions, revert, agents, bus, plugin, config, provider, spawner, sync }, input, ready),
          ready,
        )
      },
    )

    const prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.prompt")(
      function* (input: PromptInput) {
        const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
        yield* revert.cleanup(session)
        const message = yield* createUserMessage(
          { agents, bus, provider, sync, instruction, mcp, fsys, registry, lsp, plugin, sessions },
          input,
        )
        yield* sessions.touch(input.sessionID)

        const cfg = yield* config.get()
        const primary = new Set(cfg.experimental?.primary_tools ?? [])
        const derived = Object.fromEntries(
          Object.entries(toolsToPermissions(input.tools)).filter(([tool]) => !primary.has(tool)),
        )
        const permissions = Permission.fromConfig(derived)
        if (permissions.length > 0) {
          session.permission = Permission.dedupe(Permission.merge(session.permission ?? [], permissions))
          yield* sessions.setPermission({ sessionID: session.id, permission: session.permission })
        }

        if (input.noReply === true) return message
        return yield* loop({ sessionID: input.sessionID })
      },
    )

    const loop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts> = Effect.fn("SessionPrompt.loop")(function* (
      input: LoopInput,
    ) {
      return yield* state.ensureRunning(
        input.sessionID,
        lastAssistant({ sessions }, input.sessionID),
        runLoop(
          {
            sessions,
            status,
            compaction,
            agents,
            processor,
            plugin,
            bus,
            config,
            scope,
            summary,
            sys,
            instruction,
            provider,
            llm,
            registry,
            mcp,
            permission,
            truncate,
            fsys,
            runner,
            ops,
            cachedToolSchema,
            sync,
          },
          input.sessionID,
        ),
      )
    })

    return Engine.of({
      cancel,
      prompt,
      loop,
      shell,
      command: (input) =>
        command({ commands, bus, agents, config, plugin, sessions, provider, resolvePromptParts, prompt }, input),
      resolvePromptParts,
      predict: (input) => predict({ config, sessions, agents, provider }, input),
    })
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const engine = yield* Engine
    return Service.of(engine)
  }),
).pipe(Layer.provideMerge(engineLayer))

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(
      Layer.mergeAll(
        Agent.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        Bus.layer,
        CrossSpawnSpawner.defaultLayer,
        SyncEvent.defaultLayer,
      ),
    ),
  ),
)
export { PromptInput, LoopInput, ShellInput, CommandInput } from "./loop/types"
export { cleanPrediction } from "../session/prompt/predict"
export { createStructuredOutputTool } from "../session/prompt/structured-output"

export * as SessionPrompt from "./prompt"
