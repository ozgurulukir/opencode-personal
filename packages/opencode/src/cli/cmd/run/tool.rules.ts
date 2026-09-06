import type * as Tool from "@/tool/tool"
import type { ApplyPatchTool } from "@/tool/apply_patch"
import type { ShellTool as BashTool } from "@/tool/shell"
import type { EditTool } from "@/tool/edit"
import type { GlobTool } from "@/tool/glob"
import type { GrepTool } from "@/tool/grep"
import type { InvalidTool } from "@/tool/invalid"
import type { LspTool } from "@/tool/lsp"
import type { PlanExitTool } from "@/tool/plan"
import type { QuestionTool } from "@/tool/question"
import type { ReadTool } from "@/tool/read"
import type { SkillTool } from "@/tool/skill"
import type { TaskTool } from "@/tool/task"
import type { TodoWriteTool } from "@/tool/todo"
import type { WebFetchTool } from "@/tool/webfetch"
import { webSearchProviderLabel, type WebSearchTool } from "@/tool/websearch"
import type { WriteTool } from "@/tool/write"
import type { ToolSnapshot } from "./types"
import type {
  ToolInline,
  ToolPermissionInfo,
  ToolPermissionProps,
  ToolProps,
  ToolRegistry,
  ToolRule,
} from "./tool.types"
import {
  count,
  dict,
  fail,
  info,
  list,
  num,
  span,
  text,
  toolError,
  toolPath,
} from "./tool.helpers"
import * as Locale from "@/util/locale"
import { formatSkillLabel } from "@/cli/cmd/tui/feature-plugins/system/skill-label.shared"
import stripAnsi from "strip-ansi"

type PatchFile = Tool.InferMetadata<typeof ApplyPatchTool>["files"][number]

export function runBash(p: ToolProps<typeof BashTool>): ToolInline {
  return {
    icon: "$",
    title: p.input.command || "",
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output).trim() : undefined,
  }
}

