import { OpenAIResponsesLanguageModel } from "@/provider/sdk/copilot/responses/openai-responses-language-model"
import { describe, test, expect, mock } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"

async function convertReadableStreamToArray<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader()
  const result: T[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result.push(value)
  }
  return result
}

const TEST_PROMPT: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "Hello" }] }]

const FIXTURES = {
  basicText: [
    `data: {"type":"response.created","response":{"id":"resp-1","created_at":1677652288,"model":"gpt-4o"}}`,
    `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg-1"}}`,
    `data: {"type":"response.output_text.delta","item_id":"msg-1","delta":"Hello"}`,
    `data: {"type":"response.output_text.delta","item_id":"msg-1","delta":" world"}`,
    `data: {"type":"response.output_text.delta","item_id":"msg-1","delta":"!"}`,
    `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg-1"}}`,
    `data: {"type":"response.completed","response":{"usage":{"total_tokens":15,"input_tokens":10,"output_tokens":5,"output_tokens_details":{"reasoning_tokens":0}}}}`,
    `data: [DONE]`,
  ],

  reasoningWithToolCalls: [
    `data: {"type":"response.created","response":{"id":"resp-2","created_at":1677652288,"model":"gpt-4o"}}`,
    `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"reasoning","id":"rsn-1"}}`,
    `data: {"type":"response.reasoning_summary_part.added","item_id":"rsn-1","summary_index":0}`,
    `data: {"type":"response.reasoning_summary_text.delta","item_id":"rsn-1","summary_index":0,"delta":"Thinking about files"}`,
    `data: {"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"rsn-1","encrypted_content":"opaque-enc-123"}}`,
    `data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fn-1","call_id":"call_abc123","name":"read_file","arguments":""}}`,
    `data: {"type":"response.function_call_arguments.delta","item_id":"fn-1","output_index":1,"delta":"{\\"filePath\\":\\"/README.md\\"}"}`,
    `data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","id":"fn-1","call_id":"call_abc123","name":"read_file","arguments":"{\\"filePath\\":\\"/README.md\\"}","status":"completed"}}`,
    `data: {"type":"response.completed","response":{"usage":{"total_tokens":50,"input_tokens":30,"output_tokens":20,"output_tokens_details":{"reasoning_tokens":10}}}}`,
    `data: [DONE]`,
  ],

  errorStream: [
    `data: {"type":"response.created","response":{"id":"resp-err","created_at":1677652288,"model":"gpt-4o"}}`,
    `data: {"type":"error","code":"rate_limit_exceeded","message":"Rate limit exceeded","sequence_number":1}`,
  ],
}

function createMockFetch(chunks: string[], status = 200) {
  return mock(async () => {
    if (status !== 200) {
      return new Response(JSON.stringify({ error: { message: "Internal Server Error", type: "server_error" } }), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    }

    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk + "\n\n"))
        }
        controller.close()
      },
    })

    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    })
  })
}

function createModel(fetchFn: typeof globalThis.fetch) {
  return new OpenAIResponsesLanguageModel("gpt-4o", {
    provider: "copilot.responses",
    url: () => "https://api.test.com/responses",
    headers: () => ({ Authorization: "Bearer test-token" }),
    fetch: fetchFn,
  })
}

