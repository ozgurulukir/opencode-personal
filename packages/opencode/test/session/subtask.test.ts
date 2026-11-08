import { afterEach, describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SearchService } from "@/search/search"
import { EmbeddingService } from "@/search/embedding"
import { handleSubtask } from "../../src/session/loop/subtask"
import { MessageV2 } from "../../src/session/message-v2"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Session } from "@/session/session"
import { SessionStatus } from "../../src/session/status"
import { Todo } from "../../src/session/todo"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionRevert } from "../../src/session/revert"
import { SyncEvent } from "@/sync"
import { ToolRegistry } from "@/tool/registry"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { SessionV2 } from "../../src/v2/session"
import { SessionEvent } from "../../src/v2/session-event"
import { FALLBACK_DENY } from "../../src/agent/subagent-permissions"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const dummyModel: Provider.Model = {
  id: ModelID.make("test-model"),
  providerID: ProviderID.make("test"),
  name: "Test Model",
  api: {
    id: "test-model",
    url: "http://localhost:1/v1",
    npm: "@ai-sdk/openai-compatible",
  },
  status: "active",
  capabilities: {
    temperature: false,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: { text: true, audio: false, image: false, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  limit: { context: 100000, output: 10000 },
  options: {},
  headers: {},
  release_date: "2025-01-01",
}

function makeSubtaskLayer() {
  const infra = Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Provider.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
    SessionStatus.defaultLayer,
    Bus.layer,
    SyncEvent.defaultLayer,
    Todo.defaultLayer,
    Layer.succeed(SessionCompaction.Service, {
      create: () => Effect.void,
      process: () => Effect.succeed("stop" as const),
      prune: () => Effect.succeed(0),
    }),
    Layer.succeed(SessionRevert.Service, {
      revert: () => Effect.die("unused"),
      unrevert: () => Effect.die("unused"),
      cleanup: () => Effect.void,
    }),
    Layer.succeed(SearchService, {
      open: Effect.void,
      index: () => Effect.void,
      search: () => Effect.succeed([]),
      reset: Effect.void,
      delete: () => Effect.void,
    }),
    Layer.succeed(EmbeddingService, {
      embed: () => Effect.succeed([]),
      resolve: Effect.void,
      dimension: 384,
    }),
  )
  const v2 = SessionV2.layer.pipe(Layer.provide(infra))
  return Layer.mergeAll(infra, v2)
}

const it = testEffect(makeSubtaskLayer())

function stubOps(opts?: {
  text?: string
  fail?: Error
  delayMs?: number
  onPrompt?: (input: SessionPrompt.PromptInput) => void
}): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.gen(function* () {
        opts?.onPrompt?.(input)
        if (opts?.delayMs) yield* Effect.sleep(`${opts.delayMs} millis`)
        if (opts?.fail) return yield* Effect.die(opts.fail)
        const id = MessageID.ascending()
        return {
          info: {
            id,
            role: "assistant" as const,
            parentID: input.messageID ?? MessageID.ascending(),
            sessionID: input.sessionID,
            mode: input.agent ?? "general",
            agent: input.agent ?? "general",
            cost: 0,
            path: { cwd: "/tmp", root: "/tmp" },
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: input.model?.modelID ?? ref.modelID,
            providerID: input.model?.providerID ?? ref.providerID,
            time: { created: Date.now() },
            finish: "stop" as const,
          },
          parts: [
            {
              id: PartID.ascending(),
              messageID: id,
              sessionID: input.sessionID,
              type: "text" as const,
              text: opts?.text ?? "subtask completed output",
            },
          ],
        } satisfies MessageV2.WithParts
      }),
  }
}

