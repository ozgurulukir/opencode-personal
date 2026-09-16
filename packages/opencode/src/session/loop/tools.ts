// Extracted from session/prompt.ts Phase 3: resolves the registry + MCP tools
// into an AI-SDK tool map for a single model turn, wiring permission asks,
// plugin triggers, truncation, and the EffectBridge-backed execute wrappers.
// Deps are passed explicitly (deps-object pattern); the `runner`/`ops`/
// `cachedToolSchema` functions are defined in prompt.ts (they close over the
// sibling prompt/shell/cancel impls and the schema cache) and threaded in.
import { DateTime, Effect } from "effect"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import * as EffectZod from "@opencode-ai/core/effect-zod"
import * as Log from "@opencode-ai/core/util/log"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { ModelID } from "@/provider/schema"
import { ToolRegistry } from "@/tool/registry"
import { Tool } from "@/tool/tool"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Truncate } from "@/tool/truncate"
import { SessionProcessor } from "../processor"
import { Session } from "../session"
import { MessageV2 } from "../message-v2"
import { PartID } from "../schema"
import { type TaskPromptOps } from "@/tool/task"
import { type EffectBridge } from "@/effect/bridge"
import { deriveMcpPatterns } from "../prompt/mcp-patterns"
import { SyncEvent } from "@/sync"
import { SessionEvent } from "@/v2/session-event"

const log = Log.create({ service: "session.prompt" })

/**
 * Cached schema transformation keyed by source/provider/model/tool/schema JSON.
 * Defined in prompt.ts and threaded in so the cache persists across calls
 * within a single service instance.
 */
export type CachedToolSchema = (
  source: "registry" | "mcp",
  model: Provider.Model,
  toolID: string,
  getSchema: () => Record<string, any>,
) => Effect.Effect<Record<string, any>>

export interface ResolveToolsDeps {
  registry: ToolRegistry.Interface
  mcp: MCP.Interface
  permission: Permission.Interface
  plugin: Plugin.Interface
  truncate: Truncate.Interface
  runner: () => Effect.Effect<EffectBridge.Shape>
  ops: () => Effect.Effect<TaskPromptOps>
  cachedToolSchema: CachedToolSchema
  sync: SyncEvent.Interface
}

