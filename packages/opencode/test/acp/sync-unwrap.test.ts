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
    // V2 SDK surface: session auto-recovery goes through sdk.v2.session.get.
    // Unknown session IDs must fail server-side so auto-recovery drops the event.
    sdk: {
      v2: {
        session: {
          get: async (params: any) => {
            if (params?.sessionID !== "ses_1") throw new Error("Session not found on server")
            return {
              data: { id: "ses_1", directory: "/tmp", title: "test", time: { created: Date.now(), updated: Date.now() } },
            }
          },
        },
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

// Helper: wrap an event in a sync envelope (mimics the GlobalBus sync path).
// The syncEvent type carries a slash-form version suffix from versionedType().
function syncEnvelope(eventType: string, data: Record<string, unknown>, version = 1) {
  return {
    type: "sync",
    syncEvent: {
      type: `${eventType}/${version}`,
      id: "evt_test",
      seq: 1,
      aggregateID: (data.sessionID as string) ?? "ses_1",
      data,
    },
  }
}

// Raw Bus path: SyncEvents are also published unwrapped via ProjectBus.publish
function rawEvent(eventType: string, properties: Record<string, unknown>) {
  return { type: eventType, properties }
}

// V2 tool props exactly as emitted by session/processor.ts via SessionEvent.*.Sync
function v2CalledProps(overrides: Record<string, unknown> = {}) {
  return {
    sessionID: "ses_1",
    callID: "call_1",
    tool: "read",
    input: { filePath: "/tmp/test.txt" },
    provider: { executed: false },
    ...overrides,
  }
}

function v2SuccessProps(overrides: Record<string, unknown> = {}) {
  return {
    sessionID: "ses_1",
    callID: "call_1",
    structured: {},
    content: [{ type: "text", text: "file content" }],
    provider: { executed: false },
    ...overrides,
  }
}

describe("ACP sync envelope unwrapping", () => {
  test("handles session.next.tool.called via sync envelope", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("session.next.tool.called", v2CalledProps())
    await (agent as any).handleEvent(event)
    expect(sessionUpdates.length).toBe(1)
    const toolCall = sessionUpdates.find((u: any) => u.update.sessionUpdate === "tool_call")
    expect(toolCall).toBeDefined()
    expect(toolCall.update.status).toBe("pending")
    expect(toolCall.update.toolCallId).toBe("call_1")
  })

  test("handles session.next.tool.success via sync envelope", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    // success for an untracked callID is dropped (registry is populated by tool.called)
    await (agent as any).handleEvent(syncEnvelope("session.next.tool.called", v2CalledProps()))
    await (agent as any).handleEvent(syncEnvelope("session.next.tool.success", v2SuccessProps()))
    const toolCall = sessionUpdates.find((u: any) => u.update.sessionUpdate === "tool_call")
    expect(toolCall).toBeDefined()
    const toolUpdate = sessionUpdates.find((u: any) => u.update.sessionUpdate === "tool_call_update")
    expect(toolUpdate).toBeDefined()
    expect(toolUpdate.update.status).toBe("completed")
    expect(toolUpdate.update.toolCallId).toBe("call_1")
  })

  test("handles session.next.tool.failed via sync envelope", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).handleEvent(syncEnvelope("session.next.tool.called", v2CalledProps()))
    await (agent as any).handleEvent(
      syncEnvelope("session.next.tool.failed", {
        sessionID: "ses_1",
        callID: "call_1",
        error: { message: "boom" },
      }),
    )
    const toolUpdate = sessionUpdates.find(
      (u: any) => u.update.sessionUpdate === "tool_call_update" && u.update.status === "failed",
    )
    expect(toolUpdate).toBeDefined()
    expect(toolUpdate.update.toolCallId).toBe("call_1")
    expect(toolUpdate.update.content).toEqual([{ type: "content", content: { type: "text", text: "boom" } }])
  })

  test("handles session.next.tool.progress via sync envelope (in_progress)", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).handleEvent(syncEnvelope("session.next.tool.called", v2CalledProps()))
    await (agent as any).handleEvent(
      syncEnvelope("session.next.tool.progress", {
        sessionID: "ses_1",
        callID: "call_1",
        structured: {},
      }),
    )
    const toolUpdate = sessionUpdates.find(
      (u: any) => u.update.sessionUpdate === "tool_call_update" && u.update.status === "in_progress",
    )
    expect(toolUpdate).toBeDefined()
    expect(toolUpdate.update.toolCallId).toBe("call_1")
  })

  test("ignores version suffix from sync event type", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("session.next.tool.called", v2CalledProps(), 1)
    await (agent as any).handleEvent(event)
    const toolCall = sessionUpdates.find((u: any) => u.update.sessionUpdate === "tool_call")
    expect(toolCall).toBeDefined()
    expect(toolCall.update.toolCallId).toBe("call_1")
  })

  test("handles raw Bus-path session.next.tool.called (unwrapped)", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    // The raw ProjectBus path delivers { type, properties } without the sync envelope
    const event = rawEvent("session.next.tool.called", v2CalledProps())
    await (agent as any).handleEvent(event)
    expect(sessionUpdates.length).toBe(1)
    const toolUpdate = sessionUpdates.find((u: any) => u.update.sessionUpdate === "tool_call")
    expect(toolUpdate).toBeDefined()
    expect(toolUpdate.update.status).toBe("pending")
  })

  test("handles todowrite plan via sync envelope", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    await (agent as any).handleEvent(
      syncEnvelope("session.next.tool.called", v2CalledProps({ tool: "todowrite", input: {} })),
    )
    await (agent as any).handleEvent(
      syncEnvelope(
        "session.next.tool.success",
        v2SuccessProps({
          tool: undefined,
          content: [{ type: "text", text: JSON.stringify([{ content: "task 1", status: "pending", priority: "medium" }]) }],
        }),
      ),
    )
    const planUpdate = sessionUpdates.find((u: any) => u.update.sessionUpdate === "plan")
    expect(planUpdate).toBeDefined()
    expect(planUpdate.update.entries).toHaveLength(1)
    expect(planUpdate.update.entries[0].content).toBe("task 1")
    expect(planUpdate.update.entries[0].status).toBe("pending")
  })

  test("ignores sync events for unknown sessions", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("session.next.tool.called", v2CalledProps({ sessionID: "unknown_session" }))
    await (agent as any).handleEvent(event)
    expect(sessionUpdates).toHaveLength(0)
  })

  test("handles message.part.delta raw event without error", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    // PartDelta is a BusEvent, NOT a SyncEvent — handleEvent must ignore it (no V1 part handler)
    const event = rawEvent("message.part.delta", {
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_1",
      field: "text",
      delta: "hello world",
    })
    await (agent as any).handleEvent(event)
    expect(sessionUpdates).toHaveLength(0)
  })

  test("handles message.part.removed via sync envelope without error", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("message.part.removed", {
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_1",
    })
    await (agent as any).handleEvent(event)
    expect(sessionUpdates).toHaveLength(0)
  })

  test("handles message.part.delta wrapped in sync envelope defensively", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("message.part.delta", {
      sessionID: "ses_1",
      messageID: "msg_1",
      partID: "part_1",
      field: "text",
      delta: "hello",
    })
    await (agent as any).handleEvent(event)
    expect(sessionUpdates).toHaveLength(0)
  })

  test("handles session.next.text.delta via sync envelope", async () => {
    const { agent, sessionUpdates } = createTestAgent()
    const event = syncEnvelope("session.next.text.delta", { sessionID: "ses_1", delta: "hello" })
    await (agent as any).handleEvent(event)
    const chunk = sessionUpdates.find((u: any) => u.update.sessionUpdate === "agent_message_chunk")
    expect(chunk).toBeDefined()
    expect(chunk.update.content.text).toBe("hello")
  })
})