export function runGlob(p: ToolProps<typeof GlobTool>): ToolInline {
  const root = p.input.path ?? ""
  const title = `Glob "${p.input.pattern ?? ""}"`
  const suffix = root ? `in ${toolPath(root)}` : ""
  const matches = p.metadata.count
  const description = matches === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${count(matches, "match")}`
  return {
    icon: "✱",
    title,
    ...(description && { description }),
  }
}

export function runGrep(p: ToolProps<typeof GrepTool>): ToolInline {
  const root = p.input.path ?? ""
  const title = `Grep "${p.input.pattern ?? ""}"`
  const suffix = root ? `in ${toolPath(root)}` : ""
  const matches = p.metadata.matches
  const description = matches === undefined ? suffix : `${suffix}${suffix ? " · " : ""}${count(matches, "match")}`
  return {
    icon: "✱",
    title,
    ...(description && { description }),
  }
}

export function runList(p: ToolProps): ToolInline {
  const dir = text(dict(p.input).path)
  return {
    icon: "→",
    title: dir ? `List ${toolPath(dir)}` : "List",
  }
}

export function runRead(p: ToolProps<typeof ReadTool>): ToolInline {
  const file = toolPath(p.input.filePath)
  const description = info(p.frame.input, ["filePath"]) || undefined
  return {
    icon: "→",
    title: `Read ${file}`,
    ...(description && { description }),
  }
}

export function runWrite(p: ToolProps<typeof WriteTool>): ToolInline {
  return {
    icon: "←",
    title: `Write ${toolPath(p.input.filePath)}`,
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

export function runWebfetch(p: ToolProps<typeof WebFetchTool>): ToolInline {
  const url = p.input.url ?? ""
  return {
    icon: "%",
    title: url ? `WebFetch ${url}` : "WebFetch",
  }
}

export function runEdit(p: ToolProps<typeof EditTool>): ToolInline {
  return {
    icon: "←",
    title: `Edit ${toolPath(p.input.filePath)}`,
    mode: "block",
    body: p.metadata.diff,
  }
}

export function runWebSearch(p: ToolProps<typeof WebSearchTool>): ToolInline {
  const title = webSearchProviderLabel(p.metadata.provider)
  return {
    icon: "◈",
    title: p.input.query ? `${title} "${p.input.query}"` : title,
  }
}

export function runTask(p: ToolProps<typeof TaskTool>): ToolInline {
  const kind = Locale.titlecase(p.input.subagent_type || "unknown")
  const desc = p.input.description
  const icon = p.frame.status === "error" ? "✗" : p.frame.status === "running" ? "•" : "✓"
  return {
    icon,
    title: desc || `${kind} Task`,
    description: desc ? `${kind} Agent` : undefined,
  }
}

function todoMark(status: string): string {
  switch (status) {
    case "completed":
      return "[✓]"
    case "in_progress":
      return "[•]"
    case "cancelled":
      return "[✕]"
    default:
      return "[ ]"
  }
}

function priorityBadge(priority?: string): string {
  switch (priority) {
    case "high":
      return "[H]"
    case "medium":
      return "[M]"
    case "low":
      return "[L]"
    default:
      return ""
  }
}

export function runTodo(p: ToolProps<typeof TodoWriteTool>): ToolInline {
  return {
    icon: "#",
    title: "Todos",
    mode: "block",
    body: list<{ status?: string; content?: string; priority?: string }>(p.frame.input.todos)
      .flatMap((item) => {
        const body = typeof item?.content === "string" ? item.content : ""
        if (!body) {
          return []
        }

        return [`${priorityBadge(item.priority)}${todoMark(item.status ?? "")} ${body}`]
      })
      .join("\n"),
  }
}

export function runSkill(p: ToolProps<typeof SkillTool>): ToolInline {
  return { icon: "→", title: formatSkillLabel(p.input) }
}

export function runPatch(p: ToolProps<typeof ApplyPatchTool>): ToolInline {
  const files = p.metadata.files?.length ?? 0
  if (files === 0) {
    return {
      icon: "%",
      title: "Patch",
    }
  }

  return {
    icon: "%",
    title: `Patch ${files} file${files === 1 ? "" : "s"}`,
  }
}

export function runQuestion(p: ToolProps<typeof QuestionTool>): ToolInline {
  const total = list(p.frame.input.questions).length
  return {
    icon: "→",
    title: `Asked ${total} question${total === 1 ? "" : "s"}`,
  }
}

export function runInvalid(p: ToolProps<typeof InvalidTool>): ToolInline {
  return {
    icon: "✗",
    title: text(p.frame.state.title) || "Invalid Tool",
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

export function runBatch(p: ToolProps): ToolInline {
  const calls = list(dict(p.input).tool_calls).length
  return {
    icon: "#",
    title: text(p.frame.state.title) || (calls > 0 ? `Batch ${calls} tool${calls === 1 ? "" : "s"}` : "Batch"),
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

export function lspTitle(
  input: {
    operation?: string
    filePath?: string
    line?: number
    character?: number
  },
  opts: { home?: boolean } = {},
): string {
  const op = input.operation || "request"
  const file = input.filePath ? toolPath(input.filePath, opts) : ""
  const line = typeof input.line === "number" ? input.line : undefined
  const char = typeof input.character === "number" ? input.character : undefined
  const pos = line !== undefined && char !== undefined ? `:${line}:${char}` : ""
  if (!file) {
    return `LSP ${op}`
  }

  return `LSP ${op} ${file}${pos}`
}

export function runLsp(p: ToolProps<typeof LspTool>): ToolInline {
  return {
    icon: "→",
    title: text(p.frame.state.title) || lspTitle(p.input),
  }
}

export function runPlanExit(p: ToolProps<typeof PlanExitTool>): ToolInline {
  return {
    icon: "→",
    title: text(p.frame.state.title) || "Switching to build agent",
    mode: "block",
    body: p.frame.status === "completed" ? text(p.frame.state.output) : undefined,
  }
}

export function patchTitle(file: PatchFile): string {
  const rel = file.relativePath
  const from = file.filePath
  if (file.type === "add") {
    return `# Created ${rel || toolPath(from)}`
  }
  if (file.type === "delete") {
    return `# Deleted ${rel || toolPath(from)}`
  }
  if (file.type === "move") {
    return `# Moved ${toolPath(from)} -> ${rel || toolPath(file.movePath)}`
  }

  return `# Patched ${rel || toolPath(from)}`
}

