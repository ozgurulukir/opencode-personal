// Type definitions for the session-data reducer.
//
// These types define the mutable accumulator (SessionData), the input/output
// contracts for the reducer, and internal helper types used across handlers.
import type { Event, PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2"
import type { FooterOutput, FooterPatch, FooterView, StreamCommit } from "../types"

export type Tokens = {
  input?: number
  output?: number
  reasoning?: number
  cache?: {
    read?: number
    write?: number
  }
}

export type PartKind = "assistant" | "reasoning" | "user"
export type MessageRole = "assistant" | "user"
export type Dict = Record<string, unknown>
export type SessionCommit = StreamCommit

// Mutable accumulator for the reducer. Each field tracks a different aspect
// of the stream so we can produce correct incremental output:
//
// - ids:    parts and error keys we've already committed (dedup guard)
// - tools:  tool parts we've emitted a "start" for but not yet completed
// - call:   tool call inputs, keyed by msg:call, for enriching permission views
// - role:   message ID → "assistant" | "user", learned from message.updated
// - msg:    part ID → message ID
// - part:   part ID → "assistant" | "reasoning" (text parts only)
// - text:   part ID → full accumulated text so far
// - sent:   part ID → byte offset of last flushed text (for incremental output)
// - end:    part IDs whose time.end has arrived (part is finished)
// - echo:   message ID → bash outputs to strip from the next assistant chunk
export type SessionData = {
  includeUserText: boolean
  announced: boolean
  ids: Set<string>
  tools: Set<string>
  call: Map<string, Dict>
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  role: Map<string, MessageRole>
  msg: Map<string, string>
  part: Map<string, PartKind>
  text: Map<string, string>
  sent: Map<string, number>
  end: Set<string>
  echo: Map<string, Set<string>>
}

export type SessionDataInput = {
  data: SessionData
  event: Event
  sessionID: string
  thinking: boolean
  limits: Record<string, number>
}

export type SessionDataOutput = {
  data: SessionData
  commits: SessionCommit[]
  footer?: FooterOutput
}

export type { FooterOutput, FooterPatch, FooterView, StreamCommit }
