// Shared utilities for the session-data reducer.
//
// Pure helpers and data-mutation primitives used across all event handlers.
// No event-specific logic lives here -- that goes in handlers/.
import * as Locale from "@/util/locale"
import type { Part, PermissionRequest, QuestionRequest, ToolPart } from "@opencode-ai/sdk/v2"
import type { FooterOutput, FooterPatch, FooterView } from "../types"
import type { Dict, MessageRole, PartKind, SessionCommit, SessionData, SessionDataOutput, Tokens } from "./types"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function modelKey(provider: string, model: string): string {
  return `${provider}/${model}`
}

export function formatUsage(
  tokens: Tokens | undefined,
  limit: number | undefined,
  cost: number | undefined,
): string | undefined {
  const total =
    (tokens?.input ?? 0) +
    (tokens?.output ?? 0) +
    (tokens?.reasoning ?? 0) +
    (tokens?.cache?.read ?? 0) +
    (tokens?.cache?.write ?? 0)

  if (total <= 0) {
    if (typeof cost === "number" && cost > 0) {
      return money.format(cost)
    }
    return undefined
  }

  const text =
    limit && limit > 0 ? `${Locale.number(total)} (${Math.round((total / limit) * 100)}%)` : Locale.number(total)

  if (typeof cost === "number" && cost > 0) {
    return `${text} · ${money.format(cost)}`
  }

  return text
}

export function formatError(error: {
  name?: string
  message?: string
  data?: {
    message?: string
  }
}): string {
  // Error is a discriminated union keyed by "name":
  //   "APIError" / "AbortedError" / etc. → message field
  //   "UnknownError" → data.message field
  return error.data?.message ?? error.message ?? error.name ?? "unknown error"
}

export function isAbort(error: { name?: string } | undefined): boolean {
  return error?.name === "MessageAbortedError"
}

export function msgErr(id: string): string {
  return `msg:${id}:error`
}

export function patch(patch?: FooterPatch, view?: FooterView): FooterOutput | undefined {
  if (!patch && !view) {
    return undefined
  }

  return {
    patch,
    view,
  }
}

export function out(data: SessionData, commits: SessionCommit[], footer?: FooterOutput): SessionDataOutput {
  if (!footer) {
    return { data, commits }
  }

  return { data, commits, footer }
}

export function pickBlockerView(input: { permission?: PermissionRequest; question?: QuestionRequest }): FooterView {
  if (input.permission) {
    return { type: "permission", request: input.permission }
  }

  if (input.question) {
    return { type: "question", request: input.question }
  }

  return { type: "prompt" }
}

export function blockerStatus(view: FooterView) {
  if (view.type === "permission") {
    return "awaiting permission"
  }

  if (view.type === "question") {
    return "awaiting answer"
  }

  return ""
}

export function pickSessionView(data: SessionData): FooterView {
  return pickBlockerView({
    permission: data.permissions[0],
    question: data.questions[0],
  })
}

export function queueFooter(data: SessionData): FooterOutput {
  const view = pickSessionView(data)

  return {
    view,
    patch: { status: blockerStatus(view) },
  }
}

export function queueOut(data: SessionData, commits: SessionCommit[]): SessionDataOutput {
  return out(data, commits, queueFooter(data))
}

export function upsert<T extends { id: string }>(list: T[], item: T) {
  const idx = list.findIndex((entry) => entry.id === item.id)
  if (idx === -1) {
    list.push(item)
    return
  }

  list[idx] = item
}

export function remove(list: Array<{ id: string }>, id: string): boolean {
  const idx = list.findIndex((entry) => entry.id === id)
  if (idx === -1) {
    return false
  }

  list.splice(idx, 1)
  return true
}

export function key(msg: string, call: string): string {
  return `${msg}:${call}`
}

export function enrichPermission(data: SessionData, request: PermissionRequest): PermissionRequest {
  if (!request.tool) {
    return request
  }

  const input = data.call.get(key(request.tool.messageID, request.tool.callID))
  if (!input) {
    return request
  }

  const meta = request.metadata ?? {}
  if (meta.input === input) {
    return request
  }

  return {
    ...request,
    metadata: {
      ...meta,
      input,
    },
  }
}

