import type { ModelMessage, ToolResultPart } from "ai"

export function sanitizeSurrogates(content: string) {
  return content.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD")
}

function sanitizeToolResultOutput(content: ToolResultPart): ToolResultPart {
  if (content.output.type === "text" || content.output.type === "error-text") {
    return { ...content, output: { ...content.output, value: sanitizeSurrogates(content.output.value) } }
  }
  if (content.output.type === "content") {
    return {
      ...content,
      output: {
        ...content.output,
        value: content.output.value.map((item) =>
          item.type === "text" ? { ...item, text: sanitizeSurrogates(item.text) } : item,
        ),
      },
    }
  }
  return content
}

export function sanitizeMessages(msgs: ModelMessage[]): ModelMessage[] {
  return msgs.map((msg): ModelMessage => {
    switch (msg.role) {
      case "tool":
        if (!Array.isArray(msg.content)) return msg
        return {
          ...msg,
          content: msg.content.map((content) =>
            content.type === "tool-result" ? sanitizeToolResultOutput(content) : content,
          ),
        }

      case "system":
        return { ...msg, content: sanitizeSurrogates(msg.content) }

      case "user":
        if (typeof msg.content === "string") {
          return { ...msg, content: sanitizeSurrogates(msg.content) }
        }
        return {
          ...msg,
          content: msg.content.map((content) =>
            content.type === "text" ? { ...content, text: sanitizeSurrogates(content.text) } : content,
          ),
        }

      case "assistant":
        if (typeof msg.content === "string") {
          return { ...msg, content: sanitizeSurrogates(msg.content) }
        }
        return {
          ...msg,
          content: msg.content.map((content) => {
            if (content.type === "text" || content.type === "reasoning") {
              return { ...content, text: sanitizeSurrogates(content.text) }
            }
            if (content.type === "tool-result") {
              return sanitizeToolResultOutput(content)
            }
            return content
          }),
        }
    }
    return msg
  })
}

export * as TransformSanitize from "./sanitize"