export const resolveTools = Effect.fn("SessionPrompt.resolveTools")(function* (
  deps: ResolveToolsDeps,
  input: {
    agent: Agent.Info
    model: Provider.Model
    session: Session.Info
    tools?: Record<string, boolean>
    processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
    bypassAgentCheck: boolean
    messages: MessageV2.WithParts[]
  },
) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}
  const run = yield* deps.runner()
  const promptOps = yield* deps.ops()

  const context = (args: any, options: ToolExecutionOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: {
      model: input.model,
      bypassAgentCheck: input.bypassAgentCheck,
      promptOps,
      permissionRuleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
      sync: deps.sync,
    },
    agent: input.agent.name,
    messages: input.messages,
    metadata: (val) =>
      Effect.gen(function* () {
        const part = yield* input.processor.updateToolCall(options.toolCallId, (match) => {
          if (!["running", "pending"].includes(match.state.status)) return match
          return {
            ...match,
            state: {
              title: val.title,
              metadata: val.metadata,
              status: "running",
              input: args,
              time: { start: Date.now() },
            },
          }
        })
        if (!part || part.state.status !== "running") return
        yield* deps.sync.run(SessionEvent.Tool.Progress.Sync, {
          sessionID: part.sessionID,
          callID: part.callID,
          structured: part.state.metadata ?? {},
          content: [],
          timestamp: DateTime.makeUnsafe(Date.now()),
        })
      }),
    ask: (req) =>
      deps.permission
        .ask({
          ...req,
          sessionID: input.session.id,
          tool: { messageID: input.processor.message.id, callID: options.toolCallId },
          ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
        })
        .pipe(Effect.orDie),
  })

  for (const item of yield* deps.registry.tools({
    modelID: ModelID.make(input.model.api.id),
    providerID: input.model.providerID,
    agent: input.agent,
  })) {
    const schema = yield* deps.cachedToolSchema("registry", input.model, item.id, () =>
      EffectZod.toJsonSchema(item.parameters),
    )
    tools[item.id] = tool({
      description: item.description,
      inputSchema: jsonSchema(schema),
      execute(args, options) {
        return run.promise(
          Effect.gen(function* () {
            const ctx = context(args, options)
            yield* deps.plugin.trigger(
              "tool.execute.before",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
              { args },
            )
            const result = yield* item.execute(args, ctx)
            const output = {
              ...result,
              attachments: result.attachments?.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
            }
            yield* deps.plugin.trigger(
              "tool.execute.after",
              { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
              output,
            )
            if (options.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(options.toolCallId, output)
            }
            return output
          }),
        )
      },
    })
  }

  for (const [key, item] of Object.entries(yield* deps.mcp.tools())) {
    const execute = item.execute
    if (!execute) continue

    const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
    const transformed = yield* deps.cachedToolSchema("mcp", input.model, key, () => schema)
    const inputSchema = jsonSchema(transformed)

    tools[key] = tool({
      description: item.description ?? "",
      inputSchema,
      execute(args, opts) {
        return run.promise(
          Effect.gen(function* () {
            const ctx = context(args, opts)
            yield* deps.plugin.trigger(
              "tool.execute.before",
              { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
              { args },
            )
            const mcpPatterns = deriveMcpPatterns(args)
            const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* Effect.gen(function* () {
              yield* ctx.ask({ permission: key, metadata: {}, patterns: mcpPatterns, always: mcpPatterns })
              return yield* Effect.promise(() => execute(args, opts))
            }).pipe(
              Effect.withSpan("Tool.execute", {
                attributes: {
                  "tool.name": key,
                  "tool.call_id": opts.toolCallId,
                  "session.id": ctx.sessionID,
                  "message.id": input.processor.message.id,
                },
              }),
            )
            yield* deps.plugin.trigger(
              "tool.execute.after",
              { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
              result,
            )

            const textParts: string[] = []
            const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
            for (const contentItem of result.content) {
              if (contentItem.type === "text") textParts.push(contentItem.text)
              else if (contentItem.type === "image") {
                attachments.push({
                  type: "file",
                  mime: contentItem.mimeType,
                  url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                })
              } else if (contentItem.type === "resource") {
                const { resource } = contentItem
                if (resource.text) textParts.push(resource.text)
                if (resource.blob) {
                  attachments.push({
                    type: "file",
                    mime: resource.mimeType ?? "application/octet-stream",
                    url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                    filename: resource.uri,
                  })
                }
              } else if (contentItem.type === "resource_link") {
                textParts.push(`[Resource: ${contentItem.uri}]`)
              } else if (contentItem.type === "audio") {
                attachments.push({
                  type: "file",
                  mime: contentItem.mimeType,
                  url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                })
              }
            }

            // Include structuredContent if present (2025-06-18 spec)
            if (result.structuredContent) {
              textParts.push(JSON.stringify(result.structuredContent, null, 2))
            }

            const truncated = yield* deps.truncate.output(textParts.join("\n\n"), {}, input.agent)
            const metadata = {
              ...result.metadata,
              truncated: truncated.truncated,
              ...(truncated.truncated && { outputPath: truncated.outputPath }),
            }

            const output = {
              title: "",
              metadata,
              output: truncated.content,
              attachments: attachments.map((attachment) => ({
                ...attachment,
                id: PartID.ascending(),
                sessionID: ctx.sessionID,
                messageID: input.processor.message.id,
              })),
              content: result.content,
            }
            if (opts.abortSignal?.aborted) {
              yield* input.processor.completeToolCall(opts.toolCallId, output)
            }
            return output
          }),
        )
      },
    })
  }

  return tools
})