export function snapWrite(p: ToolProps<typeof WriteTool>): ToolSnapshot | undefined {
  const file = p.input.filePath || ""
  const content = p.input.content || ""
  if (!file && !content) {
    return undefined
  }

  return {
    kind: "code",
    title: `# Wrote ${toolPath(file)}`,
    content,
    file,
  }
}

export function snapEdit(p: ToolProps<typeof EditTool>): ToolSnapshot | undefined {
  const file = p.input.filePath || ""
  const diff = p.metadata.diff || ""
  if (!file || !diff.trim()) {
    return undefined
  }

  return {
    kind: "diff",
    items: [
      {
        title: `# Edited ${toolPath(file)}`,
        diff,
        file,
      },
    ],
  }
}

export function snapPatch(p: ToolProps<typeof ApplyPatchTool>): ToolSnapshot | undefined {
  const files = list<PatchFile>(p.frame.meta.files)
  if (files.length === 0) {
    return undefined
  }

  const items = files.flatMap((file) => {
    if (!file || typeof file !== "object") {
      return []
    }

    const diff = typeof file.patch === "string" ? file.patch : ""
    if (!diff.trim()) {
      return []
    }

    const name = file.movePath || file.filePath || file.relativePath
    return [
      {
        title: patchTitle(file),
        diff,
        file: name,
        deletions: typeof file.deletions === "number" ? file.deletions : 0,
      },
    ]
  })

  if (items.length === 0) {
    return undefined
  }

  return {
    kind: "diff",
    items,
  }
}

export function snapTask(p: ToolProps<typeof TaskTool>): ToolSnapshot {
  const kind = Locale.titlecase(p.input.subagent_type || "general")
  const desc = p.input.description
  const title = text(p.frame.state.title)
  const rows = [desc || title].filter((item): item is string => Boolean(item))

  return {
    kind: "task",
    title: `# ${kind} Task`,
    rows,
    tail: "",
  }
}

export function snapTodo(p: ToolProps<typeof TodoWriteTool>): ToolSnapshot {
  const items = list<{ status?: string; content?: string; priority?: string }>(p.frame.input.todos).flatMap((item) => {
    const content = typeof item?.content === "string" ? item.content : ""
    if (!content) {
      return []
    }

    return [
      {
        status: typeof item.status === "string" ? item.status : "",
        content,
        priority: typeof item.priority === "string" ? item.priority : undefined,
      },
    ]
  })

  return {
    kind: "todo",
    items,
    tail: "",
  }
}

export function snapQuestion(p: ToolProps<typeof QuestionTool>): ToolSnapshot {
  const answers = list<unknown[]>(p.frame.meta.answers)
  const items = list<{ question?: string }>(p.frame.input.questions).map((item, i) => {
    const answer = list<string>(answers[i]).filter((entry) => typeof entry === "string")
    return {
      question: item.question || `Question ${i + 1}`,
      answer: answer.length > 0 ? answer.join(", ") : "(no answer)",
    }
  })

  return {
    kind: "question",
    items,
    tail: "",
  }
}

export function scrollBashStart(p: ToolProps<typeof BashTool>): string {
  const cmd = p.input.command ?? ""
  const desc = p.input.description || "Shell"
  const wd = p.input.workdir ?? ""
  const dir = wd && wd !== "." ? toolPath(wd) : ""
  const title = dir && !desc.includes(dir) ? `${desc} in ${dir}` : desc

  if (!cmd) {
    return `# ${title}`
  }

  return `# ${title}\n$ ${cmd}`
}

