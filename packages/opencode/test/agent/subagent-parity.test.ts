import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { TaskTool, type TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { SearchService } from "@/search/search"
import { EmbeddingService } from "@/search/embedding"
import { SessionStatus } from "../../src/session/status"
import { Bus } from "@/bus"
import { SyncEvent } from "@/sync"
import { Todo } from "../../src/session/todo"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionRevert } from "../../src/session/revert"
import { SessionV2 } from "../../src/v2/session"
import { SessionEvent } from "../../src/v2/session-event"
import { FileAttachment, AgentAttachment } from "../../src/v2/session-prompt"
import * as DateTime from "effect/DateTime"
import { Modelv2 } from "../../src/v2/model"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

/** Identical fixtures shared by the V1 and V2 spawn legs (gap b). */
const parentPermission = [
  { permission: "read", pattern: "*", action: "allow" as const },
  { permission: "bash", pattern: "*", action: "deny" as const },
]

const parityConfig = {
  agent: {
    // Parent-agent deny rules that must reach the child via parentAgentDenies.
    strict: {
      description: "Strict primary agent with deny rules",
      mode: "primary" as const,
      permission: {
        edit: "deny" as const,
        write: "deny" as const,
      },
    },
  },
  experimental: {
    primary_tools: ["grep"],
  },
}

/** Stub shared prompt engine — mirrors test/v2/session.test.ts. */
function stubPromptLayer() {
  const calls: { prompt: unknown[] } = { prompt: [] }
  const loopResult = {
    info: {
      id: MessageID.ascending(),
      role: "assistant" as const,
      parentID: MessageID.ascending(),
      sessionID: SessionID.make("ses_stub"),
      mode: "build",
      agent: "build",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: ref.modelID,
      providerID: ref.providerID,
      time: { created: Date.now() },
      finish: "stop" as const,
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: MessageID.ascending(),
        sessionID: SessionID.make("ses_stub"),
        type: "text" as const,
        text: "stub result",
      },
    ],
  }
  const layer = Layer.effect(
    SessionPrompt.Engine,
    Effect.gen(function* () {
      const sync = yield* SyncEvent.Service
      return SessionPrompt.Engine.of({
        prompt: (input: any) =>
          Effect.gen(function* () {
            calls.prompt.push(input)
            const textPart = input.parts?.find((p: any) => p.type === "text")
            const fileParts = (input.parts ?? []).filter((p: any) => p.type === "file")
            const agentParts = (input.parts ?? []).filter((p: any) => p.type === "agent")
            const created = Date.now()
            const ts = DateTime.makeUnsafe(created)
            const legacyMessageID = input.messageID ?? MessageID.ascending()
            yield* sync.run(MessageV2.Event.Updated, {
              sessionID: input.sessionID,
              info: {
                id: legacyMessageID,
                role: "user",
                sessionID: input.sessionID,
                agent: input.agent ?? "general",
                model: { providerID: ref.providerID, modelID: ref.modelID },
                time: { created },
              },
            })
            yield* sync.run(SessionEvent.Prompted.Sync, {
              sessionID: input.sessionID,
              timestamp: ts,
              legacyMessageID,
              agent: input.agent ?? "general",
              model: {
                id: Modelv2.ID.make("test-model"),
                providerID: Modelv2.ProviderID.make("test"),
                variant: Modelv2.VariantID.make("default"),
              },
              prompt: {
                text: textPart?.text ?? "",
                files: fileParts.map((p: any) => new FileAttachment({ uri: p.url, mime: p.mime, name: p.filename })),
                agents: agentParts.map((p: any) => new AgentAttachment({ name: p.name })),
              },
            })
            yield* sync.run(SessionEvent.Step.Started.Sync, {
              sessionID: input.sessionID,
              timestamp: ts,
              legacyMessageID,
              agent: input.agent ?? "general",
              model: {
                id: Modelv2.ID.make("test-model"),
                providerID: Modelv2.ProviderID.make("test"),
                variant: Modelv2.VariantID.make("default"),
              },
            })
            yield* sync.run(SessionEvent.Text.Started.Sync, {
              sessionID: input.sessionID,
              timestamp: ts,
            })
            yield* sync.run(SessionEvent.Text.Ended.Sync, {
              sessionID: input.sessionID,
              timestamp: ts,
              text: "stub result",
            })
            yield* sync.run(SessionEvent.Step.Ended.Sync, {
              sessionID: input.sessionID,
              timestamp: ts,
              finish: "stop",
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            })
            return {
              info: {
                id: legacyMessageID,
                role: "user",
                sessionID: input.sessionID,
                time: { created },
              },
              parts: [],
            } as unknown as MessageV2.WithParts
          }),
        loop: () => Effect.succeed(loopResult as any),
        shell: () => Effect.succeed(loopResult as any),
        command: () => Effect.die("not used"),
        cancel: () => Effect.void,
        resolvePromptParts: (template: string) => Effect.succeed([{ type: "text" as const, text: template }]),
        predict: () => Effect.succeed(""),
      })
    }),
  )
  return { layer, calls }
}

function stubCompactionLayer() {
  const layer = Layer.succeed(SessionCompaction.Service, {
    create: () => Effect.void,
    process: () => Effect.succeed("stop" as const),
    prune: () => Effect.succeed(0),
  })
  return { layer }
}

function stubRevertLayer() {
  const layer = Layer.effect(
    SessionRevert.Service,
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      return {
        revert: (input: SessionRevert.RevertInput) =>
          Effect.gen(function* () {
            yield* sessions.setRevert({
              sessionID: input.sessionID,
              revert: { messageID: input.messageID },
              summary: { additions: 0, deletions: 0, files: 0 },
            })
            return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
          }),
        unrevert: (input: { sessionID: SessionID }) =>
          Effect.gen(function* () {
            yield* sessions.clearRevert(input.sessionID)
            return yield* sessions.get(input.sessionID).pipe(Effect.orDie)
          }),
        cleanup: () => Effect.void,
      }
    }),
  )
  return { layer }
}

