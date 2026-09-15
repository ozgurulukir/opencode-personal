import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
import { processMessage } from "../../src/acp/message-replay"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"

function createTestAgent() {
  const sessionUpdates: any[] = []
  const connection = {
    async sessionUpdate(params: any) {
      sessionUpdates.push(params)
    },
    async requestPermission() {
      return { outcome: { outcome: "selected", optionId: "once" } } as any
    },
  } as unknown as AgentSideConnection

  const agent = new ACP.Agent(connection, {
    sdk: {} as any,
  })

  const shellSnapshots = new Map<string, string>()
  const toolStarts = new Set<string>()

  return { agent, connection, sessionUpdates, shellSnapshots, toolStarts }
}

const SESSION_ID = "ses_1"

function assistantMessage(content: Record<string, unknown>[], overrides: Record<string, unknown> = {}): any {
  return {
    id: "msg_1",
    type: "assistant",
    agent: "build",
    model: { id: "test-model", providerID: "test", variant: "default" },
    time: { created: Date.now() },
    content,
    ...overrides,
  }
}

function userMessage(overrides: Record<string, unknown> = {}): any {
  return {
    id: "msg_1",
    type: "user",
    text: "hello world",
    files: [],
    agents: [],
    agent: "build",
    model: { id: "test-model", providerID: "test", variant: "default" },
    time: { created: Date.now() },
    ...overrides,
  }
}

function textContent(overrides: Record<string, unknown> = {}): any {
  return {
    type: "text",
    text: "hello world",
    ...overrides,
  }
}

function fileAttachment(overrides: Record<string, unknown> = {}): any {
  return {
    uri: "file:///tmp/test.txt",
    name: "test.txt",
    mime: "text/plain",
    ...overrides,
  }
}

function reasoningContent(overrides: Record<string, unknown> = {}): any {
  return {
    type: "reasoning",
    id: "reasoning_1",
    text: "thinking...",
    ...overrides,
  }
}

function toolContent(state: string, overrides: Record<string, unknown> = {}): any {
  const { state: stateOverride, ...rest } = overrides
  return {
    type: "tool",
    id: "call_1",
    name: "read",
    time: { created: Date.now() },
    state: {
      status: state,
      input: { filePath: "/tmp/test.txt" },
      ...(state === "running" ? { structured: {}, content: [] } : {}),
      ...(state === "completed" ? { structured: {}, content: [{ type: "text", text: "file content" }] } : {}),
      ...(state === "error" ? { structured: {}, content: [], error: { type: "unknown", message: "boom" } } : {}),
      ...(typeof stateOverride === "object" && stateOverride !== null ? stateOverride : {}),
    },
    ...rest,
  }
}

