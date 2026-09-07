// Creates the user message for a prompt: resolves the agent/model, builds the
// user-info row, resolves every prompt part (file reads, MCP resources, agent
// attachments) into persisted MessageV2 parts, and emits the V2 read-model
// projection events (Prompted/Synthetic). Extracted from session/prompt.ts
// (was createUserMessage, prompt.ts:190-644). Uses the deps-object pattern.

import { Effect, Exit, Cause } from "effect"
import * as DateTime from "effect/DateTime"
import { fileURLToPath } from "url"
import * as Log from "@opencode-ai/core/util/log"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { MessageV2 } from "../message-v2"
import { MessageID, PartID } from "../schema"
import { SessionEvent } from "@/v2/session-event"
import { Modelv2 } from "@/v2/model"
import { AgentAttachment, FileAttachment, Source, SubtaskAttachment } from "@/v2/session-prompt"
import * as Session from "../session"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Bus } from "@/bus"
import { Plugin } from "@/plugin"
import { Permission } from "@/permission"
import { MCP } from "@/mcp"
import { LSP } from "@/lsp/lsp"
import { ToolRegistry } from "@/tool/registry"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Instruction } from "../instruction"
import { SyncEvent } from "@/sync"
import { NamedError } from "@opencode-ai/core/util/error"
import { decodeDataUrl } from "@/util/data-url"
import { Database, eq } from "@/storage/db"
import { SessionTable } from "../session.sql"
import { PromptInput } from "../prompt"
import { currentModel } from "./model"
import { Tool } from "@/tool/tool"

const log = Log.create({ service: "session.prompt" })
const elog = EffectLogger.create({ service: "session.prompt" })
void elog

export interface CreateUserMessageDeps {
  agents: Agent.Interface
  bus: Bus.Interface
  provider: Provider.Interface
  sync: SyncEvent.Interface
  instruction: Instruction.Interface
  mcp: MCP.Interface
  fsys: AppFileSystem.Interface
  registry: ToolRegistry.Interface
  lsp: LSP.Interface
  plugin: Plugin.Interface
  sessions: Session.Interface
}

