import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { command, type CommandDeps } from "../../src/session/loop/command"
import type { CommandInput, PromptInput } from "../../src/session/prompt"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"
import type { Agent } from "../../src/agent/agent"
import type { Command } from "../../src/command"
import type { Provider } from "../../src/provider/provider"

const ref = { providerID: ProviderID.make("test"), modelID: ModelID.make("test-model") }

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

// Captures the parts array that command() assembles and passes to deps.prompt.
// mode controls agent.mode so the isSubtask branch can be exercised both ways.
function makeDeps(captured: { input?: PromptInput }, mode: Agent.Info["mode"] = "subagent"): CommandDeps {
  const buildAgent: Agent.Info = {
    name: "build",
    mode,
    permission: [],
    options: {},
  }
  const cmd: Command.Info = {
    name: "review",
    description: "review changes",
    source: "command",
    template: "Review the changes", // no !`...` blocks, no $placeholders
    hints: [],
    // subtask intentionally undefined → isSubtask via agent.mode === "subagent"
  }
  return {
    commands: { get: () => Effect.succeed(cmd), list: () => Effect.succeed([]) },
    agents: {
      get: (name) => Effect.succeed({ ...buildAgent, name }),
      list: () => Effect.succeed([buildAgent]),
      defaultAgent: () => Effect.succeed("build"),
      // Never called on this path; die loudly if a future change routes through it.
      generate: () => Effect.die("unused"),
    },
    // Only getModel is called (input.model set → currentModel never runs);
    // config/sessions likewise never called — stubs are type-satisfiers only.
    provider: { getModel: () => Effect.succeed(dummyModel) } as unknown as Provider.Interface,
    config: {} as CommandDeps["config"], // never called: template has no shell blocks
    sessions: {} as CommandDeps["sessions"], // never called: input.model short-circuits currentModel
    plugin: {
      trigger: (_n, _i, output) => Effect.succeed(output),
      list: () => Effect.succeed([]),
      init: () => Effect.void,
    },
    bus: { publish: () => Effect.void } as unknown as CommandDeps["bus"],
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) => {
      captured.input = input
      const id = MessageID.ascending()
      return Effect.succeed({
        info: {
          id,
          role: "assistant",
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
          finish: "stop",
        },
        parts: [
          { id: PartID.ascending(), messageID: id, sessionID: input.sessionID, type: "text" as const, text: "stub output" },
        ],
      } satisfies MessageV2.WithParts) // same reply() shape as subtask.test.ts / task.test.ts
    },
  } satisfies CommandDeps
}

describe("session.loop.command", () => {
  test("subtask command forwards caller prompt parts alongside the synthetic subtask part", async () => {
    const captured: { input?: PromptInput } = {}
    const callerParts = [
      { type: "text" as const, text: "caller prompt text" },
      { type: "file" as const, mime: "text/plain", filename: "notes.txt", url: "file:///tmp/notes.txt" },
    ]
    const input: CommandInput = {
      sessionID: SessionID.make("ses_cmd_test"),
      command: "review",
      arguments: "",
      agent: "build",
      model: "test/test-model",
      // CommandInput.parts is typed file-only (prompt.ts:379-392); command() forwards
      // the array opaquely, so a text part is included to pin type-agnostic passthrough.
      parts: callerParts as unknown as CommandInput["parts"],
    }

    await Effect.runPromise(command(makeDeps(captured), input))

    const parts = captured.input!.parts
    expect(parts).toHaveLength(1 + callerParts.length)
    // 1. Synthetic subtask part comes FIRST with template-derived prompt
    expect(parts[0]).toMatchObject({
      type: "subtask",
      agent: "build",
      command: "review",
      description: "review changes",
      model: { providerID: "test", modelID: "test-model" },
      prompt: "Review the changes",
    })
    // 2. Caller parts follow IN ORDER, by identity (spread preserves references)
    expect(parts[1]).toBe(callerParts[0]) // text part
    expect(parts[2]).toBe(callerParts[1]) // file part
    // 3. Sanity on the rest of the prompt call (cheap, pins userAgent/userModel)
    expect(captured.input!.agent).toBe("build")
    expect(captured.input!.model).toEqual(ref)
  })

  test("non-subtask command forwards template parts followed by caller parts without a synthetic subtask", async () => {
    const captured: { input?: PromptInput } = {}
    const callerParts = [
      { type: "text" as const, text: "caller prompt text" },
      { type: "file" as const, mime: "text/plain", filename: "notes.txt", url: "file:///tmp/notes.txt" },
    ]
    const input: CommandInput = {
      sessionID: SessionID.make("ses_cmd_test"),
      command: "review",
      arguments: "",
      agent: "build",
      model: "test/test-model",
      parts: callerParts as unknown as CommandInput["parts"],
    }

    // mode "primary" + cmd.subtask undefined → isSubtask === false
    await Effect.runPromise(command(makeDeps(captured, "primary"), input))

    const parts = captured.input!.parts
    expect(parts).toHaveLength(1 + callerParts.length)
    // Template-derived text part comes first (resolvePromptParts stub shape)
    expect(parts[0]).toMatchObject({ type: "text", text: "Review the changes" })
    // Caller parts follow IN ORDER, by identity
    expect(parts[1]).toBe(callerParts[0])
    expect(parts[2]).toBe(callerParts[1])
    // Synthetic subtask part must be ABSENT on the non-subtask branch
    expect(parts.some((p) => p.type === "subtask")).toBe(false)
  })
})
