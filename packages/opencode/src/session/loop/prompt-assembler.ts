import { MessageV2 } from "../message-v2"
import { STRUCTURED_OUTPUT_SYSTEM_PROMPT } from "../prompt/structured-output"

// ⚡ Bolt Optimization: Replace chained .filter().map().join(" ") with a single loop to reduce GC pressure and O(N) traversals
export function extractUserText(parts: MessageV2.Part[] | undefined): string | undefined {
  if (!parts) return undefined
  const texts: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p.type === "text") {
      texts.push(p.text)
    }
  }
  return texts.join(" ")
}

export interface PromptSuffixInput {
  env: string[]
  skills?: string
  modelHasToolcall: boolean
  formatType?: string
  lastUserSystem?: string
}

export function assemblePromptSuffix(input: PromptSuffixInput): string {
  const suffixParts = [
    ...input.env,
    ...(input.skills ? [input.skills] : []),
    ...(!input.modelHasToolcall
      ? [
          "The selected model does not support tool calls. Do not attempt to use tools; explain when a requested action requires them.",
        ]
      : []),
    ...(input.formatType === "json_schema"
      ? [
          input.modelHasToolcall
            ? STRUCTURED_OUTPUT_SYSTEM_PROMPT
            : "This model cannot call the StructuredOutput tool required by the requested JSON schema format. Explain this limitation in plain text.",
        ]
      : []),
    ...(input.lastUserSystem ? [input.lastUserSystem] : []),
  ]
  return suffixParts.filter((x) => x).join("\n")
}
