// @ts-nocheck
/**
 * Shared mock data factories for SessionTurn Storybook stories.
 * Extracted from timeline-playground.stories.tsx for reusability.
 */

import type {
  Message,
  UserMessage,
  AssistantMessage,
  Part,
  TextPart,
  ReasoningPart,
  ToolPart,
  FilePart,
  AgentPart,
  CompactionPart,
  SummaryDiff,
} from "@opencode-ai/sdk/v2"

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------
let seq = 0
export const uid = (prefix = "id") => `${prefix}-${++seq}-${Date.now().toString(36)}`

// ---------------------------------------------------------------------------
// Part factories
// ---------------------------------------------------------------------------
export function textPart(text: string): TextPart {
  return {
    id: uid("text"),
    type: "text",
    text,
    start_time: Date.now() / 1000,
    end_time: Date.now() / 1000 + 1,
  }
}

export function reasoningPart(text: string): ReasoningPart {
  return {
    id: uid("reasoning"),
    type: "reasoning",
    text,
    start_time: Date.now() / 1000,
    end_time: Date.now() / 1000 + 1,
  }
}

export function toolPart(
  sample: { tool: string; input: any; output?: string; title?: string; metadata?: any },
  status: "running" | "completed" | "error" = "completed",
): ToolPart {
  return {
    id: uid("tool"),
    type: "tool",
    tool: sample.tool,
    input: sample.input,
    output: sample.output ?? "",
    title: sample.title,
    metadata: sample.metadata ?? {},
    status,
    start_time: Date.now() / 1000,
    end_time: status === "running" ? undefined : Date.now() / 1000 + 1,
  }
}

export function compactionPart(auto: boolean): CompactionPart {
  return {
    id: uid("compaction"),
    type: "compaction",
    auto,
    start_time: Date.now() / 1000,
    end_time: Date.now() / 1000 + 1,
  }
}

export function filePart(filename: string, mime: string = "text/plain"): FilePart {
  return {
    id: uid("file"),
    type: "file",
    mime,
    filename,
    url: `data:${mime};base64,dGVzdC1maWxlLWNvbnRlbnQ=`,
  }
}

export function agentPart(name: string): AgentPart {
  return {
    id: uid("agent"),
    type: "agent",
    name,
    source: { start: 0, end: 10 },
  }
}

// ---------------------------------------------------------------------------
// Message factories
// ---------------------------------------------------------------------------
export function mkUser(
  text: string,
  parts: Part[] = [],
  sessionID: string = "story-session",
): { message: UserMessage; parts: Part[] } {
  const id = uid("user")
  return {
    message: {
      id,
      session_id: sessionID,
      role: "user",
      type: "message",
      created_at: Date.now() / 1000,
    },
    parts: [
      textPart(text),
      ...parts,
    ],
  }
}

