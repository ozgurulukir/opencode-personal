import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Session as SessionV1 } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionCompaction } from "../../src/session/compaction"
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

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

/** A stub V1 SessionPrompt that records calls and returns canned messages. */
function stubPromptLayer(opts?: {
  loopResult?: MessageV2.WithParts
}) {
  const calls: { prompt: unknown[]; loop: string[]; shell: unknown[] } = { prompt: [], loop: [], shell: [] }
  const loopResult =
    opts?.loopResult ??
    ({
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
    })

  // The layer depends on SyncEvent.Service so the stub can emit Prompted events.
  const layer = Layer.effect(
    SessionPrompt.Service,
    Effect.gen(function* () {
      const sync = yield* SyncEvent.Service
      return SessionPrompt.Service.of({
        prompt: (input: any) =>
          Effect.gen(function* () {
            calls.prompt.push(input)
            // Emit the Prompted sync event so the V2 projector writes a
            // SessionMessageTable row — this mirrors what the real V1 prompt
            // does (prompt.ts:1440) and lets the V2 `messages`/`prompt` read-back work.
            const textPart = input.parts?.find((p: any) => p.type === "text")
            const fileParts = (input.parts ?? []).filter((p: any) => p.type === "file")
            const agentParts = (input.parts ?? []).filter((p: any) => p.type === "agent")
            const ts = DateTime.makeUnsafe(Date.now())
            yield* sync.run(SessionEvent.Prompted.Sync, {
              sessionID: input.sessionID,
              timestamp: ts,
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
                id: input.messageID ?? MessageID.ascending(),
                role: "user",
                sessionID: input.sessionID,
                time: { created: Date.now() },
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

// Full layer: real Session + SyncEvent + Bus + Config, stubbed prompt/compaction.
// Stubs MUST be provided to the V2 layer (not merged alongside) because the V2
// layer captures them at build time via Effect.serviceOption.
function makeTestLayer() {
  const promptStub = stubPromptLayer()
  const compactionStub = stubCompactionLayer()
  // Infrastructure layers (no stubs yet)
  const infra = Layer.mergeAll(
    SessionV1.defaultLayer,
    Config.defaultLayer,
    Agent.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    SessionStatus.defaultLayer,
    Bus.layer,
    SyncEvent.defaultLayer,
  )
  // Stubs depend on SyncEvent, so provide infra to them.
  const stubs = Layer.mergeAll(promptStub.layer, compactionStub.layer).pipe(Layer.provide(infra))
  // V2 layer needs both infra and stubs so serviceOption finds them at build.
  const v2WithStubs = SessionV2.layer.pipe(Layer.provide(Layer.mergeAll(infra, stubs)))
  return { layer: v2WithStubs, promptStub, compactionStub }
}

const testLayer = makeTestLayer()
const it = testEffect(testLayer.layer)

// Expose the stubs for assertions. makeTestLayer is called once at module load,
// so these references stay valid across all tests in this file.
const promptStub = testLayer.promptStub
const compactionStub = testLayer.compactionStub

describe("v2.session", () => {
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

      expect(user.type).toBe("user")
      expect(user.text).toBe("hello world")
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
      expect(user.type).toBe("user")
      expect(user.text).toBe("deferred hello")
      // loop was NOT called (deferred doesn't run the loop synchronously)
      expect(promptStub.calls.loop.length).toBe(loopBefore)
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
      // general agent has todowrite: "deny" in its permission, so
      // subagentToolRestrictions sees has("todowrite") = true and
      // does NOT add { todowrite: false }. It does add { task: false }
      // because general doesn't have task in its permission.
      expect(lastCall.tools).toEqual({
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
})