describe("OpenAIResponsesLanguageModel doStream", () => {
  test("should stream text deltas", async () => {
    const mockFetch = createMockFetch(FIXTURES.basicText)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    const textParts = parts.filter(
      (p) => p.type === "text-start" || p.type === "text-delta" || p.type === "text-end" || p.type === "finish",
    )

    expect(textParts).toMatchObject([
      { type: "text-start", id: "msg-1" },
      { type: "text-delta", id: "msg-1", delta: "Hello" },
      { type: "text-delta", id: "msg-1", delta: " world" },
      { type: "text-delta", id: "msg-1", delta: "!" },
      { type: "text-end", id: "msg-1" },
      { type: "finish", finishReason: { unified: "stop" } },
    ])
  })

  test("should stream reasoning with tool calls and usage", async () => {
    const mockFetch = createMockFetch(FIXTURES.reasoningWithToolCalls)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)

    const reasoningParts = parts.filter(
      (p) => p.type === "reasoning-start" || p.type === "reasoning-delta" || p.type === "reasoning-end",
    )

    expect(reasoningParts).toMatchObject([
      { type: "reasoning-start", id: "rsn-1:0" },
      { type: "reasoning-delta", id: "rsn-1:0", delta: "Thinking about files" },
      {
        type: "reasoning-end",
        id: "rsn-1:0",
        providerMetadata: {
          openai: {
            reasoningEncryptedContent: "opaque-enc-123",
          },
        },
      },
    ])

    const toolParts = parts.filter(
      (p) => p.type === "tool-input-start" || p.type === "tool-input-delta" || p.type === "tool-call",
    )

    expect(toolParts).toMatchObject([
      { type: "tool-input-start", id: "call_abc123", toolName: "read_file" },
      { type: "tool-input-delta", id: "call_abc123", delta: '{"filePath":"/README.md"}' },
      {
        type: "tool-call",
        toolCallId: "call_abc123",
        toolName: "read_file",
        input: '{"filePath":"/README.md"}',
      },
    ])

    const finishPart = parts.find((p) => p.type === "finish")
    expect(finishPart).toBeDefined()
    if (finishPart && finishPart.type === "finish") {
      expect(finishPart.usage).toMatchObject({
        inputTokens: { total: 30 },
        outputTokens: { total: 20, reasoning: 10 },
      })
    }
  })

  test("should handle error in event stream", async () => {
    const mockFetch = createMockFetch(FIXTURES.errorStream)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: false,
    })

    const parts = await convertReadableStreamToArray(stream)
    const errorPart = parts.find((p) => p.type === "error")
    expect(errorPart).toBeDefined()
  })

  test("should handle failed HTTP responses", async () => {
    const mockFetch = createMockFetch([], 500)
    const model = createModel(mockFetch)

    await expect(
      model.doStream({
        prompt: TEST_PROMPT,
        includeRawChunks: false,
      }),
    ).rejects.toThrow()
  })

  test("should include raw chunks when requested", async () => {
    const mockFetch = createMockFetch(FIXTURES.basicText)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      includeRawChunks: true,
    })

    const parts = await convertReadableStreamToArray(stream)
    const rawParts = parts.filter((p) => p.type === "raw")
    expect(rawParts.length).toBeGreaterThan(0)
  })

  test("should emit stream-start with warnings for unsupported options", async () => {
    const mockFetch = createMockFetch(FIXTURES.basicText)
    const model = createModel(mockFetch)

    const { stream } = await model.doStream({
      prompt: TEST_PROMPT,
      topK: 50,
      seed: 42,
    })

    const parts = await convertReadableStreamToArray(stream)
    const startPart = parts.find((p) => p.type === "stream-start")
    expect(startPart).toBeDefined()
    if (startPart && startPart.type === "stream-start") {
      expect(startPart.warnings).toEqual([
        { type: "unsupported", feature: "topK" },
        { type: "unsupported", feature: "seed" },
      ])
    }
  })

  test("should format tools into OpenAI Responses format", async () => {
    let capturedBody: any
    const mockFetch = mock(async (req: any, init: any) => {
      capturedBody = JSON.parse(init.body)
      return new Response(
        new ReadableStream({
          start(c) {
            for (const chunk of FIXTURES.basicText) {
              c.enqueue(new TextEncoder().encode(chunk + "\n\n"))
            }
            c.close()
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      )
    })
    const model = createModel(mockFetch)

    await model.doStream({
      prompt: TEST_PROMPT,
      tools: [
        {
          type: "function",
          name: "calculate",
          description: "Calculates an expression",
          inputSchema: {
            type: "object",
            properties: { expression: { type: "string" } },
            required: ["expression"],
          },
        },
      ],
    })

    expect(capturedBody).toBeDefined()
    expect(capturedBody.tools).toEqual([
      {
        type: "function",
        name: "calculate",
        description: "Calculates an expression",
        parameters: {
          type: "object",
          properties: { expression: { type: "string" } },
          required: ["expression"],
        },
        strict: false,
      },
    ])
  })
})
