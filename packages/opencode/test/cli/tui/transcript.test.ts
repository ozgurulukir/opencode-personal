import { describe, expect, test } from "bun:test"
import { formatAssistantHeader, formatMessage, formatTranscript } from "../../../src/cli/cmd/tui/util/transcript"
import type { Provider, SessionMessage, SessionMessageAssistant, SessionMessageUser } from "@opencode-ai/sdk/v2"

const providers: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    source: "api",
    env: [],
    options: {},
    models: {
      "claude-sonnet-4-20250514": {
        id: "claude-sonnet-4-20250514",
        providerID: "anthropic",
        api: {
          id: "claude-sonnet-4-20250514",
          url: "https://example.com/claude-sonnet-4-20250514",
          npm: "@ai-sdk/anthropic",
        },
        name: "Claude Sonnet 4",
        capabilities: {
          temperature: true,
          reasoning: true,
          attachment: true,
          toolcall: true,
          input: {
            text: true,
            audio: false,
            image: true,
            video: false,
            pdf: true,
          },
          output: {
            text: true,
            audio: false,
            image: false,
            video: false,
            pdf: false,
          },
          interleaved: false,
        },
        cost: {
          input: 0,
          output: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        limit: {
          context: 200_000,
          output: 8_192,
        },
        status: "active",
        options: {},
        headers: {},
        release_date: "2025-05-14",
      },
    },
  },
]

const baseUser: SessionMessageUser = {
  id: "msg_123",
  type: "user",
  text: "Hello",
  agent: "build",
  model: { id: "claude-sonnet-4-20250514", providerID: "anthropic", variant: "" },
  time: { created: 1000000 },
}

const baseAssistant: SessionMessageAssistant = {
  id: "msg_123",
  type: "assistant",
  agent: "build",
  model: { id: "claude-sonnet-4-20250514", providerID: "anthropic", variant: "" },
  content: [],
  time: { created: 1000000, completed: 1005400 },
}

// assistantMetadata disabled so content formatting is isolated from the header
const contentOptions = { thinking: true, toolDetails: true, assistantMetadata: false }