// Updates the active permission request when the matching tool part gets
// new input (e.g., a diff). This keeps the permission UI in sync with the
// tool's evolving state. Only triggers a footer update if the currently
// displayed permission was the one that changed.
export function syncPermission(data: SessionData, part: ToolPart): FooterOutput | undefined {
  data.call.set(key(part.messageID, part.callID), part.state.input)
  if (data.permissions.length === 0) {
    return undefined
  }

  let changed = false
  let active = false
  data.permissions = data.permissions.map((request, index) => {
    if (!request.tool || request.tool.messageID !== part.messageID || request.tool.callID !== part.callID) {
      return request
    }

    const next = enrichPermission(data, request)
    if (next === request) {
      return request
    }

    changed = true
    active ||= index === 0
    return next
  })

  if (!changed || !active) {
    return undefined
  }

  return {
    view: pickSessionView(data),
  }
}

// Question tool replies can complete without a matching question.replied event.
// When that happens, drop the recovered pending request tied to this tool call so
// the footer can return to the next blocker or to the prompt.
export function syncQuestion(data: SessionData, part: ToolPart): FooterOutput | undefined {
  if (part.tool !== "question") {
    return undefined
  }

  if (part.state.status !== "completed" && part.state.status !== "error") {
    return undefined
  }

  const next = data.questions.filter(
    (request) => request.tool?.messageID !== part.messageID || request.tool?.callID !== part.callID,
  )
  if (next.length === data.questions.length) {
    return undefined
  }

  data.questions = next
  return queueFooter(data)
}

export function toolStatus(part: ToolPart): string {
  if (part.tool !== "task") {
    return `running ${part.tool}`
  }

  const state = part.state as {
    input?: {
      description?: unknown
      subagent_type?: unknown
    }
  }
  const desc = state.input?.description
  if (typeof desc === "string" && desc.trim()) {
    return `running ${desc.trim()}`
  }

  const type = state.input?.subagent_type
  if (typeof type === "string" && type.trim()) {
    return `running ${type.trim()}`
  }

  return "running task"
}

// Returns true if we can flush this part's text to scrollback.
//
// We gate on the message role being "assistant" because user-role messages
// also contain text parts (the user's own input) which we don't want to
// echo. If we haven't received the message.updated event yet, we return
// false and the text stays buffered until replay() flushes it.
export function ready(data: SessionData, partID: string): boolean {
  const msg = data.msg.get(partID)
  if (!msg) {
    return true
  }

  const role = data.role.get(msg)
  if (!role) {
    return false
  }

  if (role === "assistant") {
    return true
  }

  return data.includeUserText && role === "user"
}

export function syncText(data: SessionData, partID: string, next: string) {
  const prev = data.text.get(partID) ?? ""
  if (!next) {
    return prev
  }

  if (!prev || next.length >= prev.length) {
    data.text.set(partID, next)
    return next
  }

  return prev
}

// Records bash tool output for echo stripping. Some models echo bash output
// verbatim at the start of their next text part. We save both the raw and
// trimmed forms so stripEcho() can match either.
export function stashEcho(data: SessionData, part: ToolPart) {
  if (part.tool !== "bash") {
    return
  }

  if (typeof part.messageID !== "string" || !part.messageID) {
    return
  }

  const output = "output" in part.state ? part.state.output : undefined
  if (typeof output !== "string") {
    return
  }

  const text = output.replace(/^\n+/, "")
  if (!text.trim()) {
    return
  }

  const set = data.echo.get(part.messageID) ?? new Set<string>()
  set.add(text)
  const trim = text.replace(/\n+$/, "")
  if (trim && trim !== text) {
    set.add(trim)
  }
  data.echo.set(part.messageID, set)
}

export function stripEcho(data: SessionData, msg: string | undefined, chunk: string): string {
  if (!msg) {
    return chunk
  }

  const set = data.echo.get(msg)
  if (!set || set.size === 0) {
    return chunk
  }

  data.echo.delete(msg)
  const list = [...set].sort((a, b) => b.length - a.length)
  for (const item of list) {
    if (!item || !chunk.startsWith(item)) {
      continue
    }

    return chunk.slice(item.length).replace(/^\n+/, "")
  }

  return chunk
}

