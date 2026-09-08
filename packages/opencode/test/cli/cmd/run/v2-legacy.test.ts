import { describe, expect, test } from "bun:test"
import type { Event, SessionMessage } from "@opencode-ai/sdk/v2/client"
import { createV2EventAdapter, sessionMessagesToLegacy } from "../../../../src/cli/cmd/run/v2-legacy"

const sessionID = "ses_1"
const model = { id: "model_1", providerID: "provider_1", variant: "default" }

function event(type: string, properties: Record<string, unknown>, id = `evt_${type}`) {
  return { id, type, properties } as unknown as Event
}

describe("createV2EventAdapter", () => {
  test("converts a V2 text turn into the legacy reducer events", () => {
    const adapter = createV2EventAdapter()
    const prompted = adapter.adapt(
      event("session.next.prompted", {
        sessionID,
        timestamp: 100,
        prompt: { text: "hello" },
        agent: "build",
        model,
      }, "user_1"),
    )
    const step = adapter.adapt(
      event("session.next.step.started", {
        sessionID,
        timestamp: 110,
        agent: "build",
        model,
      }, "assistant_1"),
    )
    const textStart = adapter.adapt(event("session.next.text.started", { sessionID, timestamp: 120 }, "text_1"))
    const delta = adapter.adapt(event("session.next.text.delta", { sessionID, timestamp: 130, delta: "world" }, "delta_1"))
    const textEnd = adapter.adapt(
      event("session.next.text.ended", { sessionID, timestamp: 140, text: "world" }, "text_end_1"),
    )

    expect(prompted.map((item) => item.type)).toEqual(["message.updated", "message.part.updated"])
    expect(prompted[0]?.properties).toMatchObject({ sessionID, info: { id: "user_1", role: "user" } })
    expect(step[0]?.properties).toMatchObject({ sessionID, info: { id: "assistant_1", role: "assistant" } })
    expect(textStart[0]?.type).toBe("message.part.updated")
    expect(delta[0]?.properties).toMatchObject({ field: "text", delta: "world", messageID: "assistant_1" })
    expect(textEnd[0]?.properties).toMatchObject({
      part: { type: "text", text: "world", messageID: "assistant_1" },
    })
  })

  test("converts V2 tool lifecycle and status events", () => {
    const adapter = createV2EventAdapter()
    adapter.adapt(event("session.next.step.started", { sessionID, timestamp: 100, agent: "build", model }, "assistant_1"))
    adapter.adapt(event("session.next.tool.input.started", { sessionID, timestamp: 110, callID: "call_1", name: "read" }))
    const called = adapter.adapt(
      event("session.next.tool.called", {
        sessionID,
        timestamp: 120,
        callID: "call_1",
        tool: "read",
        input: { filePath: "/tmp/test.txt" },
        provider: { executed: true },
      }),
    )
    const success = adapter.adapt(
      event("session.next.tool.success", {
        sessionID,
        timestamp: 130,
        callID: "call_1",
        structured: {},
        content: [{ type: "text", text: "file content" }],
        provider: { executed: true },
      }),
    )
    const status = adapter.adapt(event("session.next.status", { sessionID, timestamp: 140, status: { type: "idle" } }))

    expect(called[0]?.properties).toMatchObject({
      part: { type: "tool", callID: "call_1", tool: "read", state: { status: "running" } },
    })
    expect(success[0]?.properties).toMatchObject({
      part: { type: "tool", callID: "call_1", state: { status: "completed", output: "file content" } },
    })
    expect(status).toHaveLength(1)
    expect(status[0]?.type).toBe("session.status")
  })
})

describe("sessionMessagesToLegacy", () => {
  test("rebuilds V1 message and part shapes from projected V2 history", () => {
    const messages: SessionMessage[] = [
      {
        id: "user_1",
        type: "user",
        text: "hello",
        agent: "build",
        model,
        time: { created: 100 },
      },
      {
        id: "assistant_1",
        type: "assistant",
        agent: "build",
        model,
        time: { created: 110, completed: 130 },
        content: [
          {
            type: "tool",
            id: "call_1",
            name: "read",
            time: { created: 111, ran: 112, completed: 120 },
            state: {
              status: "completed",
              input: { filePath: "/tmp/test.txt" },
              structured: {},
              content: [{ type: "text", text: "file content" }],
            },
          },
        ],
      },
    ]

    const result = sessionMessagesToLegacy(messages, sessionID)
    expect(result).toHaveLength(2)
    expect(result[0]?.info).toMatchObject({ id: "user_1", role: "user", sessionID })
    expect(result[0]?.parts[0]).toMatchObject({ type: "text", text: "hello" })
    expect(result[1]?.info).toMatchObject({ id: "assistant_1", role: "assistant", parentID: "user_1" })
    expect(result[1]?.parts[0]).toMatchObject({
      type: "tool",
      callID: "call_1",
      state: { status: "completed", output: "file content" },
    })
  })
})