export const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(
  function* (deps: CreateUserMessageDeps, input: PromptInput) {
    const agentName = input.agent || (yield* deps.agents.defaultAgent())
    const ag = yield* deps.agents.get(agentName)
    if (!ag) {
      const available = (yield* deps.agents.list()).filter((a) => !a.hidden).map((a) => a.name)
      const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
      const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
      yield* deps.bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
      throw error
    }

    const current = Database.use((db) =>
      db
        .select({ agent: SessionTable.agent, model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, input.sessionID))
        .get(),
    )
    const model = input.model ?? ag.model ?? (yield* currentModel({ sessions: deps.sessions, provider: deps.provider }, input.sessionID))
    const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
    const full =
      !input.variant && ag.variant && same
        ? yield* deps.provider.getModel(model.providerID, model.modelID).pipe(Effect.catchDefect(() => Effect.void))
        : undefined
    const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

    const info: MessageV2.User = {
      id: input.messageID ?? MessageID.ascending(),
      role: "user",
      sessionID: input.sessionID,
      time: { created: Date.now() },
      tools: input.tools,
      agent: ag.name,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
        variant,
      },
      system: input.system,
      format: input.format,
    }

    if (current?.agent !== info.agent) {
      yield* deps.sync.run(SessionEvent.AgentSwitched.Sync, {
        sessionID: input.sessionID,
        timestamp: DateTime.makeUnsafe(info.time.created),
        agent: info.agent,
      })
    }
    if (
      current?.model?.providerID !== info.model.providerID ||
      current.model.id !== info.model.modelID ||
      (current.model.variant === "default" ? undefined : current.model.variant) !== info.model.variant
    ) {
      yield* deps.sync.run(SessionEvent.ModelSwitched.Sync, {
        sessionID: input.sessionID,
        timestamp: DateTime.makeUnsafe(info.time.created),
        model: {
          id: Modelv2.ID.make(info.model.modelID),
          providerID: Modelv2.ProviderID.make(info.model.providerID),
          variant: Modelv2.VariantID.make(info.model.variant ?? "default"),
        },
      })
    }

    yield* Effect.addFinalizer(() => deps.instruction.clear(info.id))

    type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
    const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
      ...part,
      id: part.id ? PartID.make(part.id) : PartID.ascending(),
    })

    const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<MessageV2.Part>[]> = Effect.fn(
      "SessionPrompt.resolveUserPart",
    )(function* (part) {
      if (part.type === "file") {
        if (part.source?.type === "resource") {
          const { clientName, uri } = part.source
          log.info("mcp resource", { clientName, uri, mime: part.mime })
          const pieces: Draft<MessageV2.Part>[] = [
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text: `Reading MCP resource: ${part.filename} (${uri})`,
            },
          ]
          const exit = yield* deps.mcp.readResource(clientName, uri).pipe(Effect.exit)
          if (Exit.isSuccess(exit)) {
            const content = exit.value
            if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
            const items = Array.isArray(content.contents) ? content.contents : [content.contents]
            for (const c of items) {
              if ("text" in c && c.text) {
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: c.text,
                })
              } else if ("blob" in c && c.blob) {
                const mime = "mimeType" in c ? c.mimeType : part.mime
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `[Binary content: ${mime}]`,
                })
              }
            }
            pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
          } else {
            const error = Cause.squash(exit.cause)
            log.error("failed to read MCP resource", { error, clientName, uri })
            const message = error instanceof Error ? error.message : String(error)
            pieces.push({
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text: `Failed to read MCP resource ${part.filename}: ${message}`,
            })
          }
          return pieces
        }
        const url = new URL(part.url)
        switch (url.protocol) {
          case "data:": {
            if (part.mime === "text/plain") {
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                },
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: decodeDataUrl(part.url),
                },
                { ...part, messageID: info.id, sessionID: input.sessionID },
              ]
            }
            break
          }
          case "file:": {
            log.info("file", { mime: part.mime })
            const filepath = fileURLToPath(part.url)
            const mime = (yield* deps.fsys.isDir(filepath)) ? "application/x-directory" : part.mime

            const { read } = yield* deps.registry.named()
            const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
              const controller = new AbortController()
              return read
                .execute(args, {
                  sessionID: input.sessionID,
                  abort: controller.signal,
                  agent: input.agent!,
                  messageID: info.id,
                  extra: { bypassCwdCheck: true, ...extra },
                  messages: [],
                  metadata: () => Effect.void,
                  ask: () => Effect.void,
                })
                .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
            }

            if (mime === "text/plain") {
              let offset: number | undefined
              let limit: number | undefined
              const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
              if (range.start != null) {
                const filePathURI = part.url.split("?")[0]
                let start = parseInt(range.start)
                let end = range.end ? parseInt(range.end) : undefined
                if (start === end) {
                  const symbols = yield* deps.lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                  for (const symbol of symbols) {
                    let r: LSP.Range | undefined
                    if ("range" in symbol) r = symbol.range
                    else if ("location" in symbol) r = symbol.location.range
                    if (r?.start?.line && r?.start?.line === start) {
                      start = r.start.line
                      end = r?.end?.line ?? start
                      break
                    }
                  }
                }
                offset = Math.max(start, 1)
                if (end) limit = end - (offset - 1)
              }
              const args = { filePath: filepath, offset, limit }
              const pieces: Draft<MessageV2.Part>[] = [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                },
              ]
              const exit = yield* deps.provider.getModel(info.model.providerID, info.model.modelID).pipe(
                Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                Effect.exit,
              )
              if (Exit.isSuccess(exit)) {
                const result = exit.value
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: result.output,
                })
                if (result.attachments?.length) {
                  pieces.push(
                    ...result.attachments.map((a) => ({
                      ...a,
                      synthetic: true,
                      filename: a.filename ?? part.filename,
                      messageID: info.id,
                      sessionID: input.sessionID,
                    })),
                  )
                } else {
                  pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                }
              } else {
                const error = Cause.squash(exit.cause)
                log.error("failed to read file", { error })
                const message = error instanceof Error ? error.message : String(error)
                yield* deps.bus.publish(Session.Event.Error, {
                  sessionID: input.sessionID,
                  error: new NamedError.Unknown({ message }).toObject(),
                })
                pieces.push({
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                })
              }
              return pieces
            }

            if (mime === "application/x-directory") {
              const args = { filePath: filepath }
              const exit = yield* execRead(args).pipe(Effect.exit)
              if (Exit.isFailure(exit)) {
                const error = Cause.squash(exit.cause)
                log.error("failed to read directory", { error })
                const message = error instanceof Error ? error.message : String(error)
                yield* deps.bus.publish(Session.Event.Error, {
                  sessionID: input.sessionID,
                  error: new NamedError.Unknown({ message }).toObject(),
                })
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  },
                ]
              }
              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                },
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: exit.value.output,
                },
                { ...part, mime, messageID: info.id, sessionID: input.sessionID },
              ]
            }

            return [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
              },
              {
                id: part.id,
                messageID: info.id,
                sessionID: input.sessionID,
                type: "file",
                url:
                  `data:${mime};base64,` +
                  Buffer.from(yield* deps.fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                mime,
                filename: part.filename!,
                source: part.source,
              },
            ]
          }
        }
      }

      if (part.type === "agent") {
        const perm = Permission.evaluate("task", part.name, ag.permission)
        const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
        return [
          { ...part, messageID: info.id, sessionID: input.sessionID },
          {
            messageID: info.id,
            sessionID: input.sessionID,
            type: "text",
            synthetic: true,
            text:
              " Use the above message and context to generate a prompt and call the task tool with subagent: " +
              part.name +
              hint,
          },
        ]
      }

      return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
    })

    const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
      Effect.map((x) => x.flat().map(assign)),
    )

    yield* deps.plugin.trigger(
      "chat.message",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        messageID: input.messageID,
        variant: input.variant,
      },
      { message: info, parts: resolvedParts },
    )

    const parts = resolvedParts

    const parsed = MessageV2.Info.zod.safeParse(info)
    if (!parsed.success) {
      log.error("invalid user message before save", {
        sessionID: input.sessionID,
        messageID: info.id,
        agent: info.agent,
        model: info.model,
        issues: parsed.error.issues,
      })
    }
    parts.forEach((part, index) => {
      const p = MessageV2.Part.zod.safeParse(part)
      if (p.success) return
      log.error("invalid user part before save", {
        sessionID: input.sessionID,
        messageID: info.id,
        partID: part.id,
        partType: part.type,
        index,
        issues: p.error.issues,
        part,
      })
    })

    yield* deps.sessions.updateMessage(info)
    yield* deps.sessions.updateParts(parts)
    const nextPrompt = parts.reduce(
      (result, part) => {
        if (part.type === "text") {
          if (part.synthetic) result.synthetic.push(part.text)
          else result.text.push(part.text)
        }
        if (part.type === "file") {
          result.files.push(
            new FileAttachment({
              uri: part.url,
              mime: part.mime,
              name: part.filename,
              source: part.source
                ? new Source({
                    start: part.source.text.start,
                    end: part.source.text.end,
                    text: part.source.text.value,
                  })
                : undefined,
            }),
          )
        }
        if (part.type === "agent") {
          result.agents.push(
            new AgentAttachment({
              name: part.name,
              source: part.source
                ? new Source({
                    start: part.source.start,
                    end: part.source.end,
                    text: part.source.value,
                  })
                : undefined,
            }),
          )
        }
        if (part.type === "subtask") {
          result.subtask = new SubtaskAttachment({
            agent: part.agent,
            description: part.description,
            prompt: part.prompt,
            model: part.model
              ? { providerID: part.model.providerID, modelID: part.model.modelID }
              : undefined,
            command: part.command,
          })
        }
        return result
      },
      {
        text: [] as string[],
        files: [] as FileAttachment[],
        agents: [] as AgentAttachment[],
        subtask: undefined as SubtaskAttachment | undefined,
        synthetic: [] as string[],
      },
    )
    // V2 read-model projection: emit the SessionEvent so the V2 projectors
    // (session/projectors-next.ts) populate SessionMessageTable for V2 reads.
    yield* deps.sync.run(SessionEvent.Prompted.Sync, {
      sessionID: input.sessionID,
      timestamp: DateTime.makeUnsafe(info.time.created),
      prompt: {
        text: nextPrompt.text.join("\n"),
        files: nextPrompt.files,
        agents: nextPrompt.agents,
        subtask: nextPrompt.subtask,
      },
    })
    for (const text of nextPrompt.synthetic) {
      // V2 read-model projection: emit the SessionEvent so the V2 projectors
      // (session/projectors-next.ts) populate SessionMessageTable for V2 reads.
      yield* deps.sync.run(SessionEvent.Synthetic.Sync, {
        sessionID: input.sessionID,
        timestamp: DateTime.makeUnsafe(info.time.created),
        text,
      })
    }

    return { info, parts }
  },
  Effect.scoped,
)