export function mkAssistant(
  parentID: string,
  sessionID: string = "story-session",
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id: uid("asst"),
    session_id: sessionID,
    role: "assistant",
    type: "message",
    parent: parentID,
    created_at: Date.now() / 1000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Diff factories
// ---------------------------------------------------------------------------
export function mkDiff(
  file: string,
  additions: number,
  deletions: number,
  status: "modified" | "added" | "deleted" = "modified",
  patch?: string,
): SummaryDiff {
  return {
    file,
    status,
    additions,
    deletions,
    patch: patch ?? `@@ -1,${additions + deletions} +1,${additions + deletions} @@\n-test line\n+new line\n`,
  }
}

// ---------------------------------------------------------------------------
// Error factories
// ---------------------------------------------------------------------------
export function mkError(name: string, message: string) {
  return {
    name,
    message,
    data: { error: message },
  }
}

// ---------------------------------------------------------------------------
// Session status factories
// ---------------------------------------------------------------------------
export function mkSessionStatus(
  type: "idle" | "busy" | "working",
  overrides: Record<string, any> = {},
) {
  return {
    type,
    session_id: "story-session",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Pre-built samples
// ---------------------------------------------------------------------------
export const TOOL_SAMPLES = {
  read: {
    tool: "read",
    input: { filePath: "src/components/session-turn.tsx", offset: 1, limit: 50 },
    output: "export function SessionTurn(props) { ... }",
    title: "Read src/components/session-turn.tsx",
    metadata: {},
  },
  glob: {
    tool: "glob",
    input: { pattern: "**/*.tsx", path: "src/components" },
    output: "src/components/button.tsx\nsrc/components/card.tsx\nsrc/components/session-turn.tsx",
    title: "Found 3 files",
    metadata: {},
  },
  grep: {
    tool: "grep",
    input: { pattern: "SessionTurn", path: "src", include: "*.tsx" },
    output: "src/components/session-turn.tsx:141\nsrc/pages/session/timeline.tsx:987",
    title: "Found 2 matches",
    metadata: {},
  },
  bash: {
    tool: "bash",
    input: { command: "bun test --filter session", description: "Run session tests" },
    output: "bun test v1.3.13\n\n✓ session-turn.test.tsx (3 tests) 45ms\n\nTest Suites: 2 passed, 2 total",
    title: "Run session tests",
    metadata: { command: "bun test --filter session" },
  },
  edit: {
    tool: "edit",
    input: {
      filePath: "src/components/session-turn.tsx",
      oldString: "gap: 12px",
      newString: "gap: 18px",
    },
    output: "File edited successfully",
    title: "Edit src/components/session-turn.tsx",
    metadata: {
      filediff: {
        file: "src/components/session-turn.tsx",
        before: "  gap: 12px;\n  display: flex;",
        after: "  gap: 18px;\n  display: flex;",
        additions: 1,
        deletions: 1,
      },
    },
  },
  write: {
    tool: "write",
    input: {
      filePath: "src/utils/helpers.ts",
      content: "export function clamp(value: number, min: number, max: number) {\n  return Math.min(Math.max(value, min), max)\n}\n",
    },
    output: "File written successfully",
    title: "Write src/utils/helpers.ts",
    metadata: {},
  },
  task: {
    tool: "task",
    input: { description: "Explore components", subagent_type: "explore", prompt: "Find all session components" },
    output: "Found 12 session-related components across 3 directories.",
    title: "Agent (Explore)",
    metadata: { sessionId: "sub-session-1" },
  },
  webfetch: {
    tool: "webfetch",
    input: { url: "https://solidjs.com/docs/latest/api" },
    output: "# SolidJS API Reference\n\nCore primitives for building reactive applications...",
    title: "Fetch https://solidjs.com/docs/latest/api",
    metadata: {},
  },
  websearch: {
    tool: "websearch",
    input: { query: "SolidJS createStore performance" },
    output: "https://solidjs.com/docs/latest/api\nhttps://dev.to/solidjs/understanding-solid-reactivity",
    title: "Search: SolidJS createStore performance",
    metadata: {},
  },
  question: {
    tool: "question",
    input: {
      questions: [
        {
          question: "Which approach do you prefer?",
          header: "Approach",
          options: [
            { label: "Wrapper component", description: "Create a new wrapper around SessionTurn" },
            { label: "Direct modification", description: "Modify SessionTurn directly" },
          ],
        },
      ],
    },
    output: "",
    title: "Question",
    metadata: { answers: [["Wrapper component"]] },
  },
  skill: {
    tool: "skill",
    input: { name: "playwriter" },
    output: "Skill loaded successfully",
    title: "playwriter",
    metadata: {},
  },
  todowrite: {
    tool: "todowrite",
    input: { todos: [{ content: "Implement feature", status: "in_progress" }] },
    output: "Todo list updated",
    title: "Update todos",
    metadata: {},
  },
}

export const MARKDOWN_SAMPLES = {
  short: "This is a short response with **bold** and `code`.",
  medium: `## Implementation Plan

I'll make the following changes:

1. **Update the schema** - Add new fields to the database model
2. **Create the API endpoint** - Handle validation and persistence
3. **Add frontend components** - Build the form and display views

Here's the key change:

\`\`\`typescript
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})
\`\`\``,

  long: `## Detailed Analysis

After reviewing the codebase, I've identified several areas for improvement.

### Current Issues

1. **Performance bottleneck** - The message rendering pipeline blocks first paint
2. **Memory usage** - All messages are loaded eagerly
3. **Layout shift** - No reserved space for loading states

### Proposed Solution

I recommend implementing virtual scrolling with the following approach:

\`\`\`typescript
function VirtualMessageList(props) {
  const [visibleRange, setVisibleRange] = createSignal({ start: 0, end: 20 })
  
  // Calculate visible range based on scroll position
  const handleScroll = (e) => {
    const scrollTop = e.target.scrollTop
    const viewportHeight = e.target.clientHeight
    const itemHeight = 100 // approximate
    
    const start = Math.floor(scrollTop / itemHeight)
    const end = start + Math.ceil(viewportHeight / itemHeight) + 5 // buffer
    
    setVisibleRange({ start, end })
  }
  
  return (
    <div class="virtual-list" onScroll={handleScroll}>
      <For each={props.messages.slice(visibleRange().start, visibleRange().end)}>
        {(msg) => <MessageTurn message={msg} />}
      </For>
    </div>
  )
}
\`\`\`

### Benefits

- **Faster initial load** - Only renders visible messages
- **Reduced memory** - Unmounts off-screen messages
- **Better UX** - Smooth scrolling with minimal jank

### Trade-offs

- More complex implementation
- Need to handle scroll position restoration
- Accessibility considerations for screen readers

---

Let me know if you'd like me to proceed with this implementation!`,

  code: `Here's the implementation:

\`\`\`typescript
import { createSignal, For } from "solid-js"

export function MessageList(props) {
  const [messages, setMessages] = createSignal(props.initial)
  
  const addMessage = (msg) => {
    setMessages(prev => [...prev, msg])
  }
  
  return (
    <div class="message-list">
      <For each={messages()}>
        {(msg) => (
          <div class="message" data-role={msg.role}>
            <MessageContent message={msg} />
          </div>
        )}
      </For>
    </div>
  )
}
\`\`\``,

  mixed: `## Summary

> This is a blockquote with **bold** and \`code\` elements.

Here's a table:

| Feature | Before | After |
|---------|--------|-------|
| Speed | 120ms | 45ms |
| Memory | 256MB | 128MB |

And a [link](https://example.com) for reference.`,
}

export const REASONING_SAMPLES = [
  `**Analyzing the request**

The user wants to add a new feature to the session timeline. I need to understand the existing component structure first.

Let me look at the key files involved:
- \`session-turn.tsx\` handles individual turns
- \`message-part.tsx\` renders different part types
- The data flows through the \`DataProvider\` context`,

  `**Considering approaches**

I could either modify the existing SessionTurn component or create a wrapper. The wrapper approach is cleaner because it doesn't touch the core rendering logic.

The trade-off is that we'd need to pass additional props through, but that's acceptable for this use case.`,

  `**Planning the implementation**

I'll need to:
1. Create the data generators
2. Wire up the context providers
3. Add CSS variable controls
4. Implement the export functionality

This should be straightforward given the existing component architecture.`,
]

export const DIFF_SAMPLES = {
  single: [
    mkDiff("src/components/session-turn.tsx", 5, 2, "modified"),
  ],
  multi: [
    mkDiff("src/components/session-turn.tsx", 10, 5, "modified"),
    mkDiff("src/components/session-turn-diffs.tsx", 8, 3, "modified"),
    mkDiff("src/components/session-turn-header.tsx", 15, 0, "added"),
    mkDiff("src/components/session-turn-thinking.tsx", 12, 2, "modified"),
    mkDiff("src/components/session-turn-mock.ts", 200, 0, "added"),
  ],
  overflow: Array.from({ length: 15 }, (_, i) =>
    mkDiff(`src/components/file-${i + 1}.tsx`, Math.floor(Math.random() * 20), Math.floor(Math.random() * 10), "modified"),
  ),
}

// ---------------------------------------------------------------------------
// High-level turn builder
// ---------------------------------------------------------------------------
export function mkTurn(config: {
  text?: string
  toolCount?: number
  toolNames?: string[]
  reasoningText?: string
  diffs?: SummaryDiff[]
  error?: { name: string; message: string }
  compaction?: boolean
  active?: boolean
}) {
  const sessionID = "story-session"
  const userText = config.text ?? "Fix the bug in the login form"
  const user = mkUser(userText, [], sessionID)
  
  const assistant = mkAssistant(user.message.id, sessionID, {
    error: config.error,
  })
  
  const assistantParts: Part[] = []
  
  // Add reasoning if requested
  if (config.reasoningText) {
    assistantParts.push(reasoningPart(config.reasoningText))
  }
  
  // Add tool parts if requested
  const toolNames = config.toolNames ?? ["bash", "edit", "read", "glob"]
  const toolCount = config.toolCount ?? 0
  for (let i = 0; i < Math.min(toolCount, toolNames.length); i++) {
    const toolName = toolNames[i] as keyof typeof TOOL_SAMPLES
    const sample = TOOL_SAMPLES[toolName]
    if (sample) {
      assistantParts.push(toolPart(sample, "completed"))
    }
  }
  
  // Add text response
  assistantParts.push(textPart(config.text ?? MARKDOWN_SAMPLES.short))
  
  // Add compaction part if requested
  if (config.compaction) {
    assistantParts.push(compactionPart(true))
  }
  
  return {
    user: user.message,
    assistant,
    userParts: user.parts,
    assistantParts,
    diffs: config.diffs ?? [],
    status: mkSessionStatus(config.active ? "busy" : "idle"),
  }
}
