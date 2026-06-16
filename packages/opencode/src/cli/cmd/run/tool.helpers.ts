import type { ToolDict, ToolFrame } from "./tool.types"
import type { RunEntryBody, StreamCommit } from "./types"
import * as Tool from "@/tool/tool"
import * as Locale from "@/util/locale"
import { toolPath } from "./tool.path"
import stripAnsi from "strip-ansi"

export { toolPath } from "./tool.path"

export function props<T = Tool.Info>(frame: ToolFrame) {
  return {
    input: Object.assign(Object.create(null), frame.input),
    metadata: Object.assign(Object.create(null), frame.meta),
    frame,
  }
}

export function permission<T = Tool.Tool.Info>(ctx: { input: ToolDict; meta: ToolDict; patterns: string[] }) {
  return {
    input: Object.assign(Object.create(null), ctx.input),
    metadata: Object.assign(Object.create(null), ctx.meta),
    patterns: ctx.patterns,
  }
}

export function text(v: unknown): string {
  return typeof v === "string" ? v : ""
}

export function num(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return undefined
  }

  return v
}

export function list<T>(v: unknown): T[] {
  if (!Array.isArray(v)) {
    return []
  }

  return v
}

export function info(data: ToolDict, skip: string[] = []): string {
  const items = Object.entries(data).filter(([key, val]) => {
    if (skip.includes(key)) {
      return false
    }

    return typeof val === "string" || typeof val === "number" || typeof val === "boolean"
  })

  if (items.length === 0) {
    return ""
  }

  return `[${items.map(([key, val]) => `${key}=${String(val)}`).join(", ")}]`
}

export function dict(v: unknown): ToolDict {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    return {}
  }

  return { ...v }
}

export function span(state: ToolDict): string {
  const time = dict(state.time)
  const start = num(time.start)
  const end = num(time.end)
  if (start === undefined || end === undefined || end <= start) {
    return ""
  }

  return Locale.duration(end - start)
}

export function fail(ctx: ToolFrame): string {
  const error = toolError(ctx)
  if (error) {
    return `✖ ${ctx.name} failed: ${error}`
  }

  return `✖ ${ctx.name} failed`
}

export function toolError(ctx: ToolFrame): string {
  if (ctx.error) {
    return ctx.error
  }

  const state = text(ctx.state.error).trim()
  if (state) {
    return state
  }

  return ctx.raw.trim()
}

export function fallbackStart(ctx: ToolFrame): string {
  const extra = info(ctx.input)
  if (!extra) {
    return `⚙ ${ctx.name}`
  }

  return `⚙ ${ctx.name} ${extra}`
}

export function fallbackFinal(ctx: ToolFrame): string {
  if (ctx.status === "error") {
    return fail(ctx)
  }

  if (ctx.status && ctx.status !== "completed") {
    return ctx.raw.trim()
  }

  const time = span(ctx.state)
  if (!time) {
    return `${ctx.name} completed`
  }

  return `${ctx.name} completed · ${time}`
}

export function fallbackInline(ctx: ToolFrame) {
  const title = text(ctx.state.title) || (Object.keys(ctx.input).length > 0 ? JSON.stringify(ctx.input) : "Unknown")

  return {
    icon: "⚙",
    title: `${ctx.name} ${title}`,
  }
}

export function count(n: number, label: string): string {
  return `${n} ${label}${n === 1 ? "" : "s"}`
}

export function toolFrame(commit: StreamCommit, raw: string): ToolFrame {
  const state = dict(commit.part?.state)
  return {
    raw,
    name: commit.tool || commit.part?.tool || "tool",
    input: dict(state.input),
    meta: dict(state.metadata),
    state,
    status: commit.toolState ?? text(state.status),
    error: (commit.toolError ?? "").trim(),
  }
}

export function textBody(content: string): RunEntryBody | undefined {
  if (!content) {
    return undefined
  }

  return {
    type: "text",
    content,
  }
}

export function markdownBody(content: string): RunEntryBody | undefined {
  if (!content) {
    return undefined
  }

  return {
    type: "markdown",
    content,
  }
}