describe("session.loop.subtask", () => {
  it.instance("projects full V2 SessionEvent lifecycle and Synthetic summary on command subtask completion", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const v2 = yield* SessionV2.Service
      const registry = yield* ToolRegistry.Service
      const plugin = yield* Plugin.Service
      const agents = yield* Agent.Service
      const bus = yield* Bus.Service
      const permission = yield* Permission.Service
      const provider = yield* Provider.Service
      const sync = yield* SyncEvent.Service

      const parent = yield* sessions.create({ title: "Subtask Parent", agent: "build" })
      const lastUser: MessageV2.User = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: parent.id,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      })
      const task: MessageV2.SubtaskPart = {
        id: PartID.ascending(),
        messageID: lastUser.id,
        sessionID: parent.id,
        type: "subtask",
        prompt: "inspect the auth flow",
        description: "auth inspection",
        agent: "general",
        command: "review",
      }

      const hookCalls: Array<{ hook: string; callID: string }> = []
      const trackedPlugin: Plugin.Interface = {
        ...plugin,
        trigger: ((name: string, input: any, output: any) => {
          if (name === "tool.execute.before" || name === "tool.execute.after") {
            hookCalls.push({ hook: name, callID: input.callID })
          }
          return plugin.trigger(name as any, input, output)
        }) as Plugin.Interface["trigger"],
      }

      yield* handleSubtask(
        {
          ops: () => Effect.succeed(stubOps({ text: "auth flow looks clean" })),
          registry,
          sessions,
          plugin: trackedPlugin,
          agents,
          bus,
          permission,
          provider,
          sync,
        },
        {
          task,
          model: dummyModel,
          lastUser,
          sessionID: parent.id,
          session: parent,
          msgs: [{ info: lastUser, parts: [task] }],
        },
      )

      // 1. V2 SessionMessageTable must contain the projected assistant message with a completed task tool item
      const v2Messages = yield* v2.messages({ sessionID: parent.id, order: "asc" })
      const assistantMsg = v2Messages.find((m) => m.type === "assistant")
      expect(assistantMsg).toBeDefined()
      if (assistantMsg?.type === "assistant") {
        expect(assistantMsg.finish).toBe("tool-calls")
        expect(assistantMsg.time.completed).toBeDefined()
        const toolItem = assistantMsg.content.find((c) => c.type === "tool")
        expect(toolItem).toBeDefined()
        if (toolItem?.type === "tool") {
          expect(toolItem.name).toBe(TaskTool.id)
          expect(toolItem.state.status).toBe("completed")
          if (toolItem.state.status === "completed") {
            expect(toolItem.state.input).toMatchObject({
              prompt: "inspect the auth flow",
              description: "auth inspection",
              subagent_type: "general",
              command: "review",
            })
            expect(toolItem.state.structured).toHaveProperty("sessionId")
            expect(toolItem.state.content).toContainEqual(
              expect.objectContaining({
                type: "text",
                text: expect.stringContaining("auth flow looks clean"),
              }),
            )
          }
          // 2. Plugin hooks must receive part.callID (matching toolItem.id), not part.id
          expect(hookCalls).toEqual([
            { hook: "tool.execute.before", callID: toolItem.id },
            { hook: "tool.execute.after", callID: toolItem.id },
          ])
        }
      }

      // 3. Command subtask appends a synthetic summary prompt that is also projected into V2
      const syntheticMsg = v2Messages.find((m) => m.type === "synthetic")
      expect(syntheticMsg).toBeDefined()
      if (syntheticMsg?.type === "synthetic") {
        expect(syntheticMsg.text).toBe("Summarize the task tool output above and continue with your task.")
      }
    }),
  )

  it.instance("projects V2 Tool.Failed and Step.Ended when subtask execution fails", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const v2 = yield* SessionV2.Service
      const registry = yield* ToolRegistry.Service
      const plugin = yield* Plugin.Service
      const agents = yield* Agent.Service
      const bus = yield* Bus.Service
      const permission = yield* Permission.Service
      const provider = yield* Provider.Service
      const sync = yield* SyncEvent.Service

      const parent = yield* sessions.create({ title: "Subtask Error Parent", agent: "build" })
      const lastUser: MessageV2.User = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: parent.id,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      })
      const task: MessageV2.SubtaskPart = {
        id: PartID.ascending(),
        messageID: lastUser.id,
        sessionID: parent.id,
        type: "subtask",
        prompt: "fail this subtask",
        description: "failing subtask",
        agent: "general",
      }

      yield* handleSubtask(
        {
          ops: () => Effect.succeed(stubOps({ fail: new Error("boom in child") })),
          registry,
          sessions,
          plugin,
          agents,
          bus,
          permission,
          provider,
          sync,
        },
        {
          task,
          model: dummyModel,
          lastUser,
          sessionID: parent.id,
          session: parent,
          msgs: [{ info: lastUser, parts: [task] }],
        },
      )

      const v2Messages = yield* v2.messages({ sessionID: parent.id, order: "asc" })
      const assistantMsg = v2Messages.find((m) => m.type === "assistant")
      expect(assistantMsg).toBeDefined()
      if (assistantMsg?.type === "assistant") {
        expect(assistantMsg.finish).toBe("tool-calls")
        const toolItem = assistantMsg.content.find((c) => c.type === "tool")
        expect(toolItem).toBeDefined()
        if (toolItem?.type === "tool") {
          expect(toolItem.state.status).toBe("error")
          if (toolItem.state.status === "error") {
            expect(toolItem.state.error.message).toContain("boom in child")
          }
        }
      }
    }),
  )

  it.instance("applies resolveParentAgent fallback deny rules when lastUser.agent is missing", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const registry = yield* ToolRegistry.Service
      const plugin = yield* Plugin.Service
      const agents = yield* Agent.Service
      const bus = yield* Bus.Service
      const permission = yield* Permission.Service
      const provider = yield* Provider.Service
      const sync = yield* SyncEvent.Service

      const parent = yield* sessions.create({ title: "Subtask Missing Parent Agent", agent: "deleted-agent" })
      const lastUser: MessageV2.User = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: parent.id,
        agent: "deleted-agent",
        model: ref,
        time: { created: Date.now() },
      })
      const task: MessageV2.SubtaskPart = {
        id: PartID.ascending(),
        messageID: lastUser.id,
        sessionID: parent.id,
        type: "subtask",
        prompt: "check fallback rules",
        description: "fallback check",
        agent: "general",
      }

      let childSessionID: SessionID | undefined
      yield* handleSubtask(
        {
          ops: () =>
            Effect.succeed(
              stubOps({
                onPrompt: (input) => {
                  childSessionID = input.sessionID
                },
              }),
            ),
          registry,
          sessions,
          plugin,
          agents,
          bus,
          permission,
          provider,
          sync,
        },
        {
          task,
          model: dummyModel,
          lastUser,
          sessionID: parent.id,
          session: parent,
          msgs: [{ info: lastUser, parts: [task] }],
        },
      )

      expect(childSessionID).toBeDefined()
      const child = yield* sessions.get(childSessionID!)
      for (const rule of FALLBACK_DENY) {
        expect(child.permission).toContainEqual(rule)
      }
    }),
  )
})
