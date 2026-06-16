import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"
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

  return { agent, sessionUpdates }
}

function textMessage(overrides: Record<string, unknown> = {}, parts: Record<string, unknown>[] = []): any {
  return {
    info: {
      id: "msg_1",
      sessionID: "ses_1",
      role: "assistant",
      ...overrides,
    },
    parts,
  }
}

function textPart(overrides: Record<string, unknown> = {}): any {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text: "hello world",
    time: { created: Date.now() },
    ...overrides,
  }
}

function filePart(overrides: Record<string, unknown> = {}): any {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "file",
    url: "file:///tmp/test.txt",
    filename: "test.txt",
    mime: "text/plain",
    time: { created: Date.now() },
    ...overrides,
  }
}

function reasoningPart(overrides: Record<string, unknown> = {}): any {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "reasoning",
    text: "thinking...",
    time: { created: Date.now() },
    ...overrides,
  }
}

function toolPart(state: string, overrides: Record<string, unknown> = {}): any {
  return {
    id: "part_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: "call_1",
    tool: "read",
    state: {
      status: state,
      input: { filePath: "/tmp/test.txt" },
      ...(state === "completed" ? { output: "file content", title: "read", metadata: {} } : {}),
      ...(state === "error" ? { error: "boom", metadata: {} } : {}),
      ...(typeof overrides.state === "object" && overrides.state !== null ? overrides.state : {}),
    },
  }
}

describe("Agent.processMessage", () => {
  test("ignores messages with non-assistant/user roles", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(textMessage({ role: "system" }, [textPart()]))
    expect(sessionUpdates).toHaveLength(0)
  })

  test("sends agent_message_chunk for assistant text parts", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [textPart({ text: "hi" })]))
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("agent_message_chunk")
    expect(sessionUpdates[0].update.content).toEqual({ type: "text", text: "hi" })
  })

  test("sends user_message_chunk for user text parts", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(textMessage({ role: "user" }, [textPart({ text: "hello" })]))
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("user_message_chunk")
  })

  test("skips empty text parts", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [textPart({ text: "" })]))
    expect(sessionUpdates).toHaveLength(0)
  })

  test("sends resource_link for file:// URLs", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [filePart()]))
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("agent_message_chunk")
    expect(sessionUpdates[0].update.content).toEqual({
      type: "resource_link",
      uri: "file:///tmp/test.txt",
      name: "test.txt",
      mimeType: "text/plain",
    })
  })

  test("sends image block for data:image/* URLs", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const part = filePart({
      url: "data:image/png;base64,abc123",
      mime: "image/png",
    })
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [part]))
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.content).toEqual({
      type: "image",
      mimeType: "image/png",
      data: "abc123",
      uri: expect.stringContaining("test.txt"),
    })
  })

  test("sends resource with text for data:text/* URLs", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const part = filePart({
      url: "data:text/plain;base64,SGVsbG8=",
      mime: "text/plain",
    })
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [part]))
    expect(sessionUpdates).toHaveLength(1)
    const content = sessionUpdates[0].update.content
    expect(content.type).toBe("resource")
    expect((content as any).resource.text).toBe("Hello")
    expect((content as any).resource.mimeType).toBe("text/plain")
  })

  test("sends resource with blob for binary data URLs", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const part = filePart({
      url: "data:application/pdf;base64,abc123",
      mime: "application/pdf",
    })
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [part]))
    expect(sessionUpdates).toHaveLength(1)
    const content = sessionUpdates[0].update.content
    expect(content.type).toBe("resource")
    expect((content as any).resource.blob).toBe("abc123")
    expect((content as any).resource.mimeType).toBe("application/pdf")
  })

  test("sends agent_thought_chunk for reasoning parts", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [reasoningPart()]))
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("agent_thought_chunk")
    expect(sessionUpdates[0].update.content).toEqual({ type: "text", text: "thinking..." })
  })

  test("sends tool_call for pending tool parts", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [toolPart("pending")]))
    expect(sessionUpdates).toHaveLength(1)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("tool_call")
    expect(sessionUpdates[0].update.status).toBe("pending")
  })

  test("sends tool_call then tool_call_update for running tool parts", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [toolPart("running")]))
    expect(sessionUpdates).toHaveLength(2)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("tool_call")
    expect(sessionUpdates[0].update.status).toBe("pending")
    expect(sessionUpdates[1].update.sessionUpdate).toBe("tool_call_update")
    expect(sessionUpdates[1].update.status).toBe("in_progress")
  })

  test("sends tool_call then tool_call_update for completed tool parts", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [toolPart("completed")]))
    expect(sessionUpdates).toHaveLength(2)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("tool_call")
    expect(sessionUpdates[0].update.status).toBe("pending")
    expect(sessionUpdates[1].update.sessionUpdate).toBe("tool_call_update")
    expect(sessionUpdates[1].update.status).toBe("completed")
    expect(sessionUpdates[1].update.toolCallId).toBe("call_1")
  })

  test("sends tool_call then tool_call_update for error tool parts", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(textMessage({ role: "assistant" }, [toolPart("error")]))
    expect(sessionUpdates).toHaveLength(2)
    expect(sessionUpdates[0].update.sessionUpdate).toBe("tool_call")
    expect(sessionUpdates[0].update.status).toBe("pending")
    expect(sessionUpdates[1].update.sessionUpdate).toBe("tool_call_update")
    expect(sessionUpdates[1].update.status).toBe("failed")
    expect(sessionUpdates[1].update.content).toEqual([{ type: "content", content: { type: "text", text: "boom" } }])
  })

  test("sends plan update when todowrite tool completes with valid output", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(
      textMessage({ role: "assistant" }, [
        {
          ...toolPart("completed"),
          tool: "todowrite",
          state: {
            status: "completed",
            input: {},
            output: JSON.stringify([{ content: "task 1", status: "pending", priority: "medium" }]),
            title: "todowrite",
            metadata: {},
          },
        },
      ]),
    )
    expect(sessionUpdates).toHaveLength(3)
    const planUpdate = sessionUpdates.find((u) => u.update.sessionUpdate === "plan")
    expect(planUpdate).toBeDefined()
    expect((planUpdate as any).update.entries).toHaveLength(1)
    expect((planUpdate as any).update.entries[0].content).toBe("task 1")
    expect((planUpdate as any).update.entries[0].status).toBe("pending")
  })

  test("processes mixed part types in one message", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).processMessage(
      textMessage({ role: "assistant" }, [
        textPart({ id: "p1", text: "text" }),
        reasoningPart({ id: "p2", text: "thought" }),
        toolPart("completed", {
          state: { status: "completed", input: {}, output: "done", title: "read", metadata: {} },
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
})