export function scrollBashProgress(p: ToolProps<typeof BashTool>): string {
  const out = stripAnsi(p.frame.raw)
  const cmd = (p.input.command ?? "").trim()
  const fmt = (text: string) => {
    const body = text.replace(/^\n+/, "").replace(/\n+$/, "")
    return body ? `\n${body}` : ""
  }

  if (!cmd) {
    return out.replace(/\n+$/, "")
  }

  const wdRaw = (p.input.workdir ?? "").trim()
  const wd = wdRaw ? toolPath(wdRaw) : ""
  const lines = out.split("\n")
  const first = (lines[0] || "").trim()
  const second = (lines[1] || "").trim()

  if (wd && (first === wd || first === wdRaw) && second === cmd) {
    return fmt(lines.slice(2).join("\n"))
  }

  if (first === cmd || first === `$ ${cmd}`) {
    return fmt(lines.slice(1).join("\n"))
  }

  if (wd && (first === `${wd} ${cmd}` || first === `${wdRaw} ${cmd}`)) {
    return fmt(lines.slice(1).join("\n"))
  }

  return fmt(out)
}

export function scrollBashFinal(p: ToolProps<typeof BashTool>): string {
  const code = p.metadata.exit ?? num(p.frame.meta.exitCode) ?? num(p.frame.meta.exit_code)
  const time = span(p.frame.state)
  if (code === undefined) {
    if (!time) {
      return "bash completed"
    }

    return `bash completed · ${time}`
  }

  return `bash completed (exit ${code})${time ? ` · ${time}` : ""}`
}

export function scrollReadStart(p: ToolProps<typeof ReadTool>): string {
  const file = toolPath(p.input.filePath)
  const extra = info(p.frame.input, ["filePath"])
  const tail = extra ? ` ${extra}` : ""
  return `→ Read ${file}${tail}`.trim()
}

export function scrollWriteStart(_: ToolProps<typeof WriteTool>): string {
  return ""
}

export function scrollEditStart(_: ToolProps<typeof EditTool>): string {
  return ""
}

export function scrollPatchStart(_: ToolProps<typeof ApplyPatchTool>): string {
  return ""
}

export function patchLine(file: PatchFile): string {
  const type = file.type
  const rel = file.relativePath
  const from = file.filePath

  if (type === "add") {
    return `+ Created ${rel || toolPath(from)}`
  }

  if (type === "delete") {
    return `- Deleted ${rel || toolPath(from)}`
  }

  if (type === "move") {
    return `→ Moved ${toolPath(from)} → ${rel || toolPath(file.movePath)}`
  }

  return `~ Patched ${rel || toolPath(from)}`
}

export function scrollPatchFinal(p: ToolProps<typeof ApplyPatchTool>): string {
  if (p.frame.status === "error") {
    return fail(p.frame)
  }

  const files = list<PatchFile>(p.frame.meta.files)
  if (files.length === 0) {
    const time = span(p.frame.state)
    if (!time) {
      return "patch"
    }

    return `patch · ${time}`
  }

  const show_updates = !files.some((file) => file?.type && file.type !== "update")
  const shown = files.filter((file) => show_updates || file.type !== "update")
  const rows = shown.slice(0, 6).map(patchLine)
  if (shown.length > 6) {
    rows.push(`... and ${shown.length - 6} more`)
  }

  if (rows.length > 0) {
    return rows.join("\n")
  }

  return patchLine(files[0]!)
}

export function scrollTaskStart(_: ToolProps<typeof TaskTool>): string {
  return ""
}

export function taskResult(output: string): string | undefined {
  if (!output.trim()) {
    return undefined
  }

  const match = output.match(/<task_result>\s*([\s\S]*?)\s*<\/task_result>/)
  if (match) {
    return match[1].trim() || undefined
  }

  const next = output
    .split("\n")
    .filter((line) => !line.startsWith("task_id:"))
    .join("\n")
    .trim()
  return next || undefined
}

