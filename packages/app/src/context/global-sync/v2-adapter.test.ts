import { describe, expect, test } from "bun:test"
import type {
  SessionMessage,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageUser,
} from "@opencode-ai/sdk/v2/client"
import { messageText, partID, sessionMessagesToV1, SHELL_SYNTHETIC_TEXT } from "./v2-adapter"

const sessionID = "ses_1"

const user = (id: string, text: string, files?: SessionMessageUser["files"]): SessionMessage =>
  ({
    id,
    type: "user",
    text,
    ...(files ? { files } : {}),
    agent: "assistant",
    model: { id: "gpt", providerID: "openai", variant: "default" },
    time: { created: 1 },
  }) as SessionMessage

const assistant = (
  id: string,
  content: (SessionMessageAssistantText | SessionMessageAssistantReasoning | SessionMessageAssistantTool)[],
  extra: Partial<Record<string, unknown>> = {},
): SessionMessage =>
  ({
    id,
    type: "assistant",
    agent: "assistant",
    model: { id: "gpt", providerID: "openai", variant: "default" },
    content,
    time: { created: 2, completed: 3 },
    ...extra,
  }) as SessionMessage

describe("sessionMessagesToV1", () => {
  test("converts user messages with text, file and agent parts", () => {
    const { session, part } = sessionMessagesToV1(
      [
        user("evt_1", "hello", [
          {
            uri: "file:///tmp/a%20b.ts?start=1&end=2",
            mime: "text/plain",
            name: "a b.ts",
            source: { start: 0, end: 5, text: "const" },
          },
        ]),
      ],
      sessionID,
    )

    expect(session).toHaveLength(1)
    expect(session[0]).toMatchObject({
      id: "evt_1",
      role: "user",
      agent: "assistant",
      model: { providerID: "openai", modelID: "gpt" },
    })
    const parts = part["evt_1"] ?? []
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ type: "text", text: "hello" })
    expect(parts[1]).toMatchObject({
      type: "file",
      filename: "a b.ts",
      url: "file:///tmp/a%20b.ts?start=1&end=2",
      source: { type: "file", path: "/tmp/a b.ts", text: { value: "const", start: 0, end: 5 } },
    })
  })

  test("attaches assistants to the most recent user message and maps content", () => {
    const { session, part } = sessionMessagesToV1(
      [
        user("evt_1", "hello"),
        assistant("evt_2", [
          { type: "text", text: "hi" },
          { type: "reasoning", id: "rsn_1", text: "thinking" },
          {
            type: "tool",
            id: "call_1",
            name: "bash",
            time: { created: 2, ran: 3, completed: 4 },
            state: {
              status: "completed",
              input: { command: "ls" },
              structured: { output: "files" },
              content: [{ type: "text", text: "files" }],
            },
          },
        ]),
      ],
      sessionID,
    )

    expect(session).toHaveLength(2)
    expect(session[1]).toMatchObject({
      id: "evt_2",
      role: "assistant",
      parentID: "evt_1",
      modelID: "gpt",
      providerID: "openai",
      mode: "assistant",
      time: { created: 2, completed: 3 },
    })
    const parts = part["evt_2"] ?? []
    expect(parts.map((x) => x.type)).toEqual(["text", "reasoning", "tool"])
    expect(parts[2]).toMatchObject({
      callID: "call_1",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "files",
        metadata: { output: "files" },
        time: { start: 3, end: 4 },
      },
    })
  })

  test("preserves subtask, reasoning identity/time, attachments and abort errors", () => {
    const { session, part } = sessionMessagesToV1(
      [
        user("evt_1", "delegate", undefined),
        assistant(
          "evt_2",
          [
            { type: "reasoning", id: "rsn_1", text: "thinking" },
            {
              type: "tool",
              id: "call_1",
              name: "read",
              time: { created: 2, ran: 3, completed: 4 },
              state: {
                status: "completed",
                input: { filePath: "/tmp/a.ts" },
                structured: {},
                content: [{ type: "text", text: "done" }],
                attachments: [{ uri: "file:///tmp/a.ts", mime: "text/plain", name: "a.ts" }],
              },
            },
          ],
          { error: { type: "aborted", message: "Aborted" } },
        ),
      ].map((message, index) => {
        if (index === 0 && message.type === "user") {
          return {
            ...message,
            subtask: {
              agent: "explore",
              description: "inspect the file",
              prompt: "read a.ts",
            },
          }
        }
        return message
      }),
      sessionID,
    )

    expect(part["evt_1"]?.[1]).toMatchObject({
      type: "subtask",
      agent: "explore",
      description: "inspect the file",
      prompt: "read a.ts",
    })
    expect(part["evt_2"]?.[0]).toMatchObject({
      type: "reasoning",
      id: "evt_2:reasoning:rsn_1",
      time: { start: 2, end: 3 },
    })
    expect(part["evt_2"]?.[1]).toMatchObject({
      type: "tool",
      state: { status: "completed", attachments: [{ filename: "a.ts" }] },
    })
    expect(session[1]).toMatchObject({
      error: { name: "MessageAbortedError", data: { message: "Aborted" } },
    })
  })

  test("expands shell messages into user wrapper, assistant and bash tool part", () => {
    const { session, part } = sessionMessagesToV1(
      [
        user("evt_1", "run it"),
        {
          id: "evt_2",
          type: "shell",
          callID: "call_9",
          command: "ls",
          output: "out",
          time: { created: 2, completed: 3 },
        } as SessionMessage,
      ],
      sessionID,
    )

    expect(session).toHaveLength(3)
    expect(session[1]).toMatchObject({ id: "evt_2", role: "user", agent: "assistant" })
    expect(part["evt_2"]?.[0]).toMatchObject({ type: "text", text: SHELL_SYNTHETIC_TEXT, synthetic: true })
    expect(session[2]).toMatchObject({ id: "evt_2:assistant", role: "assistant", parentID: "evt_2" })
    expect(part["evt_2:assistant"]?.[0]).toMatchObject({
      type: "tool",
      tool: "bash",
      callID: "call_9",
      state: {
        status: "completed",
        input: { command: "ls" },
        output: "out",
        metadata: { output: "out", description: "" },
        time: { start: 2, end: 3 },
      },
    })
  })

  test("expands compaction messages into a user wrapper with a compaction part", () => {
    const { session, part } = sessionMessagesToV1(
      [
        user("evt_1", "hello"),
        { id: "evt_2", type: "compaction", reason: "auto", summary: "summary", time: { created: 2 } } as SessionMessage,
      ],
      sessionID,
    )

    expect(session).toHaveLength(2)
    expect(session[1]).toMatchObject({ id: "evt_2", role: "user", agent: "assistant" })
    expect(part["evt_2"]?.[0]).toMatchObject({ type: "compaction", auto: true })
  })

  test("attaches synthetic comment notes to the latest user message and skips others", () => {
    const note = "The user made the following comment regarding line 3 of src/a.ts: fix this"
    const { session, part } = sessionMessagesToV1(
      [
        user("evt_1", "hello"),
        { id: "evt_2", type: "synthetic", text: note, time: { created: 2 } } as SessionMessage,
        { id: "evt_3", type: "synthetic", text: "subagent result", time: { created: 3 } } as SessionMessage,
      ],
      sessionID,
    )

    expect(session).toHaveLength(1)
    const parts = part["evt_1"] ?? []
    expect(parts).toHaveLength(2)
    expect(parts[1]).toMatchObject({ type: "text", synthetic: true, text: note })
  })

  test("skips agent-switched and model-switched messages", () => {
    const { session } = sessionMessagesToV1(
      [
        user("evt_1", "hello"),
        { id: "evt_2", type: "agent-switched", agent: "build", time: { created: 2 } } as SessionMessage,
        {
          id: "evt_3",
          type: "model-switched",
          model: { id: "m", providerID: "p", variant: "default" },
          time: { created: 3 },
        } as SessionMessage,
      ],
      sessionID,
    )

    expect(session.map((x) => x.id)).toEqual(["evt_1"])
  })

  test("part ids sort in content order", () => {
    expect(partID.text("evt_1", 0)).toBe("evt_1:0000:text")
    expect(partID.tool("evt_1", 12)).toBe("evt_1:0012:tool")
    expect(partID.text("evt_1", 2) < partID.file("evt_1", 3)).toBe(true)
    expect(partID.file("evt_1", 9) < partID.file("evt_1", 10)).toBe(true)
  })

  test("messageText joins non-synthetic text parts", () => {
    const { part } = sessionMessagesToV1([user("evt_1", "hello")], sessionID)
    expect(messageText(part["evt_1"] ?? [])).toBe("hello")
  })
})
