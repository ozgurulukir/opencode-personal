import type { ToolPart } from "@opencode-ai/sdk/v2"
import type { RunEntryBody, StreamCommit, ToolSnapshot } from "./types"
import type {
  ToolDict,
  ToolFrame,
  ToolInline,
  ToolPermissionInfo,
  ToolPermissionProps,
  ToolView,
} from "./tool.types"
import { dict, fallbackFinal, fallbackInline, fallbackStart, props, text } from "./tool.helpers"
import { rule, taskResult } from "./tool.rules"
import path from "path"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import * as Log from "@opencode-ai/core/util/log"

function toolFrame(commit: StreamCommit, raw: string): ToolFrame {
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

function frame(part: ToolPart): ToolFrame {
  const state = dict(part.state)
  return {
    raw: "",
    name: part.tool,
    input: dict(state.input),
    meta: dict(state.metadata),
    state,
    status: text(state.status),
    error: text(state.error),
  }
}

export function toolView(name?: string): ToolView {
  return (
    rule(name)?.view ?? {
      output: true,
      final: true,
    }
  )
}

export function toolStructuredFinal(commit: StreamCommit): boolean {
  const state = commit.toolState ?? commit.part?.state.status
  return (
    commit.kind === "tool" &&
    commit.phase === "final" &&
    state === "completed" &&
    Boolean(toolView(commit.tool ?? commit.part?.tool).snap)
  )
}

export function toolInlineInfo(part: ToolPart): ToolInline {
  const ctx = frame(part)
  const draw = rule(ctx.name)?.run
  try {
    if (draw) {
      return draw(props(ctx))
    }
  } catch (err) {
    Log.Default.error("[tool] toolInlineInfo failed for", { name: ctx.name, err })
    return fallbackInline(ctx)
  }

  return fallbackInline(ctx)
}

export function toolScroll(phase: "start" | "progress" | "final", ctx: ToolFrame): string {
  const draw = rule(ctx.name)?.scroll?.[phase]
  try {
    if (draw) {
      return draw(props(ctx))
    }
  } catch (err) {
    Log.Default.error("[tool] toolScroll failed for", { name: ctx.name, phase, err })
    if (phase === "start") {
      return fallbackStart(ctx)
    }
    if (phase === "progress") {
      return ctx.raw
    }
    return fallbackFinal(ctx)
  }

  if (phase === "start") {
    return fallbackStart(ctx)
  }

  if (phase === "progress") {
    return ctx.raw
  }

  return fallbackFinal(ctx)
}

export function toolPermissionInfo(
  name: string,
  input: ToolDict,
  meta: ToolDict,
  patterns: string[],
): ToolPermissionInfo | undefined {
  const draw = rule(name)?.permission
  if (!draw) {
    return undefined
  }

  try {
    return draw({ input, metadata: meta, patterns } as ToolPermissionProps)
  } catch (err) {
    Log.Default.error("[tool] toolPermissionInfo failed for", { name, err })
    return undefined
  }
}

export function toolSnapshot(commit: StreamCommit, raw: string): ToolSnapshot | undefined {
  const ctx = toolFrame(commit, raw)
  const draw = rule(ctx.name)?.snap
  if (!draw) {
    return undefined
  }

  try {
    return draw(props(ctx))
  } catch (err) {
    Log.Default.error("[tool] toolSnapshot failed for", { name: ctx.name, err })
    return undefined
  }
}

export function toolEntryBody(commit: StreamCommit, raw: string): RunEntryBody | undefined {
  const ctx = toolFrame(commit, raw)
  const view = toolView(ctx.name)

  if (ctx.name === "task") {
    if (commit.phase === "start") {
      return undefined
    }

    if (commit.phase === "final" && ctx.status === "completed") {
      const result = taskResult(text(ctx.state.output))
      if (result) {
        return { type: "markdown", content: result }
      }
    }
  }

  if (commit.phase === "progress" && !view.output) {
    return undefined
  }

  if (commit.phase === "final") {
    if (ctx.status === "error") {
      return { type: "text", content: toolScroll("final", ctx) }
    }

    if (!view.final) {
      return undefined
    }

    if (ctx.status && ctx.status !== "completed") {
      return { type: "text", content: ctx.raw.trim() }
    }

    if (toolStructuredFinal(commit)) {
      const snap = toolSnapshot(commit, raw)
      if (snap) {
        return { type: "structured", snapshot: snap }
      }
      return { type: "text", content: toolScroll("final", ctx) }
    }
  }

  // Tool scroll helpers (e.g. scrollTodoStart, scrollQuestionStart,
  // scrollWriteStart) return "" to suppress the start-phase placeholder. A
  // placeholder row was rendered here anyway, leaking an empty/spurious
  // commit during streaming that displaced the final content -- causing the
  // visible truncation users saw. Skip the entry entirely when there is no
  // content to render.
  const content = toolScroll(commit.phase, ctx)
  if (!content) {
    return undefined
  }

  return { type: "text", content }
}

export function toolFiletype(input?: string): string | undefined {
  if (!input) {
    return undefined
  }

  const ext = path.extname(input)
  const lang = LANGUAGE_EXTENSIONS[ext]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(lang)) {
    return "typescript"
  }

  return lang
}
