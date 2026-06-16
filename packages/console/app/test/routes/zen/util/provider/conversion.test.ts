import { describe, expect, test } from "bun:test"
import { fromOpenaiRequest } from "../../../../../src/routes/zen/util/provider/openai"
import { fromAnthropicRequest } from "../../../../../src/routes/zen/util/provider/anthropic"
import { fromOaCompatibleRequest } from "../../../../../src/routes/zen/util/provider/openai-compatible"

describe("provider conversion — fromOpenaiRequest", () => {
  test("converts simple text messages", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    }
    const result = fromOpenaiRequest(body)
    expect(result.model).toBe("gpt-4o")
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toEqual({ role: "user", content: "hello" })
  })

  test("passes through tool_choice unchanged", () => {
    const body = {
      model: "gpt-4o",
      messages: [],
      tool_choice: "auto",
    }
    const result = fromOpenaiRequest(body)
    expect(result.tool_choice).toBe("auto")
  })

  test("normalizes max_tokens to max_output_tokens", () => {
    const body = { model: "gpt-4o", messages: [], max_tokens: 1024 }
    const result = fromOpenaiRequest(body)
    expect(result.max_tokens).toBe(1024)
  })

  test("maps assistant messages with tool_calls", () => {
    const body = {
      model: "gpt-4o",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "tc_1", type: "function", function: { name: "read_file", arguments: '{"path":"x"}' } }],
        },
      ],
    }
    const result = fromOpenaiRequest(body)
    expect(result.messages[0].tool_calls).toHaveLength(1)
    expect(result.messages[0].tool_calls![0].function.name).toBe("read_file")
  })

  test("handles system role", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "system", content: "You are helpful." }],
    }
    const result = fromOpenaiRequest(body)
    expect(result.messages[0]).toEqual({ role: "system", content: "You are helpful." })
  })

  test("handles tool result messages", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "tool", tool_call_id: "tc_1", content: "file contents" }],
    }
    const result = fromOpenaiRequest(body)
    expect(result.messages[0]).toEqual({ role: "tool", tool_call_id: "tc_1", content: "file contents" })
  })
})

describe("provider conversion — fromAnthropicRequest", () => {
  test("converts system prompts and text messages", () => {
    const body = {
      model: "claude-3-5-sonnet-20240620",
      system: [{ type: "text", text: "You are helpful." }],
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    }
    const result = fromAnthropicRequest(body)
    expect(result.model).toBe("claude-3-5-sonnet-20240620")
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toEqual({ role: "system", content: "You are helpful." })
    expect(result.messages[1]).toEqual({ role: "user", content: "hello" })
  })

  test("maps tool_use blocks to tool_calls", () => {
    const body = {
      model: "claude-3-5-sonnet-20240620",
      messages: [
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "tc_1", name: "read_file", input: { path: "x" } }],
        },
      ],
    }
    const result = fromAnthropicRequest(body)
    const tc = result.messages[0].tool_calls![0]
    expect(tc.function.name).toBe("read_file")
    expect(tc.function.arguments).toContain("path")
  })

  test("maps tool_result blocks to tool messages", () => {
    const body = {
      model: "claude-3-5-sonnet-20240620",
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tc_1", content: "result text" }],
        },
      ],
    }
    const result = fromAnthropicRequest(body)
    expect(result.messages[0]).toEqual({ role: "tool", tool_call_id: "tc_1", content: "result text" })
  })
})

describe("provider conversion — fromOaCompatibleRequest", () => {
  test("converts simple text messages", () => {
    const body = {
      model: "custom-model",
      messages: [{ role: "user", content: "hi" }],
    }
    const result = fromOaCompatibleRequest(body)
    expect(result.model).toBe("custom-model")
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toEqual({ role: "user", content: "hi" })
  })

  test("maps tool_calls", () => {
    const body = {
      model: "custom-model",
      messages: [
        {
          role: "assistant",
          tool_calls: [{ id: "tc_2", type: "function", function: { name: "search", arguments: '{"q":"test"}' } }],
        },
      ],
    }
    const result = fromOaCompatibleRequest(body)
    expect(result.messages[0].tool_calls![0].function.name).toBe("search")
  })
})