function stubOps(opts?: { onPrompt?: (input: SessionPrompt.PromptInput) => void }): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
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
              text: "done",
            },
          ],
        } satisfies MessageV2.WithParts
      }),
  }
}

// Combined layer: V1 services for TaskTool + V2 session with stubbed engine.
function makeParityLayer() {
  const promptStub = stubPromptLayer()
  const compactionStub = stubCompactionLayer()
  const revertStub = stubRevertLayer()
  const infra = Layer.mergeAll(
    Agent.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
    SessionStatus.defaultLayer,
    Bus.layer,
    SyncEvent.defaultLayer,
    Todo.defaultLayer,
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
  const stubs = Layer.mergeAll(promptStub.layer, compactionStub.layer, revertStub.layer).pipe(Layer.provide(infra))
  const v2WithStubs = SessionV2.layer.pipe(Layer.provide(Layer.mergeAll(infra, stubs)))
  // Expose infra services (Session, Agent, …) alongside V2 for both spawn legs.
  const combined = Layer.mergeAll(infra, v2WithStubs)
  return { layer: combined, promptStub }
}

const parityLayer = makeParityLayer()
const it = testEffect(parityLayer.layer)
const promptStub = parityLayer.promptStub

describe("subagent V1/V2 parity", () => {
  it.instance(
    "V1 TaskTool and V2 subagent produce identical child permission, tools, and title shape",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const v2 = yield* SessionV2.Service

        // --- Shared fixture: parent session with permission + strict agent ---
        const parentV1 = yield* sessions.create({
          title: "Parity parent",
          agent: "strict",
          permission: parentPermission,
        })
        const parentV2 = yield* v2.create({
          title: "Parity parent",
          agent: "strict",
          permission: parentPermission,
        })

        // --- V1 spawn via TaskTool ---
        const user = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "user",
          sessionID: parentV1.id,
          agent: "strict",
          model: ref,
          time: { created: Date.now() },
        })
        const assistant: MessageV2.Assistant = {
          id: MessageID.ascending(),
          role: "assistant",
          parentID: user.id,
          sessionID: parentV1.id,
          mode: "strict",
          agent: "strict",
          cost: 0,
          path: { cwd: "/tmp", root: "/tmp" },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: ref.modelID,
          providerID: ref.providerID,
          time: { created: Date.now() },
        }
        yield* sessions.updateMessage(assistant)

        const tool = yield* TaskTool
        const def = yield* tool.init()
        let seen: SessionPrompt.PromptInput | undefined
        const promptOps = stubOps({ onPrompt: (input) => (seen = input) })

        const v1Result = yield* def.execute(
          {
            description: "parity spawn",
            prompt: "run the parity fixture",
            subagent_type: "general",
          },
          {
            sessionID: parentV1.id,
            messageID: assistant.id,
            agent: "strict",
            abort: new AbortController().signal,
            extra: { promptOps, bypassAgentCheck: true },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        const childV1 = yield* sessions.get(v1Result.metadata.sessionId)
        const titleV1 = childV1.title
        const toolsV1 = seen?.tools

        // --- V2 spawn via SessionV2.subagent ---
        const promptsBefore = promptStub.calls.prompt.length
        yield* v2.subagent({
          parentID: parentV2.id,
          agent: "general",
          description: "parity spawn",
          prompt: { text: "run the parity fixture" },
        })
        const lastCall = promptStub.calls.prompt.at(-1) as any
        expect(promptStub.calls.prompt.length).toBe(promptsBefore + 1)
        const childV2 = yield* v2.get(lastCall.sessionID)
        const titleV2 = childV2.title
        const toolsV2 = lastCall.tools

        // --- Parity assertions ---
        // 1. Child session permission deep-equals across V1/V2.
        expect(childV1.permission).toEqual(childV2.permission)

        // 2. Tool restriction maps deep-equal across V1/V2.
        expect(toolsV1).toEqual(toolsV2)

        // 3. Both titles match the V1 format (fix 10): `(@agent subagent)`.
        expect(titleV1).toMatch(/\(@\w+ subagent\)$/)
        expect(titleV2).toMatch(/\(@\w+ subagent\)$/)

        // Spot-check the shared derivation actually carried the fixtures:
        // parent session rules first, derived todowrite/task denies,
        // parent-agent (strict) deny rules (incl. defaults inherited by
        // config agents), primary_tools allow last.
        expect(childV1.permission).toEqual([
          { permission: "read", pattern: "*", action: "allow" },
          { permission: "bash", pattern: "*", action: "deny" },
          { permission: "todowrite", pattern: "*", action: "deny" },
          { permission: "task", pattern: "*", action: "deny" },
          // strict = agent defaults deny set + explicit edit/write denies
          { permission: "question", pattern: "*", action: "deny" },
          { permission: "plan_enter", pattern: "*", action: "deny" },
          { permission: "plan_exit", pattern: "*", action: "deny" },
          { permission: "repo_clone", pattern: "*", action: "deny" },
          { permission: "repo_overview", pattern: "*", action: "deny" },
          { permission: "edit", pattern: "*", action: "deny" },
          { permission: "write", pattern: "*", action: "deny" },
          { permission: "grep", pattern: "*", action: "allow" },
        ])
        expect(toolsV1).toEqual({
          todowrite: false,
          task: false,
          grep: false,
        })
      }),
    { config: parityConfig },
  )
})