export function flushPart(data: SessionData, commits: SessionCommit[], partID: string, interrupted = false) {
  const kind = data.part.get(partID)
  if (!kind) {
    return
  }

  const text = data.text.get(partID) ?? ""
  const sent = data.sent.get(partID) ?? 0
  let chunk = text.slice(sent)
  const msg = data.msg.get(partID)

  if (sent === 0) {
    chunk = chunk.replace(/^\n+/, "")
    // Some models emit a standalone whitespace token before real content.
    // Keep buffering until we have visible text so scrollback doesn't get a blank row.
    if (!chunk.trim()) {
      return
    }
    if (kind === "reasoning" && chunk) {
      chunk = `Thinking: ${chunk.replace(/\[REDACTED\]/g, "")}`
    }
    if (kind === "assistant" && chunk) {
      chunk = stripEcho(data, msg, chunk)
      if (!chunk.trim()) {
        return
      }
    }
  }

  if (chunk) {
    data.sent.set(partID, text.length)
    commits.push({
      kind,
      text: chunk,
      phase: "progress",
      source: kind === "user" ? "system" : kind,
      messageID: msg,
      partID,
    })
  }

  if (!interrupted) {
    return
  }

  commits.push({
    kind,
    text: "",
    phase: "final",
    source: kind === "user" ? "system" : kind,
    messageID: msg,
    partID,
    interrupted: true,
  })
}

export function drop(data: SessionData, partID: string) {
  data.part.delete(partID)
  data.text.delete(partID)
  data.sent.delete(partID)
  data.msg.delete(partID)
  data.end.delete(partID)
}

// Called when we learn a message's role (from message.updated). Flushes any
// buffered text parts that were waiting on role confirmation. User-role
// parts are silently dropped.
export function replay(data: SessionData, commits: SessionCommit[], messageID: string, role: MessageRole, thinking: boolean) {
  for (const [partID, msg] of data.msg.entries()) {
    if (msg !== messageID || data.ids.has(partID)) {
      continue
    }

    if (role === "user" && !data.includeUserText) {
      data.ids.add(partID)
      drop(data, partID)
      continue
    }

    const kind = data.part.get(partID)
    if (!kind) {
      continue
    }

    if (role === "user" && kind === "assistant") {
      data.part.set(partID, "user")
    }

    if (kind === "reasoning" && !thinking) {
      if (data.end.has(partID)) {
        data.ids.add(partID)
      }
      drop(data, partID)
      continue
    }

    flushPart(data, commits, partID)

    if (!data.end.has(partID)) {
      continue
    }

    data.ids.add(partID)
    drop(data, partID)
  }
}

export function toolCommit(
  part: ToolPart,
  next: Pick<SessionCommit, "text" | "phase" | "toolState"> & { toolError?: string },
): SessionCommit {
  return {
    kind: "tool",
    source: "tool",
    messageID: part.messageID,
    partID: part.id,
    tool: part.tool,
    part,
    ...next,
  }
}

export function startTool(part: ToolPart): SessionCommit {
  return toolCommit(part, {
    text: toolStatus(part),
    phase: "start",
    toolState: "running",
  })
}

export function doneTool(part: ToolPart): SessionCommit {
  return toolCommit(part, {
    text: "",
    phase: "final",
    toolState: "completed",
  })
}

export function failTool(part: ToolPart, text: string): SessionCommit {
  return toolCommit(part, {
    text,
    phase: "final",
    toolState: "error",
    toolError: text,
  })
}

// Emits "interrupted" final entries for all in-flight parts. Called when a turn is aborted.
export function flushInterrupted(data: SessionData, commits: SessionCommit[]) {
  for (const partID of data.part.keys()) {
    if (data.ids.has(partID)) {
      continue
    }

    const msg = data.msg.get(partID)
    if (msg && data.role.get(msg) === "user" && !data.includeUserText) {
      data.ids.add(partID)
      drop(data, partID)
      continue
    }

    flushPart(data, commits, partID, true)
    data.ids.add(partID)
    drop(data, partID)
  }
}

export function createSessionData(
  input: {
    includeUserText?: boolean
  } = {},
): SessionData {
  return {
    includeUserText: input.includeUserText ?? false,
    announced: false,
    ids: new Set(),
    tools: new Set(),
    call: new Map(),
    permissions: [],
    questions: [],
    role: new Map(),
    msg: new Map(),
    part: new Map(),
    text: new Map(),
    sent: new Map(),
    end: new Set(),
    echo: new Map(),
  }
}

export function bootstrapSessionData(input: {
  data: SessionData
  messages: Array<{
    parts: Part[]
  }>
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
}) {
  for (const message of input.messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") {
        continue
      }

      const toolPart = part as unknown as { messageID: string; callID: string; state: { input: Dict } }
      input.data.call.set(key(toolPart.messageID, toolPart.callID), toolPart.state.input)
    }
  }

  for (const request of input.permissions.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    upsert(input.data.permissions, enrichPermission(input.data, request))
  }

  for (const request of input.questions.slice().sort((a, b) => a.id.localeCompare(b.id))) {
    upsert(input.data.questions, request)
  }
}
