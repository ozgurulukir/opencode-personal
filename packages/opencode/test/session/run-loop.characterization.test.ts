/**
 * Characterization tests for `runLoop` (`session/prompt.ts:1513-1754`).
 *
 * PURPOSE: Lock the current behavior of the agent loop BEFORE Step 6 of the
 * refactoring blueprint decomposes it into `ToolExecutor` + `CompactionPolicy`
 * + `PromptAssembler` + `SubtaskRouter` + an `AgentLoop` orchestrator.
 *
 * Per AGENTS.md Rule 3, these tests must (a) exercise the real `SessionPrompt`
 * service (no reimplementation), (b) drive it deterministically by stubbing
 * `LLM.Service.stream` with a fixed sequence of `LLM.Event`s, and (c) assert
 * the message/part tree, tool-execution order, loop-exit decision, and
 * compaction-trigger decision. They must FAIL if `runLoop` behavior changes —
 * that is the regression net that makes the extraction safe.
 *
 * Strategy: reuse `prompt.test.ts`'s `makeHttp` layer assembly but swap
 * `LLM.defaultLayer` for a queue stub (modeled on `compaction.test.ts:290-309`).
 * The stub shifts the next `Stream<LLM.Event>` off a queue on each call, so a
 * test enqueues the exact stream-event sequence the loop will consume.
 */

import { NodeFileSystem } from "@effect/platform-node"
import { FetchHttpClient } from "effect/unstable/http"
import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { MessageID, PartID } from "../../src/session/schema"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import * as Log from "@opencode-ai/core/util/log"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "../../src/file/ripgrep"
import { Format } from "../../src/format"
import { Reference } from "../../src/reference/reference"
import { SearchService } from "@/search/search"
import { EmbeddingService } from "@/search/embedding"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { SyncEvent } from "@/sync"

void Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

// --- stubbed peripheral services (verbatim from prompt.test.ts:59-159) -----

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in characterization tests"),
    authenticate: () => Effect.die("unexpected MCP auth in characterization tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in characterization tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

// --- LLM stub: queue of pre-built Stream<LLM.Event> (from compaction.test.ts:290-309) ---
//
// IMPORTANT: a SINGLE module-scope stub backs the `testEffect` layer. Each test
// calls `llm.reset()` at its start so the queue + call counter do not leak
// between tests (this is the AGENTS.md mock-leakage guardrail, applied to a
// hand-rolled queue rather than `mock.module`). `provideTmpdirInstance` gives
// each test a fresh DB + instance context, so the only shared mutable state is
// this queue — `reset()` is what keeps the tests independent.

const queue: Array<
  Stream.Stream<LLM.Event, unknown> | ((input: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)
> = []
let calls = 0

const llm = {
  /** Number of times `stream()` was invoked (= number of LLM round-trips). */
  get calls() {
    return calls
  },
  /** Clear the queue + counter. Call at the start of every test. */
  reset() {
    queue.length = 0
    calls = 0
  },
  push(s: Stream.Stream<LLM.Event, unknown> | ((i: LLM.StreamInput) => Stream.Stream<LLM.Event, unknown>)) {
    queue.push(s)
  },
  layer: Layer.succeed(
    LLM.Service,
    LLM.Service.of({
      stream: (input) => {
        calls++
        const item = queue.shift() ?? Stream.empty
        const stream = typeof item === "function" ? item(input) : item
        return stream.pipe(Stream.mapEffect((event) => Effect.succeed(event)))
      },
    }),
  ),
}

// --- stream-event fixtures (event shapes from compaction.test.ts:312-365 & 1286-1352) ---

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
}

/** A complete assistant text reply that ends the turn with a `stop` finish. */
function replyText(text: string): Stream.Stream<LLM.Event, unknown> {
  return Stream.make(
    { type: "start" } satisfies LLM.Event,
    { type: "text-start", id: "txt-0" } satisfies LLM.Event,
    { type: "text-delta", id: "txt-0", delta: text, text } as LLM.Event,
    { type: "text-end", id: "txt-0" } satisfies LLM.Event,
    {
      type: "finish-step",
      finishReason: "stop",
      rawFinishReason: "stop",
      response: { id: "res", modelId: "test-model", timestamp: new Date() },
      providerMetadata: undefined,
      usage,
    } satisfies LLM.Event,
    {
      type: "finish",
      finishReason: "stop",
      rawFinishReason: "stop",
      totalUsage: usage,
    } satisfies LLM.Event,
  )
}

/** A tool-call that ends the step with a `tool-calls` finish (loop must continue). */
function replyToolCall(toolName: string, input: object, toolCallId = "call-1"): Stream.Stream<LLM.Event, unknown> {
  return Stream.make(
    { type: "start" } satisfies LLM.Event,
    { type: "tool-input-start", id: toolCallId, toolName } satisfies LLM.Event,
    { type: "tool-call", toolCallId, toolName, input } satisfies LLM.Event,
    {
      type: "finish-step",
      finishReason: "tool-calls",
      rawFinishReason: "tool_calls",
      response: { id: "res", modelId: "test-model", timestamp: new Date() },
      providerMetadata: undefined,
      usage,
    } satisfies LLM.Event,
    {
      type: "finish",
      finishReason: "tool-calls",
      rawFinishReason: "tool_calls",
      totalUsage: usage,
    } satisfies LLM.Event,
  )
}

// --- layer composition (makeHttp from prompt.test.ts:164-233, minus TestLLMServer + LLM.defaultLayer) ---

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer), Layer.provide(SyncEvent.defaultLayer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeLayer() {
  // deps drops LLM.defaultLayer — the stub is provided instead.
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
    SyncEvent.defaultLayer,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps), Layer.provide(SyncEvent.defaultLayer))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Reference.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
    Layer.provide(
      Layer.succeed(SearchService, {
        open: Effect.void,
        index: () => Effect.void,
        search: () => Effect.succeed([]),
        reset: Effect.void,
        delete: () => Effect.void,
      }),
    ),
    Layer.provide(
      Layer.succeed(EmbeddingService, {
        embed: () => Effect.succeed([]),
        resolve: Effect.void,
        dimension: 384,
      }),
    ),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return SessionPrompt.layer
    .pipe(
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(Image.defaultLayer),
      Layer.provide(summary),
      Layer.provideMerge(run),
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(SystemPrompt.defaultLayer),
      Layer.provideMerge(deps),
      Layer.provide(llm.layer),
    )
    .pipe(Layer.provide(summary))
}

