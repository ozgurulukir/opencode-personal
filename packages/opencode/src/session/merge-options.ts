import { mergeDeep } from "remeda"
import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "merge-options" })

// Extracted from llm.ts so the option-merge chain is independently testable
// and so we can add observability later without touching the hot LLM path.
export function mergeOptions(
  target: Record<string, any>,
  source: Record<string, any> | undefined,
  layer?: string,
): Record<string, any> {
  const result = mergeDeep(target, source ?? {}) as Record<string, any>
  if (layer && source && Object.keys(source).length > 0) {
    log.debug("merged", { layer, keys: Object.keys(source) })
  }
  return result
}

export * as MergeOptions from "./merge-options"
