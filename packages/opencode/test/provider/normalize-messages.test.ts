import { describe, expect, test } from "bun:test"
import { ProviderTransform } from "@/provider/transform"
import { ModelID, ProviderID } from "../../src/provider/schema"

describe("ProviderTransform.message — Mistral tool-call ID scrubbing", () => {
  const mistralModel = {
    id: "mistral/mistral-large",
    providerID: "mistral",
    api: {
      id: "mistral-large",
      url: "https://api.mistral.ai",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Mistral Large",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("scrubs non-alphanumeric chars from tool-call IDs (first 9 alphanumeric, padded)", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_abc-123!",
            toolName: "bash",
            input: { command: "echo hello" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {}) as any[]

    expect(result[0].content[0].toolCallId).toBe("callabc12")
  })

  test("inserts synthetic assistant message between tool and user messages", () => {
    const msgs = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call_abc",
            toolName: "bash",
            output: { type: "text", value: "done" },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "text", text: "What next?" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, mistralModel, {})

    expect(result).toHaveLength(3)
    expect(result[0].role).toBe("tool")
    expect(result[1].role).toBe("assistant")
    expect(result[1].content).toEqual([{ type: "text", text: "Done." }])
    expect(result[2].role).toBe("user")
  })
})

describe("ProviderTransform.message — Claude tool-call ID scrubbing", () => {
  const claudeModel = {
    id: "anthropic/claude-sonnet-4",
    providerID: "anthropic",
    api: {
      id: "claude-sonnet-4",
      url: "https://api.anthropic.com",
      npm: "@ai-sdk/anthropic",
    },
    name: "Claude Sonnet 4",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("replaces non-alphanumeric chars with underscore in assistant tool-call IDs", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call_123@#$",
            toolName: "read",
            input: { filePath: "/test" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, claudeModel, {}) as any[]

    expect(result[0].content[0].toolCallId).toBe("call_123___")
  })

  test("scrubs tool-result IDs in tool-role messages", () => {
    const msgs = [
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "abc!123",
            toolName: "read",
            output: { type: "text", value: "ok" },
          },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, claudeModel, {}) as any[]

    // "abc!123" -> ! replaced with _ -> "abc_123"
    expect(result[0].content[0].toolCallId).toBe("abc_123")
  })
})

describe("ProviderTransform.message — DeepSeek reasoning injection", () => {
  const deepseekModel = {
    id: "deepseek/deepseek-chat",
    providerID: "deepseek",
    api: {
      id: "deepseek-chat",
      url: "https://api.deepseek.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "DeepSeek Chat",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2023-04-01",
  } as any

  test("appends empty reasoning part when assistant message has no reasoning", () => {
    const msgs = [
      {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, deepseekModel, {})

    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Hello" })
    expect(result[0].content[1]).toEqual({ type: "reasoning", text: "" })
  })

  test("does not add duplicate reasoning when assistant already has reasoning", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Thinking..." },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, deepseekModel, {})

    // Should have exactly 2 parts: reasoning + text (no duplicate reasoning)
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0]).toEqual({ type: "reasoning", text: "Thinking..." })
    expect(result[0].content[1]).toEqual({ type: "text", text: "Answer" })
  })
})

describe("ProviderTransform.message — interleaved reasoning extraction", () => {
  const interleavedModel = {
    id: "deepseek/deepseek-chat",
    providerID: "deepseek",
    api: {
      id: "deepseek-chat",
      url: "https://api.deepseek.com",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "DeepSeek Chat",
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: { field: "reasoning_content" },
    },
    cost: { input: 0.001, output: 0.002, cache: { read: 0.0001, write: 0.0002 } },
    limit: { context: 128000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
    release_date: "2023-04-01",
  } as any

  test("extracts reasoning parts into providerOptions and removes from content", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "Let me think..." },
          { type: "text", text: "Here is the answer" },
          { type: "reasoning", text: "More thinking" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, interleavedModel, {})

    // Reasoning parts should be removed from content
    expect(result[0].content).toHaveLength(1)
    expect(result[0].content[0]).toEqual({ type: "text", text: "Here is the answer" })

    // Reasoning text should be in providerOptions
    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("Let me think...More thinking")
  })

  test("always sets reasoning_content field even when reasoning text is empty", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "" },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, interleavedModel, {})

    expect(result[0].providerOptions?.openaiCompatible?.reasoning_content).toBe("")
  })
})

describe("ProviderTransform.message — Bedrock reasoning preservation", () => {
  const bedrockModel = {
    id: "amazon-bedrock/anthropic.claude-sonnet-4",
    providerID: "amazon-bedrock",
    api: {
      id: "anthropic.claude-sonnet-4",
      url: "https://bedrock-runtime.us-east-1.amazonaws.com",
      npm: "@ai-sdk/amazon-bedrock",
    },
    name: "Claude Sonnet 4",
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    cost: { input: 0.003, output: 0.015, cache: { read: 0.0003, write: 0.00375 } },
    limit: { context: 200000, output: 8192 },
    status: "active",
    options: {},
    headers: {},
  } as any

  test("preserves reasoning parts with bedrock signature (not filtered as empty)", () => {
    const msgs = [
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "",
            providerOptions: {
              bedrock: { signature: "sig_abc123" },
            },
          },
          { type: "text", text: "Answer" },
        ],
      },
    ] as any[]

    const result = ProviderTransform.message(msgs, bedrockModel, {}) as any[]

    // The reasoning part with bedrock signature should be preserved
    expect(result[0].content).toHaveLength(2)
    expect(result[0].content[0].type).toBe("reasoning")
    expect(result[0].content[0].providerOptions?.bedrock?.signature).toBe("sig_abc123")
    expect(result[0].content[1]).toEqual({ type: "text", text: "Answer" })
  })
})
