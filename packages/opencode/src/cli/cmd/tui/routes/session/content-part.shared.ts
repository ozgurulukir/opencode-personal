import type {
  SessionMessageAssistant,
  ToolPart,
  TextPart,
  ReasoningPart,
} from "@opencode-ai/sdk/v2"

// V2 content items → V1-shaped parts so the ~15 tool renderers stay untouched.
// structured→metadata, text content join→output, item-level time→state time.
export function contentPartFromV2(
  item: SessionMessageAssistant["content"][number],
  message: SessionMessageAssistant,
  index: number,
): ToolPart | TextPart | ReasoningPart {
  if (item.type === "text") {
    return {
      id: `${message.id}-text-${index}`,
      sessionID: "",
      messageID: message.id,
      type: "text",
      text: item.text,
      time: { start: message.time.created },
    }
  }
  if (item.type === "reasoning") {
    return {
      id: item.id,
      sessionID: "",
      messageID: message.id,
      type: "reasoning",
      text: item.text,
      time: { start: message.time.created },
    }
  }
  const input = typeof item.state.input === "string" ? {} : item.state.input
  const base = {
    id: item.id,
    sessionID: "",
    messageID: message.id,
    type: "tool" as const,
    callID: item.id,
    tool: item.name,
  }
  switch (item.state.status) {
    case "pending":
      return { ...base, state: { status: "pending", input, raw: item.state.input } }
    case "running":
      return {
        ...base,
        state: { status: "running", input, metadata: item.state.structured, time: { start: item.time.created } },
      }
    case "completed":
      return {
        ...base,
        state: {
          status: "completed",
          input,
          output: item.state.content
            .filter((x) => x.type === "text")
            .map((x) => x.text)
            .join("\n"),
          title: "",
          metadata: item.state.structured,
          time: { start: item.time.created, end: item.time.completed ?? item.time.created, compacted: item.time.pruned },
        },
      }
    case "error":
      return {
        ...base,
        state: {
          status: "error",
          input,
          error: item.state.error.message,
          metadata: item.state.structured,
          time: { start: item.time.created, end: item.time.completed ?? item.time.created },
        },
      }
  }
}
