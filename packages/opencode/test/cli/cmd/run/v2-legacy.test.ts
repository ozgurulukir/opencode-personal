import { describe, expect, test } from "bun:test"
import type { Event, Part, SessionMessage } from "@opencode-ai/sdk/v2/client"
import { createV2EventAdapter, sessionMessagesToLegacy } from "../../../../src/cli/cmd/run/v2-legacy"

const sessionID = "ses_1"
const model = { id: "model_1", providerID: "provider_1", variant: "default" }

function event(type: string, properties: Record<string, unknown>, id = `evt_${type}`) {
  return { id, type, properties } as unknown as Event
}

function semanticPart(part: Part | undefined) {
  if (!part) return
  const { id: _id, sessionID: _sessionID, messageID: _messageID, ...semantic } = part
  return semantic
}

function eventPart(events: Event[], type: Part["type"]) {
  for (const item of events) {
    const part = (item.properties as { part?: Part } | undefined)?.part
    if (part?.type === type) return part
  }
}

describe("createV2EventAdapter", () => {
  test("converts a V2 text turn into the legacy reducer events", () => {
    const adapter = createV2EventAdapter()
    const prompted = adapter.adapt(
      event(
        "session.next.prompted",
        {
          sessionID,
          timestamp: 100,
          prompt: { text: "hello" },
          agent: "build",
          model,
        },
        "user_1",
      ),
    )
    const step = adapter.adapt(
      event(
        "session.next.step.started",
        {
          sessionID,
          timestamp: 110,
          agent: "build",
          model,
        },
        "assistant_1",
      ),
    )
    const textStart = adapter.adapt(event("session.next.text.started", { sessionID, timestamp: 120 }, "text_1"))
    const delta = adapter.adapt(
      event("session.next.text.delta", { sessionID, timestamp: 130, delta: "world" }, "delta_1"),
    )
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
    adapter.adapt(
      event("session.next.step.started", { sessionID, timestamp: 100, agent: "build", model }, "assistant_1"),
    )
    adapter.adapt(
      event("session.next.tool.input.started", { sessionID, timestamp: 110, callID: "call_1", name: "read" }),
    )
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
        content: [
          { type: "text", text: "file content" },
          { type: "file", uri: "file:///tmp/output.png", mime: "image/png", name: "output.png" },
        ],
        provider: { executed: true },
      }),
    )
    const status = adapter.adapt(event("session.next.status", { sessionID, timestamp: 140, status: { type: "idle" } }))

    expect(called[0]?.properties).toMatchObject({
      part: { type: "tool", callID: "call_1", tool: "read", state: { status: "running" } },
    })
    expect(success[0]?.properties).toMatchObject({
      part: {
        type: "tool",
        callID: "call_1",
        state: {
          status: "completed",
          output: "file content",
          attachments: [{ filename: "output.png", url: "file:///tmp/output.png" }],
        },
      },
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

  test("preserves subtask, file source, reasoning identity/time, attachments and abort errors", () => {
    const result = sessionMessagesToLegacy(
      [
        {
          id: "user_1",
          type: "user",
          text: "delegate",
          agent: "build",
          model,
          time: { created: 100 },
          subtask: {
            agent: "explore",
            description: "inspect the file",
            prompt: "read a.ts",
          },
          files: [
            { uri: "file:///tmp/a.ts", mime: "text/plain", name: "a.ts", source: { start: 1, end: 3, text: "const" } },
          ],
        },
        {
          id: "assistant_1",
          type: "assistant",
          agent: "build",
          model,
          time: { created: 110, completed: 130 },
          error: { type: "aborted", message: "Aborted" },
          content: [
            { type: "reasoning", id: "rsn_1", text: "thinking" },
            {
              type: "tool",
              id: "call_1",
              name: "read",
              time: { created: 111, ran: 112, completed: 120 },
              state: {
                status: "completed",
                input: { filePath: "/tmp/a.ts" },
                structured: {},
                content: [
                  { type: "text", text: "done" },
                  { type: "file", uri: "file:///tmp/a.ts", mime: "text/plain", name: "a.ts" },
                ],
              },
            },
          ],
        },
      ],
      sessionID,
    )

    expect(result[0]?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "subtask", agent: "explore", prompt: "read a.ts" }),
        expect.objectContaining({
          type: "file",
          source: { type: "file", path: "/tmp/a.ts", text: { value: "const", start: 1, end: 3 } },
        }),
      ]),
    )
    expect(result[1]?.info).toMatchObject({
      error: { name: "MessageAbortedError", data: { message: "Aborted" } },
    })
    expect(result[1]?.parts[0]).toMatchObject({
      type: "reasoning",
      id: "assistant_1:reasoning:rsn_1",
      time: { start: 110, end: 130 },
    })
    expect(result[1]?.parts[1]).toMatchObject({
      type: "tool",
      state: { status: "completed", attachments: [{ filename: "a.ts" }] },
    })
  })

  test("emits the same semantic file and subtask parts for live events as history", () => {
    const message: SessionMessage = {
      id: "user_1",
      type: "user",
      text: "delegate",
      agent: "build",
      model,
      time: { created: 100 },
      files: [{ uri: "file:///tmp/a.ts", mime: "text/plain", name: "a.ts" }],
      subtask: { agent: "explore", description: "inspect", prompt: "read" },
    }
    const history = sessionMessagesToLegacy([message], sessionID)
    const adapter = createV2EventAdapter()
    const prompted = adapter.adapt(
      event(
        "session.next.prompted",
        {
          sessionID,
          timestamp: 100,
          prompt: {
            text: "delegate",
            files: message.files,
            subtask: { agent: "explore", description: "inspect", prompt: "read" },
          },
          agent: "build",
          model,
        },
        "user_1",
      ),
    )

    for (const type of ["file", "subtask"] as const) {
      expect(semanticPart(eventPart(prompted, type))).toEqual(
        semanticPart(history[0]?.parts.find((part) => part.type === type)),
      )
    }
  })

  test("maps an explicit V2 abort error to the legacy MessageAbortedError", () => {
    const adapter = createV2EventAdapter()
    const failed = adapter.adapt(
      event(
        "session.next.step.failed",
        { sessionID, timestamp: 100, error: { type: "aborted", message: "Aborted" } },
        "failed_1",
      ),
    )

    expect(failed[0]?.properties).toMatchObject({
      error: { name: "MessageAbortedError", data: { message: "Aborted" } },
    })
  })

  test("preserves the reasoning start timestamp when the block ends", () => {
    const adapter = createV2EventAdapter()
    adapter.adapt(
      event("session.next.step.started", { sessionID, timestamp: 100, agent: "build", model }, "assistant_1"),
    )
    adapter.adapt(
      event("session.next.reasoning.started", { sessionID, timestamp: 120, reasoningID: "rsn_1" }, "reasoning_start"),
    )
    const ended = adapter.adapt(
      event(
        "session.next.reasoning.ended",
        { sessionID, timestamp: 130, reasoningID: "rsn_1", text: "thinking" },
        "reasoning_end",
      ),
    )

    expect(ended[0]?.properties).toMatchObject({ part: { type: "reasoning", time: { start: 120, end: 130 } } })
  })
})
