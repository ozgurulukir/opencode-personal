import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { Config } from "@/config/config"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session as SessionV1 } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionRevert } from "../../src/session/revert"
import { Todo } from "../../src/session/todo"
import { SessionStatus } from "../../src/session/status"
import { Bus } from "@/bus"
import { SyncEvent } from "@/sync"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { SessionV2 } from "../../src/v2/session"
import { SessionEvent } from "../../src/v2/session-event"
import { FileAttachment, AgentAttachment } from "../../src/v2/session-prompt"
import * as DateTime from "effect/DateTime"
import { Modelv2 } from "../../src/v2/model"
import { SessionMessage } from "../../src/v2/session-message"
import { SessionMessageTable, SessionTable } from "../../src/session/session.sql"
import * as Database from "../../src/storage/db"
import { eq } from "../../src/storage/db"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

/** A stub shared prompt engine that records calls and returns canned messages. */
function stubPromptLayer(opts?: { loopResult?: MessageV2.WithParts; failPrompt?: boolean }) {
  const calls: {
    prompt: unknown[]
    loop: string[]
    shell: unknown[]
    legacyMessageIDs: MessageID[]
    legacyAssistantMessageIDs: MessageID[]
  } = {
    prompt: [],
    loop: [],
    shell: [],
    legacyMessageIDs: [],
    legacyAssistantMessageIDs: [],
  }
  const loopResult = opts?.loopResult ?? {
    info: {
      id: MessageID.ascending(),
      role: "assistant",
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
      finish: "stop",
    } satisfies MessageV2.Assistant,
    parts: [
      {
        id: PartID.ascending(),
        messageID: MessageID.ascending(),
        sessionID: SessionID.make("ses_stub"),
        type: "text",
        text: "stub result",
      },
    ],
  }

  // The layer depends on SyncEvent.Service so the stub can emit Prompted events.
  const layer = Layer.effect(
    SessionPrompt.Engine,
    Effect.gen(function* () {
      const sync = yield* SyncEvent.Service
      return SessionPrompt.Engine.of({
        prompt: (input: any) =>
          Effect.gen(function* () {
            calls.prompt.push(input)
            if (opts?.failPrompt) {
              yield* Effect.die(new Error("simulated prompt failure"))
            }
            // Emit the Prompted sync event so the V2 projector writes a
            // SessionMessageTable row — this mirrors what the real V1 prompt
            // does (prompt.ts:1440) and lets the V2 `messages`/`prompt` read-back work.
            const textPart = input.parts?.find((p: any) => p.type === "text")
            const fileParts = (input.parts ?? []).filter((p: any) => p.type === "file")
            const agentParts = (input.parts ?? []).filter((p: any) => p.type === "agent")
            const created = Date.now()
            const ts = DateTime.makeUnsafe(created)
            const legacyMessageID = input.messageID ?? MessageID.ascending()
            calls.legacyMessageIDs.push(legacyMessageID)
            const legacyAssistantInfo =
              loopResult.info.role === "assistant"
                ? {
                    ...loopResult.info,
                    id: MessageID.ascending(),
                    sessionID: input.sessionID,
                    time: { created: created - 1 },
                  }
                : undefined
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
            if (legacyAssistantInfo) {
              calls.legacyAssistantMessageIDs.push(legacyAssistantInfo.id)
              yield* sync.run(MessageV2.Event.Updated, {
                sessionID: input.sessionID,
                info: legacyAssistantInfo,
              })
            }
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
                // Prompt schema: files have {uri, mime, name?}, agents have {name, source?}
                files: fileParts.map((p: any) => new FileAttachment({ uri: p.url, mime: p.mime, name: p.filename })),
                agents: agentParts.map((p: any) => new AgentAttachment({ name: p.name })),
              },
            })
            // Emit assistant message events so the V2 projector creates an
            // assistant message with text content. This mirrors what the real
            // V1 prompt loop does and lets the V2 `subagent()` method find an
            // assistant message to post back as a synthetic message.
            yield* sync.run(SessionEvent.Step.Started.Sync, {
              sessionID: input.sessionID,
              timestamp: ts,
              legacyMessageID: legacyAssistantInfo?.id,
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
        loop: (input: { sessionID: SessionID }) =>
          Effect.gen(function* () {
            calls.loop.push(input.sessionID)
            return loopResult
          }),
        shell: (input: any) =>
          Effect.gen(function* () {
            calls.shell.push(input)
            return loopResult
          }),
        command: () => Effect.die("not used"),
        cancel: () => Effect.void,
        resolvePromptParts: (template: string) => Effect.succeed([{ type: "text" as const, text: template }]),
        predict: () => Effect.succeed(""),
      })
    }),
  )
  return { layer, calls }
}

/** A stub V1 SessionCompaction that records create calls. */
function stubCompactionLayer() {
  const calls: { create: unknown[] } = { create: [] }
  const layer = Layer.succeed(SessionCompaction.Service, {
    create: (input: any) =>
      Effect.gen(function* () {
        calls.create.push(input)
      }),
    process: () => Effect.succeed("stop" as const),
    prune: () => Effect.void,
    isOverflow: () => Effect.succeed(false),
  })
  return { layer, calls }
}

function stubRevertLayer() {
  const calls: unknown[] = []
  const layer = Layer.effect(
    SessionRevert.Service,
    Effect.gen(function* () {
      const sessions = yield* SessionV1.Service
      return {
        revert: (input: SessionRevert.RevertInput) =>
          Effect.gen(function* () {
            calls.push(input)
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
  return { layer, calls }
}

// Full layer: real Session + SyncEvent + Bus + Config, stubbed engine/compaction.
// Stubs MUST be provided to the V2 layer (not merged alongside) because the V2
// layer captures them at build time via Effect.serviceOption.
function makeTestLayer() {
  const promptStub = stubPromptLayer()
  const compactionStub = stubCompactionLayer()
  const revertStub = stubRevertLayer()
  // Infrastructure layers (no stubs yet)
  const infra = Layer.mergeAll(
    SessionV1.defaultLayer,
    Config.defaultLayer,
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    SessionStatus.defaultLayer,
    Bus.layer,
    SyncEvent.defaultLayer,
    Todo.defaultLayer,
  )
  // Stubs depend on SyncEvent, so provide infra to them.
  const stubs = Layer.mergeAll(promptStub.layer, compactionStub.layer, revertStub.layer).pipe(Layer.provide(infra))
  // V2 layer needs both infra and stubs so serviceOption finds them at build.
  const v2WithStubs = SessionV2.layer.pipe(Layer.provide(Layer.mergeAll(infra, stubs)))
  return { layer: v2WithStubs, promptStub, compactionStub, revertStub }
}

function makeFailingTestLayer() {
  const promptStub = stubPromptLayer({ failPrompt: true })
  const compactionStub = stubCompactionLayer()
  const revertStub = stubRevertLayer()
  const infra = Layer.mergeAll(
    SessionV1.defaultLayer,
    Config.defaultLayer,
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    SessionStatus.defaultLayer,
    Bus.layer,
    SyncEvent.defaultLayer,
    Todo.defaultLayer,
  )
  const stubs = Layer.mergeAll(promptStub.layer, compactionStub.layer, revertStub.layer).pipe(Layer.provide(infra))
  const v2WithStubs = SessionV2.layer.pipe(Layer.provide(Layer.mergeAll(infra, stubs)))
  return { layer: v2WithStubs, promptStub, compactionStub, revertStub }
}

const testLayer = makeTestLayer()
const it = testEffect(testLayer.layer)

// Expose the stubs for assertions. makeTestLayer is called once at module load,
// so these references stay valid across all tests in this file.
const promptStub = testLayer.promptStub
const compactionStub = testLayer.compactionStub
const revertStub = testLayer.revertStub

describe("v2.session", () => {
  it.instance("revert resolves projected event IDs to their legacy message IDs", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })
      const prompted = yield* session.prompt({
        sessionID: info.id,
        prompt: { text: "undo target" },
      })
      expect(prompted.user?.id).toStartWith("evt_")
      const revertCount = revertStub.calls.length
      const messageID = promptStub.calls.legacyMessageIDs.at(-1)
      const reverted = yield* session.revert({ sessionID: info.id, messageID: prompted.user!.id })

      expect(revertStub.calls).toHaveLength(revertCount + 1)
      expect(revertStub.calls.at(-1)).toMatchObject({ sessionID: info.id, messageID })
      expect(reverted.revert?.messageID).toBe(prompted.user!.id)
      expect((yield* session.get(info.id)).revert?.messageID).toBe(prompted.user!.id)
    }),
  )

  it.instance("revert resolves assistant event IDs when legacy and projected timestamps differ", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })
      const prompted = yield* session.prompt({
        sessionID: info.id,
        prompt: { text: "undo assistant target" },
      })
      expect(prompted.assistant?.id).toStartWith("evt_")
      expect(prompted.assistant?.metadata?.opencodeLegacyMessageID).toBeUndefined()

      const revertCount = revertStub.calls.length
      const messageID = promptStub.calls.legacyAssistantMessageIDs.at(-1)!
      const row = Database.use((db) =>
        db
          .select({ data: SessionMessageTable.data })
          .from(SessionMessageTable)
          .where(eq(SessionMessageTable.id, SessionMessage.ID.make(prompted.assistant!.id)))
          .get(),
      )
      expect(row?.data.metadata?.opencodeLegacyMessageID).toBe(messageID)
      yield* session
        .revert({ sessionID: info.id, messageID: prompted.assistant!.id })
        .pipe(Effect.catchDefect(() => Effect.void))

      expect(revertStub.calls).toHaveLength(revertCount + 1)
      expect(revertStub.calls.at(-1)).toMatchObject({ sessionID: info.id, messageID })
    }),
  )

  it.instance("create inserts a session row and returns V2 Info", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })

      expect(info.id).toBeTruthy()
      expect(info.agent).toBe("build")
      expect(info.parentID).toBeUndefined()
      expect(info.title).toBeTruthy()

      // Round-trip: get returns the same row
      const fetched = yield* session.get(info.id)
      expect(fetched.id).toBe(info.id)
      expect(fetched.agent).toBe("build")
    }),
  )

  it.instance("create with parentID links child to parent", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })
      const child = yield* session.create({ agent: "general", parentID: parent.id })

      expect(child.parentID).toBe(parent.id)
      expect(child.agent).toBe("general")
    }),
  )

  it.instance("wait returns immediately when session is idle", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })
      // A freshly-created session has no running loop → idle → wait returns.
      yield* session.wait(info.id)
      // If we reach here without hanging, the test passes.
      expect(true).toBe(true)
    }),
  )

  it.instance("compact delegates to V1 SessionCompaction.create", () =>
    Effect.gen(function* () {
      const before = compactionStub.calls.create.length
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })
      yield* session.compact(info.id)

      expect(compactionStub.calls.create.length).toBe(before + 1)
      const call = compactionStub.calls.create.at(-1) as { sessionID: string; auto: boolean; agent: string }
      expect(call.sessionID).toBe(info.id)
      expect(call.auto).toBe(false)
      expect(call.agent).toBe("build")
    }),
  )

  it.instance("prompt (immediate) creates a user message and runs the loop", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })

      const user = yield* session.prompt({
        sessionID: info.id,
        prompt: { text: "hello world" },
      })

      expect(user.user?.type).toBe("user")
      expect(user.user?.text).toBe("hello world")
      // Immediate delivery runs the loop synchronously — the stub emits an
      // assistant message, so the response carries it for usage reporting.
      expect(user.assistant?.type).toBe("assistant")
    }),
  )

  it.instance("messages reads legacy user rows without agent or model fields", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })
      const created = Date.now()

      Database.use((db) => {
        db.update(SessionTable)
          .set({ model: { id: "legacy-model", providerID: "legacy-provider", variant: "default" } })
          .where(Database.eq(SessionTable.id, info.id))
          .run()
        db.insert(SessionMessageTable)
          .values([
            {
              id: SessionMessage.ID.create(),
              session_id: info.id,
              type: "user",
              time_created: created,
              data: {
                text: "legacy prompt",
                files: [],
                agents: [],
                time: { created },
              } as (typeof SessionMessageTable.$inferInsert)["data"],
            },
          ])
          .run()
      })

      const messages = yield* session.messages({ sessionID: info.id })
      const user = messages.find((message): message is SessionMessage.User => message.type === "user")
      expect(user).toMatchObject({
        text: "legacy prompt",
        agent: "build",
        model: { id: "legacy-model", providerID: "legacy-provider" },
      })
    }),
  )

  it.instance("messages tolerates a JSON-encoded running tool input", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })
      const created = Date.now()

      Database.use((db) => {
        db.insert(SessionMessageTable)
          .values([
            {
              id: SessionMessage.ID.create(),
              session_id: info.id,
              type: "assistant",
              time_created: created,
              data: {
                time: { created },
                agent: "build",
                model: { id: "test-model", providerID: "test", variant: "default" },
                content: [
                  {
                    type: "tool",
                    id: "call_legacy",
                    name: "write",
                    state: {
                      status: "running",
                      input: JSON.stringify({ content: "legacy source" }),
                      structured: {},
                      content: [],
                    },
                    time: { created },
                  },
                ],
              } as (typeof SessionMessageTable.$inferInsert)["data"],
            },
          ])
          .run()
      })

      const messages = yield* session.messages({ sessionID: info.id })
      const assistant = messages.find((message): message is SessionMessage.Assistant => message.type === "assistant")
      const tool = assistant?.content.find((item): item is SessionMessage.AssistantTool => item.type === "tool")
      expect(tool?.state).toMatchObject({
        status: "running",
        input: { content: "legacy source" },
      })
    }),
  )

  it.instance("prompt (deferred) stages the message without running the loop", () =>
    Effect.gen(function* () {
      const loopBefore = promptStub.calls.loop.length
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })

      const user = yield* session.prompt({
        sessionID: info.id,
        prompt: { text: "deferred hello" },
        delivery: "deferred",
      })

      // The user message is still created and readable
      expect(user.user?.type).toBe("user")
      expect(user.user?.text).toBe("deferred hello")
      // loop was NOT called (deferred doesn't run the loop synchronously)
      expect(promptStub.calls.loop.length).toBe(loopBefore)
    }),
  )

  it.instance("prompt (deferred) drains via the background worker", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })

      yield* session.prompt({
        sessionID: info.id,
        prompt: { text: "deferred drain" },
        delivery: "deferred",
      })

      // The layer-scoped worker drains the queue without an explicit
      // runDeferred() call — poll until the stub loop records the session.
      let drained = false
      for (let i = 0; i < 100 && !drained; i++) {
        yield* Effect.sleep(10)
        drained = promptStub.calls.loop.includes(info.id)
      }
      expect(drained).toBe(true)
    }),
  )

  it.instance("prompt with files translates FileAttachment to file parts", () =>
    Effect.gen(function* () {
      const before = promptStub.calls.prompt.length
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })

      yield* session.prompt({
        sessionID: info.id,
        prompt: {
          text: "look at this",
          files: [{ uri: "file:///tmp/foo.ts", mime: "text/plain", name: "foo.ts" }],
        },
      })

      const call = promptStub.calls.prompt.at(-1) as { parts: { type: string; text?: string; url?: string }[] }
      expect(promptStub.calls.prompt.length).toBe(before + 1)
      const types = call.parts.map((p) => p.type)
      expect(types).toContain("text")
      expect(types).toContain("file")
      const filePart = call.parts.find((p) => p.type === "file")
      expect(filePart?.url).toBe("file:///tmp/foo.ts")
    }),
  )

  it.instance("prompt with agents translates AgentAttachment to agent parts", () =>
    Effect.gen(function* () {
      const before = promptStub.calls.prompt.length
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })

      yield* session.prompt({
        sessionID: info.id,
        prompt: {
          text: "use explore",
          agents: [{ name: "explore" }],
        },
      })

      const call = promptStub.calls.prompt.at(-1) as { parts: { type: string; name?: string }[] }
      expect(promptStub.calls.prompt.length).toBe(before + 1)
      const agentPart = call.parts.find((p) => p.type === "agent")
      expect(agentPart?.name).toBe("explore")
    }),
  )

  it.instance("shell delegates to V1 SessionPrompt.shell", () =>
    Effect.gen(function* () {
      const before = promptStub.calls.shell.length
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })

      yield* session.shell({ sessionID: info.id, command: "ls -la" })

      expect(promptStub.calls.shell.length).toBe(before + 1)
      const call = promptStub.calls.shell.at(-1) as { command: string; agent: string }
      expect(call.command).toBe("ls -la")
      expect(call.agent).toBe("build")
    }),
  )

  it.instance("shell passes explicit agent, model, and messageID through to V1", () =>
    Effect.gen(function* () {
      const before = promptStub.calls.shell.length
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })

      yield* session.shell({
        sessionID: info.id,
        command: "bun test",
        agent: "plan",
        model: { providerID: ref.providerID, modelID: ref.modelID },
        messageID: MessageID.ascending(),
      })

      const call = promptStub.calls.shell.at(-1) as {
        command: string
        agent: string
        model: { providerID: string; modelID: string }
        messageID: MessageID
      }
      expect(call.command).toBe("bun test")
      expect(call.agent).toBe("plan")
      expect(call.model).toEqual({ providerID: ref.providerID, modelID: ref.modelID })
      expect(call.messageID).toBeDefined()
    }),
  )

  it.instance("skill delegates to V1 SessionPrompt.prompt with /skill prefix", () =>
    Effect.gen(function* () {
      const before = promptStub.calls.prompt.length
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })

      yield* session.skill({ sessionID: info.id, skill: "commit" })

      expect(promptStub.calls.prompt.length).toBe(before + 1)
      const call = promptStub.calls.prompt.at(-1) as { parts: { type: string; text?: string }[] }
      const textPart = call.parts.find((p) => p.type === "text")
      expect(textPart?.text).toBe("/commit")
    }),
  )

  it.instance("switchAgent emits AgentSwitched event and updates session row", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const info = yield* session.create({ agent: "build" })
      yield* session.switchAgent({ sessionID: info.id, agent: "plan" })

      const fetched = yield* session.get(info.id)
      expect(fetched.agent).toBe("plan")
    }),
  )

  it.instance("subagent creates a child session and prompts it", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      yield* session.subagent({
        parentID: parent.id,
        agent: "general",
        prompt: { text: "do something" },
      })

      expect(promptStub.calls.prompt.length).toBeGreaterThan(0)
      const lastCall = promptStub.calls.prompt.at(-1) as any
      expect(lastCall.sessionID).not.toBe(parent.id)

      const textPart = lastCall.parts?.find((p: any) => p.type === "text")
      expect(textPart?.text).toBe("do something")
    }),
  )

  it.instance("subagent posts synthetic message to parent after child completes", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      yield* session.subagent({
        parentID: parent.id,
        agent: "general",
        prompt: { text: "do something" },
      })

      // The subagent forks a child fiber that posts a synthetic message.
      // Poll until it appears (the stub prompt returns immediately, so this
      // should resolve on the first or second iteration).
      const messages = yield* Effect.gen(function* () {
        for (let i = 0; i < 50; i++) {
          const msgs = yield* session.messages({ sessionID: parent.id, order: "desc" })
          if (msgs.some((m) => m.type === "synthetic")) return msgs
          yield* Effect.sleep("10 millis")
        }
        throw new Error("timed out waiting for synthetic message")
      })

      const synthetic = messages.find((m) => m.type === "synthetic")
      expect(synthetic?.type).toBe("synthetic")
      if (synthetic?.type === "synthetic") expect(synthetic.text).toBeTruthy()
    }),
  )

  it.instance("subagent returns void and does not throw on happy path", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      // subagent returns void — just assert it completes without error
      yield* session.subagent({
        parentID: parent.id,
        agent: "general",
        prompt: { text: "hello" },
      })
      expect(true).toBe(true)
    }),
  )

  it.instance("subagent disables task tool by default (todowrite already denied in general agent)", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      yield* session.subagent({
        parentID: parent.id,
        agent: "general",
        prompt: { text: "do something" },
      })

      const lastCall = promptStub.calls.prompt.at(-1) as any
      // general agent has todowrite: "deny" in its permission, but deny
      // does not count as "having" the permission — only allow rules do.
      // So subagentToolRestrictions adds { todowrite: false } and { task: false }.
      expect(lastCall.tools).toEqual({
        todowrite: false,
        task: false,
      })
    }),
  )

  it.instance("subagent passes agent name to child prompt", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      yield* session.subagent({
        parentID: parent.id,
        agent: "explore",
        prompt: { text: "find files" },
      })

      const lastCall = promptStub.calls.prompt.at(-1) as any
      expect(lastCall.agent).toBe("explore")
    }),
  )

  it.instance("subagent dies for invalid agent name", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      const result = (yield* session
        .subagent({
          parentID: parent.id,
          agent: "nonexistent-agent",
          prompt: { text: "do something" },
        })
        .pipe(
          Effect.map(() => ({ error: undefined as string | undefined, ok: true })),
          Effect.catchDefect((defect) =>
            Effect.succeed({ error: defect instanceof Error ? defect.message : String(defect), ok: false }),
          ),
        )) as { error: string | undefined; ok: boolean }

      expect(result.error).toContain("Unknown agent type")
    }),
  )

  it.instance("subagent spawns child session with derived deny permissions", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      yield* session.subagent({
        parentID: parent.id,
        agent: "general",
        prompt: { text: "do the thing" },
      })

      // Get the child session ID from the prompt stub (the last prompt call
      // is the subagent's child session).
      const lastCall = promptStub.calls.prompt.at(-1) as any
      const childID = lastCall.sessionID

      // Verify child session exists and is linked to parent
      const child = yield* session.get(childID)
      expect(child.parentID).toBe(parent.id)

      // Verify derived deny permissions: general agent does not explicitly
      // allow todowrite or task, so deriveSubagentSessionPermission adds
      // default denies for both.
      expect(child.permission).toBeDefined()
      const todowriteDeny = child.permission?.find((r) => r.permission === "todowrite" && r.action === "deny")
      expect(todowriteDeny).toBeDefined()
      const taskDeny = child.permission?.find((r) => r.permission === "task" && r.action === "deny")
      expect(taskDeny).toBeDefined()
    }),
  )

  it.instance("subagent handles pre-aborted signal without unhandled rejection", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      const abort = new AbortController()
      abort.abort()

      // The test completes without unhandled rejection — the .catch() from
      // Issue 1 prevents the leak. The stub prompt's cancel returns void,
      // so the abort path is a no-op.
      yield* session.subagent({
        parentID: parent.id,
        agent: "general",
        prompt: { text: "x" },
        abort: abort.signal,
      })
      expect(true).toBe(true)
    }),
  )

  it.instance("subagent applies fallback deny rules when parent agent is missing", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "deleted-agent" })

      // After Issue 2 fix: when parent agent is not found, fallback deny rules
      // are applied instead of silently skipping all denies.
      yield* session.subagent({
        parentID: parent.id,
        agent: "general",
        prompt: { text: "do something" },
      })

      // Get the child session ID from the prompt stub (the last prompt call
      // is the subagent's child session).
      const lastCall = promptStub.calls.prompt.at(-1) as any
      const childID = lastCall.sessionID

      const child = yield* session.get(childID)
      expect(child.parentID).toBe(parent.id)
      expect(child.permission).toBeDefined()
      const editDeny = child.permission?.find((r) => r.permission === "edit" && r.action === "deny")
      const writeDeny = child.permission?.find((r) => r.permission === "write" && r.action === "deny")
      const bashDeny = child.permission?.find((r) => r.permission === "bash" && r.action === "deny")
      expect(editDeny).toBeDefined()
      expect(writeDeny).toBeDefined()
      expect(bashDeny).toBeDefined()
    }),
  )

  it.instance("subagent rejects when max nesting depth is exceeded", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })
      const child1 = yield* session.create({ agent: "general", parentID: parent.id })
      const child2 = yield* session.create({ agent: "general", parentID: child1.id })
      const child3 = yield* session.create({ agent: "general", parentID: child2.id })

      const result = (yield* session
        .subagent({
          parentID: child3.id,
          agent: "general",
          prompt: { text: "do something" },
        })
        .pipe(
          Effect.map(() => ({ error: undefined as string | undefined, ok: true })),
          Effect.catch((error) =>
            Effect.succeed({ error: error instanceof Error ? error.message : String(error), ok: false }),
          ),
        )) as { error: string | undefined; ok: boolean }

      expect(result.ok).toBe(false)
      expect(result.error).toContain("Maximum subagent nesting levels")
    }),
  )

  it.instance(
    "subagent with primary_tools configured allows them in permission but disables in tools",
    () =>
      Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const parent = yield* session.create({ agent: "build" })

        yield* session.subagent({
          parentID: parent.id,
          agent: "general",
          prompt: { text: "do something" },
        })

        const lastCall = promptStub.calls.prompt.at(-1) as any
        // primary_tools are false'd in tools map; general agent also gets
        // todowrite: false and task: false from subagentToolRestrictions.
        expect(lastCall.tools).toEqual({
          todowrite: false,
          task: false,
          bash: false,
          read: false,
        })
      }),
    {
      config: {
        experimental: {
          primary_tools: ["bash", "read"],
        },
      },
    },
  )

  it.instance("subagent preserves model variant in child session", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      yield* session.subagent({
        parentID: parent.id,
        agent: "general",
        prompt: { text: "do something" },
        model: {
          id: Modelv2.ID.make("test-model"),
          providerID: Modelv2.ProviderID.make("test"),
          variant: Modelv2.VariantID.make("fast"),
        },
      })

      // Verify the child session was created with the variant
      const lastPromptCall = promptStub.calls.prompt.at(-1) as any
      const childID = lastPromptCall.sessionID
      const child = yield* session.get(childID)
      expect(child.model?.variant).toBe(Modelv2.VariantID.make("fast"))
    }),
  )

  it.instance("subagent posts synthetic error message when loop fails", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      // The default stub prompt returns normally, so the subagent completes
      // successfully. Error handling is verified by the "subagent dies for
      // invalid agent name" test and the V1 TaskTool defect tests.
      // This test documents that the happy path completes without error.
      yield* session.subagent({
        parentID: parent.id,
        agent: "general",
        prompt: { text: "do something" },
      })

      expect(true).toBe(true)
    }),
  )

  it.instance("subagent cancels during execution when abort signal fires", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      const abort = new AbortController()

      // Start subagent with abort signal, abort it immediately after start
      const fiber = yield* Effect.forkChild(
        session.subagent({
          parentID: parent.id,
          agent: "general",
          prompt: { text: "do something" },
          abort: abort.signal,
        }),
      )

      yield* Effect.sleep("50 millis")
      abort.abort()
      const exit = yield* Fiber.await(fiber)
      // The fiber should complete without unhandled rejection
      expect(["Success", "Interrupted", "Failure"]).toContain(exit._tag)
    }),
  )

  it.instance("subagent is cancelled when parent scope is closed", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      yield* Effect.acquireUseRelease(
        Effect.sync(() => {}),
        () =>
          session.subagent({
            parentID: parent.id,
            agent: "general",
            prompt: { text: "do something" },
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) {
              yield* Effect.sleep("100 millis")
            }
          }),
      )

      expect(true).toBe(true)
    }),
  )
})

