import type { ModelMessage } from "ai"
import { removeEmptyContent as removeEmptyContentFor } from "./remove-empty-content"

export function removeEmptyContent(msgs: ModelMessage[]): ModelMessage[] {
  return removeEmptyContentFor(msgs, "bedrock")
}

export * as TransformBedrock from "./bedrock"