export function scrollTaskFinal(p: ToolProps<typeof TaskTool>): string {
  if (p.frame.status === "error") {
    return fail(p.frame)
  }

  const kind = Locale.titlecase(p.input.subagent_type || "general")
  const row = p.input.description || text(p.frame.state.title)
  if (!row) {
    return `# ${kind} Task`
  }

  return `# ${kind} Task\n${row}`
}

export function scrollTodoStart(_: ToolProps<typeof TodoWriteTool>): string {
  return ""
}

export function scrollTodoFinal(p: ToolProps<typeof TodoWriteTool>): string {
  const items = list<{ status?: string }>(p.input.todos)
  const time = span(p.frame.state)
  if (items.length === 0) {
    if (!time) {
      return "0 todos"
    }

    return `0 todos · ${time}`
  }

  // ⚡ Bolt Optimization: Replace multiple .filter().length with a single loop to reduce GC pressure
  let doneN = 0,
    runN = 0,
    cancelledN = 0
  for (const item of items) {
    if (item.status === "completed") doneN++
    else if (item.status === "in_progress") runN++
    else if (item.status === "cancelled") cancelledN++
  }
  const left = items.length - doneN - runN - cancelledN
  const tail = [`${items.length} total`]
  if (doneN > 0) {
    tail.push(`${doneN} done`)
  }
  if (runN > 0) {
    tail.push(`${runN} active`)
  }
  if (cancelledN > 0) {
    tail.push(`${cancelledN} cancelled`)
  }
  if (left > 0) {
    tail.push(`${left} pending`)
  }

  if (time) {
    tail.push(time)
  }

  return tail.join(" · ")
}

export function scrollQuestionStart(_: ToolProps<typeof QuestionTool>): string {
  return ""
}

export function scrollQuestionFinal(p: ToolProps<typeof QuestionTool>): string {
  const q = p.input.questions ?? []
  const a = p.metadata.answers ?? []
  const time = span(p.frame.state)
  if (q.length === 0) {
    if (!time) {
      return "0 questions"
    }

    return `0 questions · ${time}`
  }

  const rows: string[] = []
  for (const [i, item] of q.slice(0, 4).entries()) {
    const prompt = item.question
    const reply = a[i] ?? []
    rows.push(`? ${prompt || `Question ${i + 1}`}`)
    rows.push(`  ${reply.length > 0 ? reply.join(", ") : "(no answer)"}`)
  }

  if (q.length > 4) {
    rows.push(`... and ${q.length - 4} more`)
  }

  return rows.join("\n")
}

export function scrollLspStart(p: ToolProps<typeof LspTool>): string {
  return `→ ${lspTitle(p.input)}`
}

export function scrollSkillStart(p: ToolProps<typeof SkillTool>): string {
  return `→ ${formatSkillLabel(p.input)}`
}

export function scrollGlobStart(p: ToolProps<typeof GlobTool>): string {
  const pattern = p.input.pattern ?? ""
  const head = pattern ? `✱ Glob "${pattern}"` : "✱ Glob"
  const dir = p.input.path ?? ""
  if (!dir) {
    return head
  }

  return `${head} in ${toolPath(dir)}`
}

export function scrollGlobFinal(p: ToolProps<typeof GlobTool>): string {
  return toolError(p.frame) || fail(p.frame)
}

export function scrollGrepStart(p: ToolProps<typeof GrepTool>): string {
  const pattern = p.input.pattern ?? ""
  const head = pattern ? `✱ Grep "${pattern}"` : "✱ Grep"
  const dir = p.input.path ?? ""
  if (!dir) {
    return head
  }

  return `${head} in ${toolPath(dir)}`
}

export function scrollListStart(p: ToolProps): string {
  const dir = text(dict(p.input).path)
  if (!dir) {
    return "→ List"
  }

  return `→ List ${toolPath(dir)}`
}

export function scrollWebfetchStart(p: ToolProps<typeof WebFetchTool>): string {
  const url = p.input.url ?? ""
  if (!url) {
    return "% WebFetch"
  }

  return `% WebFetch ${url}`
}

