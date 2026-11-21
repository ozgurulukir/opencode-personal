import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import * as Session from "./session"
import { SessionID, MessageID, PartID } from "./schema"
import { Provider } from "@/provider/provider"
import { MessageV2 } from "./message-v2"
import { Token } from "@/util/token"
import * as Log from "@opencode-ai/core/util/log"
import { SessionProcessor } from "./processor"
import { Agent } from "@/agent/agent"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { NotFoundError } from "@/storage/storage"
import { ModelID, ProviderID } from "@/provider/schema"
import { Effect, Layer, Context, Schema, Option } from "effect"
import * as DateTime from "effect/DateTime"
import { InstanceState } from "@/effect/instance-state"
import * as ContextBudget from "@opencode-ai/sdk/v2/context-budget"
import * as Todo from "./todo"
import { serviceUse } from "@/effect/service-use"
import { SyncEvent } from "@/sync"
import { SessionEvent } from "@/v2/session-event"
import * as CompactionTrigger from "./compaction-trigger"
import * as CompactionShared from "./compaction.shared"

const log = Log.create({ service: "session.compaction" })

export const Event = {
  Compacted: BusEvent.define(
    "session.compacted",
    Schema.Struct({
      sessionID: SessionID,
    }),
  ),
}

const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Goal
- [task summary — one bullet per goal if multiple]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work — cite tool calls as tool(key_arg), e.g. read(src/auth.ts), bash(npm test), or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers — include exact error strings when known, or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, open questions, unresolved errors, or "(none)"]