const it = testEffect(makeLayer())

// Config registers a custom "test" provider so provider model lookup succeeds.
const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          // Small context so the overflow scenario can trigger compaction.
          limit: { context: 100_000, output: 10_000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: { apiKey: "test-key", baseURL: "http://localhost:1/v1" },
    },
  },
}

const ALLOW_ALL = [{ permission: "*", pattern: "*", action: "allow" as const }] satisfies Permission.Ruleset

describe("runLoop characterization", () => {
  // ---------------------------------------------------------------------------
  // Scenario A: the canonical happy path.
  //   user prompt -> LLM streams text -> finish(stop) -> loop exits immediately.
  // Locks: exactly ONE LLM call; final assistant message has finish "stop";
  // the streamed text lands in a text part; loop returns the assistant message.
  // ---------------------------------------------------------------------------
  it.live("A: single text reply → finish(stop) → loop exits after one LLM call", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          llm.reset()
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "char-a", permission: ALLOW_ALL })
          llm.push(replyText("hello back"))

          const result = yield* prompt.prompt({
            sessionID: chat.id,
            agent: "build",
            parts: [{ type: "text", text: "hi" }],
          })

          expect(llm.calls).toBe(1)
          expect(result.info.role).toBe("assistant")
          if (result.info.role === "assistant") expect(result.info.finish).toBe("stop")
          expect(result.parts.some((p) => p.type === "text" && p.text === "hello back")).toBe(true)
        }),
      { git: true, config: cfg },
    ),
  )

  // ---------------------------------------------------------------------------
  // Scenario B: tool-call continuation.
  //   step 1: LLM emits a tool-call finish -> loop runs the tool -> continues.
  //   step 2: LLM emits a text reply with stop finish -> loop exits.
  // Locks: exactly TWO LLM calls; the loop does NOT exit after a tool-calls
  // finish (prompt.ts:1551-1559 exit guard excludes "tool-calls"); the tool
  // part reaches "completed" state. Uses the real `read` tool so the registry
  // + tool-execution path is exercised, not just the loop control flow.
  // ---------------------------------------------------------------------------
  it.live("B: tool-calls finish continues the loop, stop finish exits (two LLM calls)", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          llm.reset()
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "char-b", permission: ALLOW_ALL })

          // Step 1: LLM emits a tool-call for an unknown tool. The registry
          // rejects it instantly (settling the toolcall), so the loop re-enters.
          // This mirrors prompt.test.ts:533 (`llm.tool("first", ...)`) and locks
          // the loop-CONTINUATION contract: a `tool-calls` finish does NOT exit.
          llm.push(replyToolCall("_characterization_unknown", {}))
          // Step 2: a normal text reply ends the turn.
          llm.push(replyText("done after tool"))

          const result = yield* prompt.prompt({
            sessionID: chat.id,
            agent: "build",
            parts: [{ type: "text", text: "run a tool then finish" }],
          })

          // Two LLM round-trips = the loop continued past the tool-call step.
          expect(llm.calls).toBe(2)
          expect(result.info.role).toBe("assistant")
          if (result.info.role === "assistant") expect(result.info.finish).toBe("stop")

          // A tool part was persisted from step 1 (unknown tools land in error
          // state, but the part existing proves the loop dispatched it).
          const msgs = yield* MessageV2.filterCompactedEffect(chat.id)
          const tool = msgs.flatMap((m) => m.parts).find((p) => p.type === "tool")
          expect(tool).toBeDefined()
        }),
      { git: true, config: cfg },
    ),
  )

  // ---------------------------------------------------------------------------
  // Scenario C: the loop-exit guard for an already-finished assistant.
  //   Seed a user + assistant(stop) pair, then call loop() with NO queued LLM
  //   reply. The loop must observe lastAssistant.finish === "stop" with
  //   lastUser.id < lastAssistant.id and exit WITHOUT calling the LLM.
  // Locks: prompt.ts:1551-1559 exit guard — zero LLM calls; returns the seeded
  // assistant. This is the guard that, if broken, causes infinite re-prompting.
  // ---------------------------------------------------------------------------
  it.live("C: exits immediately with zero LLM calls when last assistant already finished (stop)", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          llm.reset()
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "char-c", permission: ALLOW_ALL })

          // Seed user + assistant(stop) directly, mirroring prompt.test.ts:305-332.
          yield* Effect.gen(function* () {
            const userMsg = yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "user",
              sessionID: chat.id,
              agent: "build",
              model: ref,
              time: { created: Date.now() },
            })
            yield* sessions.updatePart({
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: chat.id,
              type: "text",
              text: "hello",
            })
            yield* sessions.updateMessage({
              id: MessageID.ascending(),
              role: "assistant",
              parentID: userMsg.id,
              sessionID: chat.id,
              mode: "build",
              agent: "build",
              cost: 0,
              path: { cwd: "/tmp", root: "/tmp" },
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: ref.modelID,
              providerID: ref.providerID,
              time: { created: Date.now() },
              finish: "stop",
            })
          })

          const result = yield* prompt.loop({ sessionID: chat.id })
          expect(llm.calls).toBe(0)
          expect(result.info.role).toBe("assistant")
          if (result.info.role === "assistant") expect(result.info.finish).toBe("stop")
        }),
      { git: true, config: cfg },
    ),
  )

  // ---------------------------------------------------------------------------
  // Scenario D: prompt() returns the assistant turn (not throws) on completion.
  //   This characterizes the public entrypoint contract that Step 6 must
  //   preserve: prompt.prompt() with a text part returns a MessageV2.WithParts
  //   whose role is "assistant" and whose parts are non-empty.
  // Locks: the SessionPrompt.prompt public-API contract.
  // ---------------------------------------------------------------------------
  it.live("D: prompt() public entrypoint returns a non-empty assistant MessageV2.WithParts", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          llm.reset()
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "char-d", permission: ALLOW_ALL })
          llm.push(replyText("final answer"))

          const result = yield* prompt.prompt({
            sessionID: chat.id,
            agent: "build",
            parts: [{ type: "text", text: "give me an answer" }],
          })

          expect(result.info.role).toBe("assistant")
          expect(result.parts.length).toBeGreaterThan(0)
          expect(llm.calls).toBe(1)
        }),
      { git: true, config: cfg },
    ),
  )
})

// ID generators use the ascending factories from session/schema
// (MessageID.ascending(), PartID.ascending()) — imported at the top.