export function scrollWebSearchStart(p: ToolProps<typeof WebSearchTool>): string {
  const title = webSearchProviderLabel(p.metadata.provider)
  const query = p.input.query ?? ""
  if (!query) {
    return `◈ ${title}`
  }

  return `◈ ${title} "${query}"`
}

export function permEdit(p: ToolPermissionProps<typeof EditTool>): ToolPermissionInfo {
  const input = p.input as { filePath?: string; filepath?: string; diff?: string }
  const file = input.filePath || input.filepath || p.patterns[0] || ""
  return {
    icon: "→",
    title: `Edit ${toolPath(file, { home: true })}`,
    lines: [],
    diff: p.metadata.diff ?? input.diff,
    file,
  }
}

export function permRead(p: ToolPermissionProps<typeof ReadTool>): ToolPermissionInfo {
  const file = p.input.filePath || p.patterns[0] || ""
  return {
    icon: "→",
    title: `Read ${toolPath(file, { home: true })}`,
    lines: file ? [`Path: ${toolPath(file, { home: true })}`] : [],
  }
}

export function permGlob(p: ToolPermissionProps<typeof GlobTool>): ToolPermissionInfo {
  const pattern = p.input.pattern || p.patterns[0] || ""
  return {
    icon: "✱",
    title: `Glob "${pattern}"`,
    lines: pattern ? [`Pattern: ${pattern}`] : [],
  }
}

export function permGrep(p: ToolPermissionProps<typeof GrepTool>): ToolPermissionInfo {
  const pattern = p.input.pattern || p.patterns[0] || ""
  return {
    icon: "✱",
    title: `Grep "${pattern}"`,
    lines: pattern ? [`Pattern: ${pattern}`] : [],
  }
}

export function permList(p: ToolPermissionProps): ToolPermissionInfo {
  const dir = text(dict(p.input).path) || p.patterns[0] || ""
  return {
    icon: "→",
    title: `List ${toolPath(dir, { home: true })}`,
    lines: dir ? [`Path: ${toolPath(dir, { home: true })}`] : [],
  }
}

export function permBash(p: ToolPermissionProps<typeof BashTool>): ToolPermissionInfo {
  const title = p.input.description || "Shell command"
  const cmd = p.input.command || ""
  return {
    icon: "#",
    title,
    lines: cmd ? [`$ ${cmd}`] : p.patterns.map((item) => `- ${item}`),
  }
}

export function permTask(p: ToolPermissionProps<typeof TaskTool>): ToolPermissionInfo {
  const type = p.input.subagent_type || "general"
  const desc = p.input.description
  return {
    icon: "#",
    title: `${Locale.titlecase(type)} Task`,
    lines: desc ? [`◉ ${desc}`] : [],
  }
}

export function permWebfetch(p: ToolPermissionProps<typeof WebFetchTool>): ToolPermissionInfo {
  const url = p.input.url || ""
  return {
    icon: "%",
    title: `WebFetch ${url}`,
    lines: url ? [`URL: ${url}`] : [],
  }
}

export function permWebSearch(p: ToolPermissionProps<typeof WebSearchTool>): ToolPermissionInfo {
  const query = p.input.query || ""
  const title = webSearchProviderLabel(p.metadata.provider)
  return {
    icon: "◈",
    title: query ? `${title} "${query}"` : title,
    lines: query ? [`Query: ${query}`] : [],
  }
}

export function permLsp(p: ToolPermissionProps<typeof LspTool>): ToolPermissionInfo {
  const file = p.input.filePath || ""
  const line = typeof p.input.line === "number" ? p.input.line : undefined
  const char = typeof p.input.character === "number" ? p.input.character : undefined
  const pos = line !== undefined && char !== undefined ? `${line}:${char}` : undefined
  return {
    icon: "→",
    title: lspTitle(p.input, { home: true }),
    lines: [
      ...(p.input.operation ? [`Operation: ${p.input.operation}`] : []),
      ...(file ? [`Path: ${toolPath(file, { home: true })}`] : []),
      ...(pos ? [`Position: ${pos}`] : []),
    ],
  }
}

