import { describe, expect, test } from "bun:test"
import {
  createSession,
  sessionHistory,
  sessionVariant,
  type RunSession,
  type SessionMessages,
} from "@/cli/cmd/run/session.shared"
import type { SessionMessage, SessionMessageUser } from "@opencode-ai/sdk/v2"

// Fixtures use the V2 message model (resolveSession reads the v2 endpoint).
// Assertions are unchanged from the V1-fixture era — they are the parity proof
// for the prompt-extraction pipeline.

const model = {
  providerID: "openai",
  modelID: "gpt-5",
}

function userMessage(id: string, input: { text?: string; files?: SessionMessageUser["files"]; agents?: SessionMessageUser["agents"] }, variant = "high"): SessionMessageUser {
  return {
    id,
    type: "user",
    sessionID: "session-1",
    text: input.text ?? "",
    files: input.files,
    agents: input.agents,
    agent: "build",
    model: {
      id: model.modelID,
      providerID: model.providerID,
      variant,
    },
    time: {
      created: 1,
    },
  } as SessionMessageUser
}

function assistantMessage(id: string): SessionMessage {
  return {
    id,
    type: "assistant",
    sessionID: "session-1",
    agent: "build",
    model: {
      id: model.modelID,
      providerID: model.providerID,
      variant: "high",
    },
    content: [],
    time: {
      created: 1,
    },
    cost: 0,
    tokens: {
      input: 1,
      output: 1,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  } as unknown as SessionMessage
}

describe("run session shared", () => {
  test("builds user prompt text from text, file, and agent parts", () => {
    const msgs: SessionMessages = [
      assistantMessage("msg-assistant-1"),
      userMessage("msg-user-1", {
        text: "look @scan",
        agents: [{ name: "scan", source: { start: 5, end: 10, text: "@scan" } }],
        files: [{ uri: "file:///tmp/note.ts", mime: "text/plain" }],
      }),
    ]

    const out = createSession(msgs)
    expect(out.first).toBe(false)
    expect(out.turns).toHaveLength(1)
    expect(out.turns[0]?.prompt.text).toBe("look @scan @note.ts")
    // V2 loses the V1 part-array interleaving order; extraction emits files
    // then agents (the V2 schema field order).
    expect(out.turns[0]?.prompt.parts).toEqual([
      {
        type: "file",
        mime: "text/plain",
        filename: undefined,
        url: "file:///tmp/note.ts",
        source: {
          type: "file",
          path: "file:///tmp/note.ts",
          text: {
            start: 11,
            end: 19,
            value: "@note.ts",
          },
        },
      },
      {
        type: "agent",
        name: "scan",
        source: {
          start: 5,
          end: 10,
          value: "@scan",
        },
      },
    ])
  })

  test("reuses existing mentions when file and agent parts have no source", () => {
    const out = createSession([
      userMessage("msg-user-1", {
        text: "look @scan @note.ts",
        agents: [{ name: "scan" }],
        files: [{ uri: "file:///tmp/note.ts", mime: "text/plain" }],
      }),
    ])

    expect(out.turns[0]?.prompt).toEqual({
      text: "look @scan @note.ts",
      parts: [
        {
          type: "file",
          mime: "text/plain",
          filename: undefined,
          url: "file:///tmp/note.ts",
          source: {
            type: "file",
            path: "file:///tmp/note.ts",
            text: {
              start: 11,
              end: 19,
              value: "@note.ts",
            },
          },
        },
        {
          type: "agent",
          name: "scan",
          source: {
            start: 5,
            end: 10,
            value: "@scan",
          },
        },
      ],
    })
  })

  test("reuses stored V2 file source ranges instead of re-deriving them", () => {
    const out = createSession([
      userMessage("msg-user-1", {
        text: "look @note.ts now",
        files: [
          {
            uri: "file:///tmp/note.ts",
            mime: "text/plain",
            source: { start: 5, end: 13, text: "@note.ts" },
          },
        ],
      }),
    ])

    const file = out.turns[0]?.prompt.parts.find((p) => p.type === "file")
    expect(file).toMatchObject({
      type: "file",
      url: "file:///tmp/note.ts",
      source: {
        type: "file",
        path: "file:///tmp/note.ts",
        text: { start: 5, end: 13, value: "@note.ts" },
      },
    })
    expect(out.turns[0]?.prompt.text).toBe("look @note.ts now")
  })

  test("dedupes consecutive history entries, drops blanks, and copies prompt parts", () => {
    const parts = [
      {
        type: "agent" as const,
        name: "scan",
        source: {
          start: 0,
          end: 5,
          value: "@scan",
        },
      },
    ]
    const session: RunSession = {
      first: false,
      turns: [
        { prompt: { text: "one", parts }, provider: "openai", model: "gpt-5", variant: "high" },
        { prompt: { text: "one", parts: structuredClone(parts) }, provider: "openai", model: "gpt-5", variant: "high" },
        { prompt: { text: "   ", parts: [] }, provider: "openai", model: "gpt-5", variant: "high" },
        { prompt: { text: "two", parts: [] }, provider: "openai", model: "gpt-5", variant: undefined },
      ],
    }

    const out = sessionHistory(session)

    expect(out.map((item) => item.text)).toEqual(["one", "two"])
    expect(out[0]?.parts).toEqual(parts)
    expect(out[0]?.parts).not.toBe(parts)
    expect(out[0]?.parts[0]).not.toBe(parts[0])
  })

  test("returns the latest matching variant for the active model", () => {
    const session: RunSession = {
      first: false,
      turns: [
        { prompt: { text: "one", parts: [] }, provider: "openai", model: "gpt-5", variant: "high" },
        { prompt: { text: "two", parts: [] }, provider: "anthropic", model: "sonnet", variant: "max" },
        { prompt: { text: "three", parts: [] }, provider: "openai", model: "gpt-5", variant: undefined },
      ],
    }

    expect(sessionVariant(session, model)).toBeUndefined()

    session.turns.push({
      prompt: { text: "four", parts: [] },
      provider: "openai",
      model: "gpt-5",
      variant: "minimal",
    })

    expect(sessionVariant(session, model)).toBe("minimal")
  })
})
