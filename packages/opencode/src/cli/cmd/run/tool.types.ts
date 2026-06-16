import type { ToolPart } from "@opencode-ai/sdk/v2"
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
import type { WebSearchTool } from "@/tool/websearch"
import type { WriteTool } from "@/tool/write"
import type { RunDiffStyle, RunEntryBody, StreamCommit, ToolSnapshot } from "./types"

export type ToolView = {
  output: boolean
  final: boolean
  snap?: "code" | "diff" | "structured"
}

export type ToolPhase = "start" | "progress" | "final"

export type ToolDict = Record<string, unknown>

export type ToolFrame = {
  raw: string
  name: string
  input: ToolDict
  meta: ToolDict
  state: ToolDict
  status: string
  error: string
}

export type ToolInline = {
  icon: string
  title: string
  description?: string
  mode?: "inline" | "block"
  body?: string
}

export type ToolPermissionInfo = {
  icon: string
  title: string
  lines: string[]
  diff?: string
  file?: string
}

export type ToolProps<T = Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  frame: ToolFrame
}

export type ToolPermissionProps<T = Tool.Info> = {
  input: Partial<Tool.InferParameters<T>>
  metadata: Partial<Tool.InferMetadata<T>>
  patterns: string[]
}

type ToolPermissionCtx = {
  input: ToolDict
  meta: ToolDict
  patterns: string[]
}

type ToolDefs = {
  invalid: typeof InvalidTool
  bash: typeof BashTool
  write: typeof WriteTool
  edit: typeof EditTool
  apply_patch: typeof ApplyPatchTool
  batch: Tool.Info
  task: typeof TaskTool
  todowrite: typeof TodoWriteTool
  question: typeof QuestionTool
  read: typeof ReadTool
  glob: typeof GlobTool
  grep: typeof GrepTool
  list: Tool.Info
  lsp: typeof LspTool
  webfetch: typeof WebFetchTool
  websearch: typeof WebSearchTool
  skill: typeof SkillTool
  plan_exit: typeof PlanExitTool
}

export type ToolName = keyof ToolDefs

export type ToolRule<T = Tool.Info> = {
  view: ToolView
  run: (props: ToolProps<T>) => ToolInline
  scroll?: Partial<Record<ToolPhase, (props: ToolProps<T>) => string>>
  permission?: (props: ToolPermissionProps<T>) => ToolPermissionInfo
  snap?: (props: ToolProps<T>) => ToolSnapshot | undefined
}

export type ToolRegistry = {
  [K in ToolName]: ToolRule<ToolDefs[K]>
}

export type AnyToolRule = ToolRule