const TOOL_RULES = {
  invalid: {
    view: {
      output: true,
      final: false,
    },
    run: runInvalid,
    scroll: {
      start: () => "",
    },
  },
  bash: {
    view: {
      output: true,
      final: false,
    },
    run: runBash,
    scroll: {
      start: scrollBashStart,
      progress: scrollBashProgress,
      final: scrollBashFinal,
    },
    permission: permBash,
  },
  write: {
    view: {
      output: false,
      final: true,
      snap: "code",
    },
    run: runWrite,
    snap: snapWrite,
    scroll: {
      start: scrollWriteStart,
    },
  },
  edit: {
    view: {
      output: false,
      final: true,
      snap: "diff",
    },
    run: runEdit,
    snap: snapEdit,
    scroll: {
      start: scrollEditStart,
    },
    permission: permEdit,
  },
  apply_patch: {
    view: {
      output: false,
      final: true,
      snap: "diff",
    },
    run: runPatch,
    snap: snapPatch,
    scroll: {
      start: scrollPatchStart,
      final: scrollPatchFinal,
    },
  },
  batch: {
    view: {
      output: true,
      final: false,
    },
    run: runBatch,
    scroll: {
      start: () => "",
    },
  },
  task: {
    view: {
      output: false,
      final: true,
      snap: "structured",
    },
    run: runTask,
    snap: snapTask,
    scroll: {
      start: scrollTaskStart,
      final: scrollTaskFinal,
    },
    permission: permTask,
  },
  todowrite: {
    view: {
      output: false,
      final: true,
      snap: "structured",
    },
    run: runTodo,
    snap: snapTodo,
    scroll: {
      start: scrollTodoStart,
      final: scrollTodoFinal,
    },
  },
  question: {
    view: {
      output: false,
      final: true,
      snap: "structured",
    },
    run: runQuestion,
    snap: snapQuestion,
    scroll: {
      start: scrollQuestionStart,
      final: scrollQuestionFinal,
    },
  },
  read: {
    view: {
      output: false,
      final: false,
    },
    run: runRead,
    scroll: {
      start: scrollReadStart,
    },
    permission: permRead,
  },
  glob: {
    view: {
      output: false,
      final: false,
    },
    run: runGlob,
    scroll: {
      start: scrollGlobStart,
      final: scrollGlobFinal,
    },
    permission: permGlob,
  },
  grep: {
    view: {
      output: false,
      final: false,
    },
    run: runGrep,
    scroll: {
      start: scrollGrepStart,
    },
    permission: permGrep,
  },
  list: {
    view: {
      output: false,
      final: false,
    },
    run: runList,
    scroll: {
      start: scrollListStart,
    },
    permission: permList,
  },
  lsp: {
    view: {
      output: false,
      final: false,
    },
    run: runLsp,
    scroll: {
      start: scrollLspStart,
    },
    permission: permLsp,
  },
  webfetch: {
    view: {
      output: false,
      final: false,
    },
    run: runWebfetch,
    scroll: {
      start: scrollWebfetchStart,
    },
    permission: permWebfetch,
  },
  websearch: {
    view: {
      output: false,
      final: false,
    },
    run: runWebSearch,
    scroll: {
      start: scrollWebSearchStart,
    },
    permission: permWebSearch,
  },
  skill: {
    view: {
      output: false,
      final: false,
    },
    run: runSkill,
    scroll: {
      start: scrollSkillStart,
    },
  },
  plan_exit: {
    view: {
      output: true,
      final: false,
    },
    run: runPlanExit,
    scroll: {
      start: () => "",
    },
  },
} as const satisfies ToolRegistry

function key(name: string): name is keyof typeof TOOL_RULES {
  return Object.prototype.hasOwnProperty.call(TOOL_RULES, name)
}

export function rule(name?: string): ToolRule | undefined {
  if (!name || !key(name)) {
    return undefined
  }

  return TOOL_RULES[name]
}