## Relevant Files
- [path — role: read | written | created | deleted, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers.
- For tool calls, use tool_name(key_arg) shorthand (e.g., read(src/auth.ts), bash(npm test)).
- In Relevant Files, annotate each path with its role: read, written, created, or deleted.
- Condense older completed work; expand on recent decisions and unresolved items.
- Keep the summary concise but complete.
- Do not mention the summary process or that context was compacted.`
type CompletedCompaction = {
  userIndex: number
  assistantIndex: number
  summary: string | undefined
}

function summaryText(message: MessageV2.WithParts) {
  const text = message.parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim()
  return text || undefined
}

/**
 * Formats the synthetic auto-continue text appended after an (auto-)compaction:
 * an optional overflow explanation, the continue instruction, and a pending-todos
 * block. Pure — the caller resolves the todo list and media presence.
 */
export function autoContinueText(input: { overflow: boolean; hasMedia: boolean; todos?: Todo.Info[] }): string {
  const pending = (input.todos ?? []).filter((t) => t.status !== "completed" && t.status !== "cancelled")
  const todoBlock =
    pending.length === 0
      ? ""
      : "\n\nPending todos:\n" +
        pending
          .map((t) => {
            const badge = t.priority === "high" ? "[H] " : t.priority === "low" ? "[L] " : "[M] "
            const statusBadge = t.status === "in_progress" ? "[IN PROGRESS] " : ""
            return `- ${badge}${statusBadge}${t.content}`
          })
          .join("\n")
  const overflowBlock = input.overflow
    ? input.hasMedia
      ? "The previous request exceeded the provider's size limit due to large media attachments. The conversation was compacted and media files were removed from context. If the user was asking about attached images or files, explain that the attachments were too large to process and suggest they try again with smaller or fewer files.\n\n"
      : "The previous request exceeded the provider's size limit. The conversation was compacted to fit within context limits.\n\n"
    : ""
  return overflowBlock + "Continue if you have next steps, or stop and ask for clarification if you are unsure how to proceed." + todoBlock
}

function completedCompactions(messages: MessageV2.WithParts[]) {
  const users = new Map<MessageID, number>()
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info.role !== "user") continue
    if (!msg.parts.some((part) => part.type === "compaction")) continue
    users.set(msg.info.id, i)
  }

  return messages.flatMap((msg, assistantIndex): CompletedCompaction[] => {
    if (msg.info.role !== "assistant") return []
    if (!msg.info.summary || !msg.info.finish || msg.info.error) return []
    const userIndex = users.get(msg.info.parentID)
    if (userIndex === undefined) return []
    return [{ userIndex, assistantIndex, summary: summaryText(msg) }]
  })
}

function buildPrompt(input: { previousSummary?: string; context: string[]; maxTokens?: number }) {
  const anchor = input.previousSummary
    ? [
        "Update the anchored summary below using the conversation history above.",
        "Preserve still-true details, remove stale details, and merge in the new facts.",
        "<previous-summary>",
        input.previousSummary,
        "</previous-summary>",
      ].join("\n")
    : "Create a new anchored summary from the conversation history above."
  const budget = input.maxTokens ? `\nTarget length: under ${input.maxTokens} tokens.` : ""
  return [anchor, SUMMARY_TEMPLATE + budget, ...input.context].join("\n\n")
}

export function isRealUserTurn(msg: MessageV2.WithParts): msg is MessageV2.WithParts & { info: MessageV2.User } {
  if (msg.info.role !== "user") return false
  if (msg.parts.some((part) => part.type === "compaction")) return false
  if (msg.parts.some(CompactionTrigger.isCompactionContinuePart)) return false
  return true
}

export interface Interface {
  readonly prune: (input: { sessionID: SessionID }) => Effect.Effect<number>
  readonly process: (input: {
    parentID: MessageID
    messages: MessageV2.WithParts[]
    sessionID: SessionID
    auto: boolean
    overflow?: boolean
  }) => Effect.Effect<"continue" | "stop">
  readonly create: (input: {
    sessionID: SessionID
    agent: string
    model: { providerID: ProviderID; modelID: ModelID }
    auto: boolean
    overflow?: boolean
    format?: MessageV2.User["format"]
    tools?: MessageV2.User["tools"]
    system?: MessageV2.User["system"]
  }) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionCompaction") {}

export const use = serviceUse(Service)

export const layer: Layer.Layer<
  Service,
  never,
  | Bus.Service
  | Config.Service
  | Session.Service
  | Agent.Service
  | Plugin.Service
  | SessionProcessor.Service
  | Provider.Service
  | SyncEvent.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const config = yield* Config.Service
    const session = yield* Session.Service
    const agents = yield* Agent.Service
    const plugin = yield* Plugin.Service
    const processors = yield* SessionProcessor.Service
    const provider = yield* Provider.Service
    const sync = yield* SyncEvent.Service
    const todo = yield* Effect.serviceOption(Todo.Service)

    const estimate = Effect.fn("SessionCompaction.estimate")(function* (input: {
      messages: MessageV2.WithParts[]
      model: Provider.Model
    }) {
      const cfg = yield* config.get()
      const cc = ContextBudget.compactionConfig(cfg)
      const msgs = yield* MessageV2.toModelMessagesEffect(input.messages, input.model, {
        stripMedia: true,
        toolOutputMaxChars: cc.toolOutputMaxChars,
      })
      return Token.estimate(JSON.stringify(msgs))
    })

    const select = Effect.fn("SessionCompaction.select")(function* (input: {
      messages: MessageV2.WithParts[]
      cfg: Config.Info
      model: Provider.Model
    }) {
      const cc = ContextBudget.compactionConfig(input.cfg)
      const budget = ContextBudget.preserveRecentBudget({ cfg: input.cfg, model: input.model })
      const plan = yield* CompactionShared.planTail({
        messages: input.messages,
        tailTurns: cc.tailTurns,
        budget,
        estimate: (messages) => estimate({ messages, model: input.model }),
      })
      if (plan.fallback) log.info("tail fallback", { budget })
      return {
        head: plan.head,
        tail_start_id: plan.tail_start_id,
        fallback: plan.fallback,
      }
    })

    // goes backwards through parts until there are cc.pruneProtectTokens worth of tool
    // calls, then erases output of older tool calls to free context space
    const prune = Effect.fn("SessionCompaction.prune")(function* (input: { sessionID: SessionID }) {
      const cfg = yield* config.get()
      const cc = ContextBudget.compactionConfig(cfg)
      if (!cc.prune) return 0
      log.info("pruning")

      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs) return 0

      let total = 0
      let pruned = 0
      const toPrune: MessageV2.ToolPart[] = []
      let userTurns = 0

      messages: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (isRealUserTurn(msg)) userTurns++
        if (userTurns < cc.tailTurns) continue
        if (msg.info.role === "assistant" && msg.info.summary) break messages
        for (let partIndex = msg.parts.length - 1; partIndex >= 0; partIndex--) {
          const part = msg.parts[partIndex]
          if (part.type !== "tool") continue
          if (part.state.status !== "completed") continue
          if (cc.pruneProtectedTools.includes(part.tool)) continue
          // Skip already-compacted parts; previous passes already cleared them
          if (part.state.time.compacted) continue
          let estimate = Token.estimate(part.state.output)
          if (part.state.attachments?.length) {
            for (const att of part.state.attachments) {
              estimate += Token.estimate(att.url ?? "")
            }
          }
          total += estimate
          if (total <= cc.pruneProtectTokens) continue
          pruned += estimate
          toPrune.push(part)
        }
      }

      log.info("found", { pruned, total })
      if (pruned > cc.pruneMinimumTokens) {
        const now = Date.now()
        const updated: MessageV2.ToolPart[] = []
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = now
            updated.push(part)
          }
        }
        if (updated.length > 0) {
          yield* session.updateParts(updated)
        }
        log.info("pruned", { count: toPrune.length, tokens: pruned })
        return pruned
      }
      return 0
    })

    const processCompaction = Effect.fn("SessionCompaction.process")(function* (input: {
      parentID: MessageID
      messages: MessageV2.WithParts[]
      sessionID: SessionID
      auto: boolean
      overflow?: boolean
    }) {
      let ended = false
      const emitEnded = (text: string, include?: MessageID, status?: "ok" | "failed", error?: string) =>
        Effect.gen(function* () {
          if (ended) return
          ended = true
          yield* sync.run(SessionEvent.Compaction.Ended.Sync, {
            sessionID: input.sessionID,
            timestamp: DateTime.makeUnsafe(Date.now()),
            text,
            include,
            status,
            error,
          })
        })

      let parent: MessageV2.WithParts | undefined
      let assistantMsg: MessageV2.Assistant | undefined
      let resolvedModel: Provider.Model | undefined

      const handleError = (err: unknown) =>
        Effect.gen(function* () {
          log.error("compaction failed", { err })
          if (parent && parent.info.role === "user") {
            const ctx = yield* InstanceState.context.pipe(
              Effect.catch(() =>
                Effect.succeed({ directory: "", worktree: "" } as { directory: string; worktree: string }),
              ),
              Effect.catchDefect(() =>
                Effect.succeed({ directory: "", worktree: "" } as { directory: string; worktree: string }),
              ),
            )
            const failMsg: MessageV2.Assistant = assistantMsg ?? {
              id: MessageID.ascending(),
              role: "assistant",
              parentID: input.parentID,
              sessionID: input.sessionID,
              mode: "compaction",
              agent: "compaction",
              variant: undefined,
              summary: true,
              path: {
                cwd: ctx.directory,
                root: ctx.worktree,
              },
              cost: 0,
              tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: (resolvedModel?.id ?? "unknown") as ModelID,
              providerID: (resolvedModel?.providerID ?? "unknown") as ProviderID,
              time: { created: Date.now() },
            }
            failMsg.finish = "error"
            failMsg.error = {
              name: "UnknownError",
              data: {
                message: err instanceof Error ? err.message : String(err),
              },
            }
            yield* session.updateMessage(failMsg).pipe(
              Effect.catch(() => Effect.void),
              Effect.catchDefect(() => Effect.void),
            )
          }
          yield* emitEnded("", undefined, "failed", err instanceof Error ? err.message : String(err))
          return yield* Effect.die(err)
        })

      const body = Effect.gen(function* () {
        parent = input.messages.findLast((m) => m.info.id === input.parentID)
        if (!parent || parent.info.role !== "user") {
          throw new Error(`Compaction parent must be a user message: ${input.parentID}`)
        }
        const userMessage = parent.info
        const compactionPart = parent.parts.find((part): part is MessageV2.CompactionPart => part.type === "compaction")

        let messages = input.messages
        let replay:
          | {
              info: MessageV2.User
              parts: MessageV2.Part[]
            }
          | undefined
        if (input.overflow) {
          // Find the most recent non-compaction user turn before the compaction
          // parent. That turn's content (with media stripped) will be replayed
          // after compaction so the model can continue from where it left off.
          const idx = input.messages.findIndex((m) => m.info.id === input.parentID)
          for (let i = idx - 1; i >= 0; i--) {
            const msg = input.messages[i]
            if (msg.info.role === "user" && !msg.parts.some((p) => p.type === "compaction")) {
              replay = { info: msg.info, parts: msg.parts }
              messages = input.messages.slice(0, i)
              break
            }
          }
          // If slicing removed all non-compaction user content, there's nothing
          // meaningful to replay — fall back to the full message set.
          const hasContent =
            replay && messages.some((m) => m.info.role === "user" && !m.parts.some((p) => p.type === "compaction"))
          if (!hasContent) {
            replay = undefined
            messages = input.messages
          }
        }

        const agent = yield* agents.get("compaction")
        if (!agent) return yield* Effect.die(new Error("compaction agent not found"))
        const model = agent.model
          ? yield* provider.getModel(agent.model.providerID, agent.model.modelID)
          : yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID)
        resolvedModel = model
        const cfg = yield* config.get()
        // Exclude the current compaction marker from history so completedCompactions
        // doesn't count it as a prior compaction. The marker is the last message
        // when no post-compaction messages exist yet; after filterCompacted reorder
        // it may not be last, but that's safe because the current compaction hasn't
        // produced a summary yet so it won't match completedCompactions' criteria.
        const history = compactionPart && messages.at(-1)?.info.id === input.parentID ? messages.slice(0, -1) : messages
        const prior = completedCompactions(history)
        const hidden = new Set(prior.flatMap((item) => [item.userIndex, item.assistantIndex]))
        const previousSummary = prior.at(-1)?.summary
        const selected = yield* select({
          messages: history.filter((_, index) => !hidden.has(index)),
          cfg,
          model,
        })
        if (input.auto && selected.fallback && !replay) {
          const lastReal = input.messages.findLast(isRealUserTurn)
          if (lastReal) {
            replay = { info: lastReal.info, parts: lastReal.parts }
          }
        }
        log.info("compaction selected", {
          tail_start_id: selected.tail_start_id,
          budget: ContextBudget.preserveRecentBudget({ cfg, model }),
          overflow: input.overflow === true,
        })
        // Allow plugins to inject context or replace compaction prompt.
        const compacting = yield* plugin.trigger(
          "experimental.session.compacting",
          { sessionID: input.sessionID, previousSummary },
          { context: [], prompt: undefined },
        )
        const cc = ContextBudget.compactionConfig(cfg)
        const maxSummaryTokens = ContextBudget.summaryBudget(model, cc)
        const nextPrompt =
          compacting.prompt ??
          buildPrompt({
            previousSummary,
            context: compacting.context,
            maxTokens: maxSummaryTokens,
          })
        const summarizerCapacity = Math.max(1000, ContextBudget.usable(cfg, model) - maxSummaryTokens)
        const msgs = structuredClone(selected.head)
        yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
        const estimateHead = (head: MessageV2.WithParts[], toolOutputMaxChars: number) =>
          Effect.map(
            MessageV2.toModelMessagesEffect(head, model, { stripMedia: true, toolOutputMaxChars }),
            (modelMessages) => Token.estimate(JSON.stringify(modelMessages)),
          )
        const headPlan = yield* CompactionShared.planHead({
          head: msgs,
          promptTokens: Token.estimate(nextPrompt),
          summarizerCapacity,
          toolOutputMaxChars: cc.toolOutputMaxChars,
          estimate: estimateHead,
        })
        if (headPlan.dropped > 0) {
          log.info("compaction head truncated for summarizer", {
            dropped: headPlan.dropped,
            headTokens: headPlan.headTokens,
            summarizerCapacity,
          })
        }
        const modelMessages = yield* MessageV2.toModelMessagesEffect(headPlan.head, model, {
          stripMedia: true,
          toolOutputMaxChars: headPlan.toolOutputMaxChars,
        })

        const ctx = yield* InstanceState.context
        const msg: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          parentID: input.parentID,
          sessionID: input.sessionID,
          mode: "compaction",
          agent: "compaction",
          variant: userMessage.model.variant,
          summary: true,
          path: {
            cwd: ctx.directory,
            root: ctx.worktree,
          },
          cost: 0,
          tokens: {
            output: 0,
            input: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: model.id,
          providerID: model.providerID,
          time: {
            created: Date.now(),
          },
        }
        assistantMsg = msg
        yield* session.updateMessage(msg)
        const processor = yield* processors.create({
          assistantMessage: msg,
          sessionID: input.sessionID,
          model,
        })
        const result = yield* processor.process({
          user: userMessage,
          agent,
          sessionID: input.sessionID,
          tools: {},
          system: { prefix: "", suffix: "" },
          maxOutputTokens: maxSummaryTokens,
          messages: [
            ...modelMessages,
            {
              role: "user",
              content: [{ type: "text", text: nextPrompt }],
            },
          ],
          model,
        })

        if (result === "compact") {
          processor.message.error = new MessageV2.ContextOverflowError({
            message: replay
              ? "Conversation history too large to compact - exceeds model context limit"
              : "Session too large to compact - context exceeds model limit even after stripping media",
          }).toObject()
          processor.message.finish = "error"
          yield* session.updateMessage(processor.message)
          yield* emitEnded("", undefined, "failed", processor.message.error?.name ?? "ContextOverflowError")
          return "stop" as const
        }

        if (compactionPart && selected.tail_start_id && compactionPart.tail_start_id !== selected.tail_start_id) {
          yield* session.updatePart({
            ...compactionPart,
            tail_start_id: selected.tail_start_id,
          })
        }

        if (result === "continue" && input.auto) {
          if (replay && replay.parts.some((p) => p.type !== "compaction")) {
            const original = replay.info
            const replayMsg = yield* session.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: input.sessionID,
              time: { created: Date.now() },
              agent: original.agent,
              model: original.model,
              format: original.format,
              tools: original.tools,
              system: original.system,
            })
            const replayParts: MessageV2.Part[] = []
            for (const part of replay.parts) {
              if (part.type === "compaction") continue
              const replayPart =
                part.type === "file" && MessageV2.isMedia(part.mime)
                  ? { type: "text" as const, text: `[Attached ${part.mime}: ${part.filename ?? "file"}]` }
                  : part
              replayParts.push({
                ...replayPart,
                id: PartID.ascending(),
                messageID: replayMsg.id,
                sessionID: input.sessionID,
              })
            }
            if (replayParts.length > 0) yield* session.updateParts(replayParts)
          }

          if (!replay && input.auto) {
            const info = yield* provider.getProvider(userMessage.model.providerID)
            if (
              cc.autocontinue &&
              (yield* plugin.trigger(
                "experimental.compaction.autocontinue",
                {
                  sessionID: input.sessionID,
                  agent: userMessage.agent,
                  model: yield* provider.getModel(userMessage.model.providerID, userMessage.model.modelID),
                  provider: {
                    source: info.source,
                    info,
                    options: info.options,
                  },
                  message: userMessage,
                  overflow: input.overflow === true,
                },
                { enabled: true },
              )).enabled
            ) {
              const continueMsg = yield* session.updateMessage({
                id: MessageID.ascending(),
                role: "user",
                sessionID: input.sessionID,
                time: { created: Date.now() },
                agent: userMessage.agent,
                model: userMessage.model,
                format: userMessage.format,
                tools: userMessage.tools,
                system: userMessage.system,
              })
              const todos = yield* Option.match(todo, {
                onNone: () => Effect.succeed([] as Todo.Info[]),
                onSome: (svc) => svc.get(input.sessionID),
              })
              const hasMedia = input.messages.some((m) =>
                m.parts.some((p) => p.type === "file" && MessageV2.isMedia(p.mime)),
              )
              const text = autoContinueText({
                overflow: input.overflow === true,
                hasMedia,
                todos,
              })
              yield* session.updatePart({
                id: PartID.ascending(),
                messageID: continueMsg.id,
                sessionID: input.sessionID,
                type: "text",
                // Internal marker for auto-compaction followups so provider plugins
                // can distinguish them from manual post-compaction user prompts.
                // This is not a stable plugin contract and may change or disappear.
                metadata: CompactionTrigger.COMPACTION_CONTINUE_METADATA,
                synthetic: true,
                text,
                time: {
                  start: Date.now(),
                  end: Date.now(),
                },
              })
            }
          }
        }

        if (processor.message.error) {
          processor.message.finish = "error"
          yield* session.updateMessage(processor.message)
          yield* emitEnded("", undefined, "failed", processor.message.error.name ?? "CompactionFailed")
          return "stop" as const
        }
        if (result === "continue") {
          const summary = summaryText(
            (yield* session.messages({ sessionID: input.sessionID })).find((item) => item.info.id === msg.id) ?? {
              info: msg,
              parts: [],
            },
          )
          yield* emitEnded(summary ?? "", selected.tail_start_id, "ok")
          yield* bus.publish(Event.Compacted, { sessionID: input.sessionID })
        }
        log.info("compaction finished", { result, overflow: input.overflow === true })
        return result
      })

      return yield* body.pipe(
        Effect.catch(handleError),
        Effect.catchDefect(handleError),
        Effect.ensuring(emitEnded("", undefined, "failed")),
      )
    })

    const create = Effect.fn("SessionCompaction.create")(function* (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderID; modelID: ModelID }
      auto: boolean
      overflow?: boolean
      format?: MessageV2.User["format"]
      tools?: MessageV2.User["tools"]
      system?: MessageV2.User["system"]
    }) {
      const msg = yield* session.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        model: input.model,
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: Date.now() },
        format: input.format,
        tools: input.tools,
        system: input.system,
      })
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: msg.sessionID,
        type: "compaction",
        auto: input.auto,
        overflow: input.overflow,
      })
      yield* sync.run(SessionEvent.Compaction.Started.Sync, {
        sessionID: input.sessionID,
        timestamp: DateTime.makeUnsafe(Date.now()),
        reason: input.auto ? "auto" : "manual",
      })
    })

    return Service.of({
      prune,
      process: processCompaction,
      create,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(SyncEvent.defaultLayer),
  ),
)

export * as SessionCompaction from "./compaction"
