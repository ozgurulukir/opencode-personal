// Session message extraction and prompt history.
//
// Fetches session messages from the V2 SDK and extracts user turn text for
// the prompt history ring. Also finds the most recently used variant for
// the current model so the footer can pre-select it.
import { promptCopy, promptSame } from "./prompt.shared"
import type { RunInput, RunPrompt } from "./types"
import type { SessionMessage, SessionMessageUser } from "@opencode-ai/sdk/v2"

const LIMIT = 200

export type SessionMessages = SessionMessage[]

type Turn = {
  prompt: RunPrompt
  provider: string | undefined
  model: string | undefined
  variant: string | undefined
}

export type RunSession = {
  first: boolean
  turns: Turn[]
}

function fileName(url: string, filename?: string) {
  if (filename) {
    return filename
  }

  try {
    const next = new URL(url)
    if (next.protocol !== "file:") {
      return url
    }

    const name = next.pathname.split("/").at(-1)
    if (name) {
      return decodeURIComponent(name)
    }
  } catch {}

  return url
}

function fileSource(file: NonNullable<SessionMessageUser["files"]>[number], text: { start: number; end: number; value: string }) {
  // V2 FileAttachment keeps a flat {start, end, text} range — the V1 FilePart
  // union's path/type detail is not preserved, so always emit a file source.
  return {
    type: "file" as const,
    path: file.name ?? file.uri,
    text,
  }
}

function prompt(msg: SessionMessageUser): RunPrompt {
  const parts: RunPrompt["parts"] = []
  // V2 keeps the prompt text inline (non-synthetic, mentions included).
  let text = msg.text
  let cursor = Bun.stringWidth(text)
  const used: Array<{ start: number; end: number }> = []

  const take = (value: string): { start: number; end: number; value: string } | undefined => {
    let from = 0
    while (true) {
      const idx = text.indexOf(value, from)
      if (idx === -1) {
        return undefined
      }

      const start = Bun.stringWidth(text.slice(0, idx))
      const end = start + Bun.stringWidth(value)
      if (!used.some((item) => item.start < end && start < item.end)) {
        return { start, end, value }
      }

      from = idx + value.length
    }
  }

  const add = (value: string) => {
    const gap = text ? " " : ""
    const start = cursor + Bun.stringWidth(gap)
    text += gap + value
    const end = start + Bun.stringWidth(value)
    cursor = end
    return { start, end, value }
  }

  for (const file of msg.files ?? []) {
    const mention = "@" + fileName(file.uri, file.name)
    const span = file.source
      ? { start: file.source.start, end: file.source.end, value: file.source.text }
      : (take(mention) ?? add(mention))
    used.push({ start: span.start, end: span.end })
    parts.push({
      type: "file",
      mime: file.mime,
      filename: file.name,
      url: file.uri,
      source: fileSource(file, span),
    })
  }

  for (const agent of msg.agents ?? []) {
    const mention = "@" + agent.name
    const span = agent.source
      ? { start: agent.source.start, end: agent.source.end, value: agent.source.text }
      : (take(mention) ?? add(mention))
    used.push({ start: span.start, end: span.end })
    parts.push({
      type: "agent",
      name: agent.name,
      source: span,
    })
  }

  return { text, parts }
}

function turn(msg: SessionMessages[number]): Turn | undefined {
  if (msg.type !== "user") {
    return undefined
  }

  return {
    prompt: prompt(msg),
    provider: msg.model.providerID,
    model: msg.model.id,
    variant: msg.model.variant,
  }
}

export function createSession(messages: SessionMessages): RunSession {
  return {
    first: messages.length === 0,
    turns: messages.flatMap((msg) => {
      const item = turn(msg)
      return item ? [item] : []
    }),
  }
}

export async function resolveSession(sdk: RunInput["sdk"], sessionID: string, limit = LIMIT): Promise<RunSession> {
  // V2 read model: newest-first, no limit param — sessionHistory() slices.
  const response = await sdk.v2.session.messages({ sessionID })
  return createSession(response.data?.items ?? [])
}

export function sessionHistory(session: RunSession, limit = LIMIT): RunPrompt[] {
  const out: RunPrompt[] = []

  for (const turn of session.turns) {
    if (!turn.prompt.text.trim()) {
      continue
    }

    if (out[out.length - 1] && promptSame(out[out.length - 1], turn.prompt)) {
      continue
    }

    out.push(promptCopy(turn.prompt))
  }

  return out.slice(-limit)
}

export function sessionVariant(session: RunSession, model: RunInput["model"]): string | undefined {
  if (!model) {
    return undefined
  }

  for (let idx = session.turns.length - 1; idx >= 0; idx -= 1) {
    const turn = session.turns[idx]
    if (turn.provider !== model.providerID || turn.model !== model.modelID) {
      continue
    }

    return turn.variant
  }

  return undefined
}