describe("Agent.processMessage", () => {
  test("ignores non-replayable message types", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(
      connection,
      shellSnapshots,
      toolStarts,
      SESSION_ID,
      { id: "msg_1", type: "synthetic", sessionID: SESSION_ID, text: "note", time: { created: Date.now() } },
    )
    expect(sessionUpdates).toHaveLength(0)
  })

  test("sends agent_message_chunk for assistant text content", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(connection, shellSnapshots, toolStarts, SESSION_ID, assistantMessage([textContent({ text: "hi" })]))
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("agent_message_chunk")
    expect(sessionUpdates[0].update.content).toEqual({ type: "text", text: "hi" })
  })

  test("sends user_message_chunk for user text", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(connection, shellSnapshots, toolStarts, SESSION_ID, userMessage({ text: "hello" }))
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("user_message_chunk")
  })

  test("skips empty text content", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(connection, shellSnapshots, toolStarts, SESSION_ID, assistantMessage([textContent({ text: "" })]))
    expect(sessionUpdates).toHaveLength(0)
  })

  test("sends resource_link for file:// attachments", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(
      connection,
      shellSnapshots,
      toolStarts,
      SESSION_ID,
      userMessage({ text: "", files: [fileAttachment()] }),
    )
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("user_message_chunk")
    expect(sessionUpdates[0].update.content).toEqual({
      type: "resource_link",
      uri: "file:///tmp/test.txt",
      name: "test.txt",
      mimeType: "text/plain",
    })
  })

  test("sends image block for data:image/* attachments", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(
      connection,
      shellSnapshots,
      toolStarts,
      SESSION_ID,
      userMessage({
        text: "",
        files: [fileAttachment({ uri: "data:image/png;base64,abc123", mime: "image/png" })],
      }),
    )
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.content).toEqual({
      type: "image",
      mimeType: "image/png",
      data: "abc123",
      uri: expect.stringContaining("test.txt"),
    })
  })

  test("sends resource with text for data:text/* attachments", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(
      connection,
      shellSnapshots,
      toolStarts,
      SESSION_ID,
      userMessage({
        text: "",
        files: [fileAttachment({ uri: "data:text/plain;base64,SGVsbG8=", mime: "text/plain" })],
      }),
    )
    expect(sessionUpdates).toHaveLength(1)
    const content = sessionUpdates[0].update.content
    expect(content.type).toBe("resource")
    expect((content as any).resource.text).toBe("Hello")
    expect((content as any).resource.mimeType).toBe("text/plain")
  })

  test("decodes URL-encoded data resources", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(
      connection,
      shellSnapshots,
      toolStarts,
      SESSION_ID,
      userMessage({
        text: "",
        files: [fileAttachment({ uri: "data:text/plain,Hello%20ACP", mime: "text/plain" })],
      }),
    )
    expect(sessionUpdates).toHaveLength(1)
    expect((sessionUpdates[0].update.content as any).resource.text).toBe("Hello ACP")
  })

  test("sends resource with blob for binary data attachments", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(
      connection,
      shellSnapshots,
      toolStarts,
      SESSION_ID,
      userMessage({
        text: "",
        files: [fileAttachment({ uri: "data:application/pdf;base64,abc123", mime: "application/pdf" })],
      }),
    )
    expect(sessionUpdates).toHaveLength(1)
    const content = sessionUpdates[0].update.content
    expect(content.type).toBe("resource")
    expect((content as any).resource.blob).toBe("abc123")
    expect((content as any).resource.mimeType).toBe("application/pdf")
  })

  test("sends agent_thought_chunk for reasoning content", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(connection, shellSnapshots, toolStarts, SESSION_ID, assistantMessage([reasoningContent()]))
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("agent_thought_chunk")
    expect(sessionUpdates[0].update.content).toEqual({ type: "text", text: "thinking..." })
  })

  test("sends tool_call for pending tool content", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(connection, shellSnapshots, toolStarts, SESSION_ID, assistantMessage([toolContent("pending")]))
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("tool_call")
    expect(sessionUpdates[0].update.status).toBe("pending")
  })

  test("sends tool_call then tool_call_update for running tool content", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(connection, shellSnapshots, toolStarts, SESSION_ID, assistantMessage([toolContent("running")]))
    expect(sessionUpdates).toHaveLength(2)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("tool_call")
    expect(sessionUpdates[0].update.status).toBe("pending")
    expect(sessionUpdates[1].update.sessionUpdate).toBe("tool_call_update")
    expect(sessionUpdates[1].update.status).toBe("in_progress")
  })

  test("sends tool_call then tool_call_update for completed tool content", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(connection, shellSnapshots, toolStarts, SESSION_ID, assistantMessage([toolContent("completed")]))
    expect(sessionUpdates).toHaveLength(2)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("tool_call")
    expect(sessionUpdates[0].update.status).toBe("pending")
    expect(sessionUpdates[1].update.sessionUpdate).toBe("tool_call_update")
    expect(sessionUpdates[1].update.status).toBe("completed")
    expect(sessionUpdates[1].update.toolCallId).toBe("call_1")
  })

  test("sends tool_call then tool_call_update for error tool content", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(connection, shellSnapshots, toolStarts, SESSION_ID, assistantMessage([toolContent("error")]))
    expect(sessionUpdates).toHaveLength(2)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("tool_call")
    expect(sessionUpdates[0].update.status).toBe("pending")
    expect(sessionUpdates[1].update.sessionUpdate).toBe("tool_call_update")
    expect(sessionUpdates[1].update.status).toBe("failed")
    expect(sessionUpdates[1].update.content).toEqual([{ type: "content", content: { type: "text", text: "boom" } }])
  })

  test("sends plan update when todowrite tool completes with valid output", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(
      connection,
      shellSnapshots,
      toolStarts,
      SESSION_ID,
      assistantMessage([
        toolContent("completed", {
          id: "call_1",
          name: "todowrite",
          state: {
            status: "completed",
            input: {},
            structured: {},
            content: [{ type: "text", text: JSON.stringify([{ content: "task 1", status: "pending", priority: "medium" }]) }],
          },
        }),
      ]),
    )
    expect(sessionUpdates).toHaveLength(3)
    const planUpdate = sessionUpdates.find((u) => u.update.sessionUpdate === "plan")
    expect(planUpdate).toBeDefined()
    expect((planUpdate as any).update.entries).toHaveLength(1)
    expect((planUpdate as any).update.entries[0].content).toBe("task 1")
    expect((planUpdate as any).update.entries[0].status).toBe("pending")
  })

  test("processes mixed content types in one message", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(
      connection,
      shellSnapshots,
      toolStarts,
      SESSION_ID,
      assistantMessage([
        textContent({ text: "text" }),
        reasoningContent({ text: "thought" }),
        toolContent("completed", {
          state: { status: "completed", input: {}, structured: {}, content: [{ type: "text", text: "done" }] },
        }),
      ]),
    )
    expect(sessionUpdates).toHaveLength(4)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("agent_message_chunk")
    expect(sessionUpdates[1].update.sessionUpdate).toBe("agent_thought_chunk")
    expect(sessionUpdates[2].update.sessionUpdate).toBe("tool_call")
    expect(sessionUpdates[3].update.sessionUpdate).toBe("tool_call_update")
    expect(sessionUpdates[3].update.status).toBe("completed")
  })

  test("sends completed tool_call for shell messages", async () => {
    const { connection, sessionUpdates, shellSnapshots, toolStarts } = createTestAgent()
    await processMessage(
      connection,
      shellSnapshots,
      toolStarts,
      SESSION_ID,
      {
        id: "msg_1",
        type: "shell",
        callID: "call_shell",
        command: "echo hi",
        output: "hi\n",
        time: { created: Date.now(), completed: Date.now() },
      } as any,
    )
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("tool_call")
    expect(sessionUpdates[0].update.status).toBe("completed")
    expect(sessionUpdates[0].update.toolCallId).toBe("call_shell")
    expect(sessionUpdates[0].update.rawInput).toEqual({ command: "echo hi" })
    expect(sessionUpdates[0].update.content).toEqual([{ type: "content", content: { type: "text", text: "hi\n" } }])
  })
})
