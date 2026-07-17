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
    sdk: {
      session: {
        message: async () => ({ data: undefined }),
      },
    } as any,
  })
  // Register a session so sessionManager.tryGet succeeds
  ;(agent as any).sessionManager.sessions.set("ses_1", {
    id: "ses_1",
    cwd: "/tmp",
    mcpServers: [],
    createdAt: new Date(),
  })
  return { agent, sessionUpdates }
}

// Helper: wrap an event in a sync envelope (mimics what GlobalBus does)
function syncEnvelope(eventType: string, data: Record<string, unknown>, version = 1) {
  return {
    type: "sync",
    syncEvent: {
      type: `${eventType}.${version}`,
      id: "evt_test",
      seq: 1,
      aggregateID: (data.sessionID as string) ?? "ses_1",
      data,
    },
  }
}

// Helper: a tool part in various states
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
    ...overrides,
  }
}

describe("ACP sync envelope unwrapping", () => {
  test("unwraps sync envelope for message.part.updated with completed tool", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("message.part.updated", {
      sessionID: "ses_1",
      time: Date.now(),
      part: toolPart("completed"),
    })
    await (agent as any).handleEvent(event)
    expect(sessionUpdates.length).toBeGreaterThanOrEqual(2)
    const toolCall = sessionUpdates.find((u: any) => u.update.sessionUpdate === "tool_call")
    expect(toolCall).toBeDefined()
    expect(toolCall.update.status).toBe("pending")
    const toolUpdate = sessionUpdates.find((u: any) => u.update.sessionUpdate === "tool_call_update")
    expect(toolUpdate).toBeDefined()
    expect(toolUpdate.update.status).toBe("completed")
    expect(toolUpdate.update.toolCallId).toBe("call_1")
  })

  test("unwraps sync envelope for message.part.updated with running tool", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("message.part.updated", {
      sessionID: "ses_1",
      time: Date.now(),
      part: toolPart("running"),
    })
    await (agent as any).handleEvent(event)
    expect(sessionUpdates.length).toBeGreaterThanOrEqual(2)
    const toolUpdate = sessionUpdates.find(
      (u: any) => u.update.sessionUpdate === "tool_call_update" && u.update.status === "in_progress",
    )
    expect(toolUpdate).toBeDefined()
    expect(toolUpdate.update.toolCallId).toBe("call_1")
  })

  test("unwraps sync envelope for message.part.updated with error tool", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("message.part.updated", {
      sessionID: "ses_1",
      time: Date.now(),
      part: toolPart("error"),
    })
    await (agent as any).handleEvent(event)
    expect(sessionUpdates.length).toBeGreaterThanOrEqual(2)
    const toolUpdate = sessionUpdates.find(
      (u: any) => u.update.sessionUpdate === "tool_call_update" && u.update.status === "failed",
    )
    expect(toolUpdate).toBeDefined()
    expect(toolUpdate.update.toolCallId).toBe("call_1")
    expect(toolUpdate.update.content).toEqual([
      { type: "content", content: { type: "text", text: "boom" } },
    ])
  })

  test("unwraps sync envelope for message.part.updated with pending tool", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("message.part.updated", {
      sessionID: "ses_1",
      time: Date.now(),
      part: toolPart("pending"),
    })
    await (agent as any).handleEvent(event)
    expect(sessionUpdates.length).toBeGreaterThanOrEqual(1)
    const toolCall = sessionUpdates.find((u: any) => u.update.sessionUpdate === "tool_call")
    expect(toolCall).toBeDefined()
    expect(toolCall.update.status).toBe("pending")
    expect(toolCall.update.toolCallId).toBe("call_1")
  })

  test("strips version suffix from sync event type", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    // Send a sync event with version suffix .1
    const event = syncEnvelope("message.part.updated", {
      sessionID: "ses_1",
      time: Date.now(),
      part: toolPart("completed"),
    })
    await (agent as any).handleEvent(event)
    // Should be handled (not dropped) — we should see tool_call + tool_call_update
    const toolCall = sessionUpdates.find((u: any) => u.update.sessionUpdate === "tool_call")
    expect(toolCall).toBeDefined()
    const toolUpdate = sessionUpdates.find((u: any) => u.update.sessionUpdate === "tool_call_update")
    expect(toolUpdate).toBeDefined()
  })

  test("passes through non-sync events unchanged", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    // Send a raw message.part.updated event (not wrapped in sync)
    const event = {
      type: "message.part.updated",
      properties: {
        sessionID: "ses_1",
        time: Date.now(),
        part: toolPart("completed"),
      },
    }
    await (agent as any).handleEvent(event)
    expect(sessionUpdates.length).toBeGreaterThanOrEqual(2)
    const toolUpdate = sessionUpdates.find(
      (u: any) => u.update.sessionUpdate === "tool_call_update" && u.update.status === "completed",
    )
    expect(toolUpdate).toBeDefined()
  })

  test("ignores sync events for unknown sessions", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    // Use a part with an unknown sessionID so the session lookup fails
    const event = syncEnvelope("message.part.updated", {
      sessionID: "unknown_session",
      time: Date.now(),
      part: { ...toolPart("completed"), sessionID: "unknown_session" },
    })
    await (agent as any).handleEvent(event)
    expect(sessionUpdates).toHaveLength(0)
  })

  test("handles todowrite plan via sync envelope", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("message.part.updated", {
      sessionID: "ses_1",
      time: Date.now(),
      part: toolPart("completed", {
        tool: "todowrite",
        state: {
          status: "completed",
          input: {},
          output: JSON.stringify([{ content: "task 1", status: "pending", priority: "medium" }]),
          title: "todowrite",
          metadata: {},
        },
      }),
    })
    await (agent as any).handleEvent(event)
    const planUpdate = sessionUpdates.find((u: any) => u.update.sessionUpdate === "plan")
    expect(planUpdate).toBeDefined()
    expect(planUpdate.update.entries).toHaveLength(1)
    expect(planUpdate.update.entries[0].content).toBe("task 1")
    expect(planUpdate.update.entries[0].status).toBe("pending")
  })

  test("handles message.part.delta via sync envelope", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    // PartDelta is a BusEvent, NOT a SyncEvent — but handleEvent should handle
    // a raw message.part.delta event (not wrapped in sync)
    const event = {
      type: "message.part.delta",
      properties: {
        sessionID: "ses_1",
        messageID: "msg_1",
        partID: "part_1",
        field: "text",
        delta: "hello world",
      },
    }
    await (agent as any).handleEvent(event)
    // Should not crash — delta for unknown message is a no-op
    expect(sessionUpdates).toHaveLength(0)
  })

  test("handles message.part.removed via sync envelope without error", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("message.part.removed", {
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_1",
    })
    // Should not throw or crash
    await (agent as any).handleEvent(event)
    expect(sessionUpdates).toHaveLength(0)
  })

  test("handles message.part.delta wrapped in sync envelope defensively", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    // Defensive: if a sync-wrapped delta arrives, it should be handled too
    const event = syncEnvelope("message.part.delta", {
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_1",
      field: "text",
      delta: "hello",
    })
    // Should not throw or crash
    await (agent as any).handleEvent(event)
    // No session update since the message doesn't exist
    expect(sessionUpdates).toHaveLength(0)
  })
})
