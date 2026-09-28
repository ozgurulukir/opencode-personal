import { describe, expect, test } from "bun:test"
import { SystemPrompt } from "@/session/system"

function modelWith(id: string) {
  return {
    api: { id, npm: "@ai-sdk/openai", name: id },
    id,
    providerID: "test",
    capabilities: {
      reasoning: false,
      temperature: true,
      input: {},
      output: {},
      modalities: { input: [], output: [] },
      interleaved: false,
    },
    limit: { context: 128000, output: 4096, input: 127000 },
    options: {},
    release_date: "",
    headers: {},
  } as any
}

describe("SystemPrompt.provider — matchDelta", () => {
  test("gpt-4 matches beast delta", () => {
    const result = SystemPrompt.provider(modelWith("gpt-4"))
    expect(result.prefix).toContain("Autonomous mode")
  })

  test("gpt-4o matches beast delta", () => {
    const result = SystemPrompt.provider(modelWith("gpt-4o"))
    expect(result.prefix).toContain("Autonomous mode")
  })

  test("o1 matches beast delta", () => {
    const result = SystemPrompt.provider(modelWith("o1"))
    expect(result.prefix).toContain("Autonomous mode")
  })

  test("o3 matches beast delta", () => {
    const result = SystemPrompt.provider(modelWith("o3"))
    expect(result.prefix).toContain("Autonomous mode")
  })

  test("gpt-3.5-turbo matches gpt delta", () => {
    const result = SystemPrompt.provider(modelWith("gpt-3.5-turbo"))
    expect(result.prefix).toContain("Editing approach")
  })

  test("gpt-5.2-codex matches codex delta", () => {
    const result = SystemPrompt.provider(modelWith("gpt-5.2-codex"))
    expect(result.prefix).toContain("Editing constraints")
  })

  test("gemini-2.0-flash matches gemini delta", () => {
    const result = SystemPrompt.provider(modelWith("gemini-2.0-flash"))
    expect(result.prefix).toContain("Conventions")
  })

  test("claude-sonnet-4 matches anthropic delta", () => {
    const result = SystemPrompt.provider(modelWith("claude-sonnet-4"))
    expect(result.prefix).toContain("TodoWrite")
  })

  test("trinity matches trinity delta", () => {
    const result = SystemPrompt.provider(modelWith("trinity"))
    expect(result.prefix).toContain("Extreme conciseness")
  })

  test("kimi matches kimi delta", () => {
    const result = SystemPrompt.provider(modelWith("kimi"))
    expect(result.prefix).toContain("Prompt and tool use")
  })

  test("qwen matches qwen delta", () => {
    const result = SystemPrompt.provider(modelWith("qwen"))
    expect(result.prefix).toContain("Reasoning and thinking")
  })

  test("glm matches glm delta", () => {
    const result = SystemPrompt.provider(modelWith("glm"))
    expect(result.prefix).toContain("Reasoning and thinking")
  })

  test("deepseek matches deepseek delta", () => {
    const result = SystemPrompt.provider(modelWith("deepseek"))
    expect(result.prefix).toContain("Reasoning and thinking")
  })

  test("unknown-model matches default delta", () => {
    const result = SystemPrompt.provider(modelWith("unknown-model"))
    expect(result.prefix).toContain("Default delta")
  })

  test("gpt-4o-beast matches beast delta", () => {
    const result = SystemPrompt.provider(modelWith("gpt-4o-beast"))
    expect(result.prefix).toContain("Autonomous mode")
  })

  // Git-safety rules moved to core.txt (I5), so the shared section must appear
  // in every provider's prefix — including where the delta-local copy was removed.
  test("unknown-model prefix includes Git safety from core", () => {
    const result = SystemPrompt.provider(modelWith("unknown-model"))
    expect(result.prefix).toContain("Git safety")
  })

  test("gpt prefix includes Git safety from core", () => {
    const result = SystemPrompt.provider(modelWith("gpt-3.5-turbo"))
    expect(result.prefix).toContain("Git safety")
  })

  test("codex prefix includes Git safety from core", () => {
    const result = SystemPrompt.provider(modelWith("gpt-5.2-codex"))
    expect(result.prefix).toContain("Git safety")
  })
})