describe("transcript", () => {
  describe("formatAssistantHeader", () => {
    test("includes metadata when enabled", () => {
      const result = formatAssistantHeader(baseAssistant, true)
      expect(result).toBe("## Assistant (Build · claude-sonnet-4-20250514 · 5.4s)\n\n")
    })

    test("uses model display name when available", () => {
      const result = formatAssistantHeader(baseAssistant, true, providers)
      expect(result).toBe("## Assistant (Build · Claude Sonnet 4 · 5.4s)\n\n")
    })

    test("excludes metadata when disabled", () => {
      const result = formatAssistantHeader(baseAssistant, false)
      expect(result).toBe("## Assistant\n\n")
    })

    test("handles missing completed time", () => {
      const msg = { ...baseAssistant, time: { created: 1000000 } }
      const result = formatAssistantHeader(msg, true)
      expect(result).toBe("## Assistant (Build · claude-sonnet-4-20250514)\n\n")
    })

    test("titlecases agent name", () => {
      const msg = { ...baseAssistant, agent: "plan" }
      const result = formatAssistantHeader(msg, true)
      expect(result).toContain("Plan")
    })
  })

  describe("formatMessage assistant content", () => {
    test("formats text content", () => {
      const msg = { ...baseAssistant, content: [{ type: "text" as const, text: "Hello world" }] }
      const result = formatMessage(msg, contentOptions)
      expect(result).toBe("## Assistant\n\nHello world\n\n")
    })

    test("formats reasoning when thinking enabled", () => {
      const msg = {
        ...baseAssistant,
        content: [{ type: "reasoning" as const, id: "rsn_1", text: "Let me think..." }],
      }
      const result = formatMessage(msg, contentOptions)
      expect(result).toBe("## Assistant\n\n_Thinking:_\n\nLet me think...\n\n")
    })

    test("skips reasoning when thinking disabled", () => {
      const msg = {
        ...baseAssistant,
        content: [{ type: "reasoning" as const, id: "rsn_1", text: "Let me think..." }],
      }
      const result = formatMessage(msg, { ...contentOptions, thinking: false })
      expect(result).toBe("## Assistant\n\n")
    })

    test("formats tool content with details", () => {
      const msg: SessionMessageAssistant = {
        ...baseAssistant,
        content: [
          {
            type: "tool",
            id: "tool_1",
            name: "bash",
            state: {
              status: "completed",
              input: { command: "ls" },
              content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
              structured: {},
            },
            time: { created: 1000 },
          },
        ],
      }
      const result = formatMessage(msg, contentOptions)
      expect(result).toContain("**Tool: bash**")
      expect(result).toContain("**Input:**")
      expect(result).toContain('"command": "ls"')
      expect(result).toContain("**Output:**")
      expect(result).toContain("file1.txt")
    })

    test("formats tool output containing triple backticks without breaking markdown", () => {
      const msg: SessionMessageAssistant = {
        ...baseAssistant,
        content: [
          {
            type: "tool",
            id: "tool_1",
            name: "bash",
            state: {
              status: "completed",
              input: { command: "echo '```hello```'" },
              content: [{ type: "text", text: "```hello```" }],
              structured: {},
            },
            time: { created: 1000 },
          },
        ],
      }
      const result = formatMessage(msg, contentOptions)
      // The tool header should not be inside a code block
      expect(result).toStartWith("## Assistant\n\n**Tool: bash**\n")
      // Input and output should each be in their own code blocks
      expect(result).toContain("**Input:**\n```json")
      expect(result).toContain("**Output:**\n```\n```hello```\n```")
    })

    test("formats tool content without details when disabled", () => {
      const msg: SessionMessageAssistant = {
        ...baseAssistant,
        content: [
          {
            type: "tool",
            id: "tool_1",
            name: "bash",
            state: {
              status: "completed",
              input: { command: "ls" },
              content: [{ type: "text", text: "file1.txt" }],
              structured: {},
            },
            time: { created: 1000 },
          },
        ],
      }
      const result = formatMessage(msg, { ...contentOptions, toolDetails: false })
      expect(result).toContain("**Tool: bash**")
      expect(result).not.toContain("**Input:**")
      expect(result).not.toContain("**Output:**")
    })

    test("formats tool error", () => {
      const msg: SessionMessageAssistant = {
        ...baseAssistant,
        content: [
          {
            type: "tool",
            id: "tool_1",
            name: "bash",
            state: {
              status: "error",
              input: { command: "invalid" },
              content: [],
              structured: {},
              error: { type: "unknown", message: "Command failed" },
            },
            time: { created: 1000 },
          },
        ],
      }
      const result = formatMessage(msg, contentOptions)
      expect(result).toContain("**Error:**")
      expect(result).toContain("Command failed")
    })
  })

  describe("formatMessage user", () => {
    test("formats user message", () => {
      const result = formatMessage(baseUser, contentOptions)
      expect(result).toContain("## User")
      expect(result).toContain("Hello")
    })

    test("formats file attachments", () => {
      const msg: SessionMessageUser = {
        ...baseUser,
        files: [{ uri: "file:///tmp/report.pdf", mime: "application/pdf", name: "report.pdf" }],
      }
      const result = formatMessage(msg, contentOptions)
      expect(result).toContain("_Attachment: report.pdf (application/pdf)_")
    })
  })

  describe("formatMessage assistant metadata", () => {
    const options = { thinking: true, toolDetails: true, assistantMetadata: true, providers }

    test("formats assistant message with metadata", () => {
      const msg: SessionMessageAssistant = {
        ...baseAssistant,
        content: [{ type: "text", text: "Hi there" }],
      }
      const result = formatMessage(msg, options, providers)
      expect(result).toContain("## Assistant (Build · Claude Sonnet 4 · 5.4s)")
      expect(result).toContain("Hi there")
    })
  })

  describe("formatTranscript", () => {
    const session = {
      id: "ses_abc123",
      title: "Test Session",
      time: { created: 1000000000000, updated: 1000000001000 },
    }

    test("formats complete transcript", () => {
      const messages: SessionMessage[] = [
        { ...baseUser, id: "msg_1", text: "Hello", time: { created: 1000000000000 } },
        {
          ...baseAssistant,
          id: "msg_2",
          content: [{ type: "text", text: "Hi!" }],
          time: { created: 1000000000100, completed: 1000000000600 },
        },
      ]
      const options = {
        thinking: false,
        toolDetails: false,
        assistantMetadata: true,
        providers,
      }

      const result = formatTranscript(session, messages, options)

      expect(result).toContain("# Test Session")
      expect(result).toContain("**Session ID:** ses_abc123")
      expect(result).toContain("## User")
      expect(result).toContain("Hello")
      expect(result).toContain("## Assistant (Build · Claude Sonnet 4 · 0.5s)")
      expect(result).toContain("Hi!")
      expect(result).toContain("---")
    })

    test("falls back to raw model id when provider data is missing", () => {
      const messages: SessionMessage[] = [
        {
          ...baseAssistant,
          id: "msg_1",
          content: [{ type: "text", text: "Response" }],
          time: { created: 1000000000100, completed: 1000000000600 },
        },
      ]

      const result = formatTranscript(session, messages, {
        thinking: false,
        toolDetails: false,
        assistantMetadata: true,
      })

      expect(result).toContain("## Assistant (Build · claude-sonnet-4-20250514 · 0.5s)")
    })

    test("formats transcript without assistant metadata", () => {
      const messages: SessionMessage[] = [
        {
          ...baseAssistant,
          id: "msg_1",
          content: [{ type: "text", text: "Response" }],
          time: { created: 1000000000100, completed: 1000000000600 },
        },
      ]
      const options = { thinking: false, toolDetails: false, assistantMetadata: false }

      const result = formatTranscript(session, messages, options)

      expect(result).toContain("## Assistant\n\n")
      expect(result).not.toContain("Build")
      expect(result).not.toContain("claude-sonnet-4-20250514")
    })
  })
})