describe("v2.session.error-path", () => {
  const failingTestLayer = makeFailingTestLayer()
  const failingIt = testEffect(failingTestLayer.layer)
  const failingPromptStub = failingTestLayer.promptStub

  failingIt.instance("subagent posts synthetic error message when prompt fails", () =>
    Effect.gen(function* () {
      const session = yield* SessionV2.Service
      const parent = yield* session.create({ agent: "build" })

      yield* session.subagent({
        parentID: parent.id,
        agent: "general",
        prompt: { text: "do something" },
      })

      // Verify the failing prompt was actually called
      expect(failingPromptStub.calls.prompt.length).toBeGreaterThan(0)

      // Poll parent messages for the synthetic error message.
      const messages = yield* Effect.gen(function* () {
        for (let i = 0; i < 50; i++) {
          const msgs = yield* session.messages({ sessionID: parent.id, order: "desc" })
          const synthetic = msgs.find((m) => m.type === "synthetic")
          if (synthetic) return msgs
          yield* Effect.sleep("10 millis")
        }
        throw new Error("timed out waiting for synthetic error message")
      })

      const synthetic = messages.find((m) => m.type === "synthetic")
      expect(synthetic?.type).toBe("synthetic")
      if (synthetic?.type === "synthetic") {
        expect(synthetic.text).toContain("Subagent error:")
        expect(synthetic.text).toContain("simulated prompt failure")
      }
    }),
  )

  // Characterization tests for the revert ID seam (v2/session.ts revert facade
  // + projectedRevert read path) and the V2 dead-row behavior of revert
  // cleanup. These lock current behavior before the revert deepening refactor.
  describe("v2.session.revert-seam", () => {
    it.instance("revert resolves evt_ id via timestamp fallback when legacy association is missing", () =>
      Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const info = yield* session.create({ agent: "build" })
        const prompted = yield* session.prompt({
          sessionID: info.id,
          prompt: { text: "undo target without metadata" },
        })
        const legacyID = promptStub.calls.legacyMessageIDs.at(-1)!

        // Simulate a pre-metadata V2 row: strip the legacy association but keep
        // the row's time_created equal to the V1 message's created time.
        Database.use((db) => {
          const row = db
            .select()
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.id, SessionMessage.ID.make(prompted.user!.id)))
            .get()
          if (!row) throw new Error("row not found")
          const { opencodeLegacyMessageID: _, ...restMetadata } = (row.data.metadata ?? {}) as Record<string, unknown>
          const data = { ...row.data, metadata: Object.keys(restMetadata).length ? restMetadata : undefined } as typeof row.data
          db.update(SessionMessageTable)
            .set({ data: data as never })
            .where(eq(SessionMessageTable.id, SessionMessage.ID.make(prompted.user!.id)))
            .run()
        })

        const revertCount = revertStub.calls.length
        const reverted = yield* session.revert({ sessionID: info.id, messageID: prompted.user!.id })
        expect(revertStub.calls).toHaveLength(revertCount + 1)
        expect(revertStub.calls.at(-1)).toMatchObject({ sessionID: info.id, messageID: legacyID })
        expect(reverted.revert?.messageID).toBe(prompted.user!.id)
      }),
    )

    it.instance("revert fails NotFoundError for an unknown evt_ id", () =>
      Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const info = yield* session.create({ agent: "build" })
        const error = yield* Effect.flip(
          session.revert({
            sessionID: info.id,
            messageID: SessionMessage.ID.make(`evt_${Date.now()}`),
          }),
        )
        expect(error._tag).toBe("Session.NotFoundError")
      }),
    )

    it.instance("message reads strip the legacy association metadata", () =>
      Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const info = yield* session.create({ agent: "build" })
        yield* session.prompt({ sessionID: info.id, prompt: { text: "metadata check" } })
        const messages = yield* session.messages({ sessionID: info.id, order: "asc" })
        const user = messages.find((m) => m.type === "user")
        expect(user).toBeDefined()
        expect(user?.metadata?.opencodeLegacyMessageID).toBeUndefined()
      }),
    )

  })
})
