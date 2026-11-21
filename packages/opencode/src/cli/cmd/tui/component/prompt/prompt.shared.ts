// Pure state machine for the TUI prompt composer.
//
// Every function here takes state in and returns new state out — no IO, no
// SolidJS signals, no mutation of caller-owned values. The `Prompt()` render
// body in `index.tsx` wires these into reactive effects; the behavior they
// encode (history boundaries, paste normalization, slash-command parsing,
// placeholder text) is locked by characterization tests in
// `test/cli/cmd/tui/prompt-shared.test.ts`.
import { fileURLToPath } from "url"
import type { EditorSelection } from "@tui/context/editor"
import { getEditorRangeLabel, hasEditorRangeSelection } from "./editor-context"
import type { PromptInfo } from "./history"

export type PromptMode = "normal" | "shell"

export type PromptExtmark = { id: number; start: number; end: number }

export function randomIndex(count: number) {
  if (count <= 0) return 0
  return Math.floor(Math.random() * count)
}

/** CRLF/CR → LF. Windows ConPTY bracketed paste commonly sends CR-only newlines. */
export function normalizePastedText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
}

/**
 * Resolve a pasted string to a filesystem path: strip surrounding quotes,
 * decode `file://` URLs, and undo POSIX backslash escaping. Windows treats the
 * raw string as a path verbatim.
 */
export function resolvePasteFilepath(raw: string, platform: NodeJS.Platform = process.platform) {
  const trimmed = raw.replace(/^['"]+|['"]+$/g, "")
  if (trimmed.startsWith("file://")) {
    try {
      return fileURLToPath(trimmed)
    } catch {}
  }
  if (platform === "win32") return trimmed
  return trimmed.replace(/\\(.)/g, "$1")
}

export function isPasteUrl(filepath: string) {
  return /^(https?):\/\//.test(filepath)
}

/**
 * Expand virtual paste placeholders inline, right-to-left so earlier offsets
 * stay valid. Text parts only — file/agent parts survive as structured parts.
 */
export function expandPastedText(input: {
  text: string
  parts: PromptInfo["parts"]
  extmarks: PromptExtmark[]
  extmarkToPartIndex: Map<number, number>
}) {
  const sorted = input.extmarks.toSorted((a, b) => b.start - a.start)
  let text = input.text
  for (const extmark of sorted) {
    const partIndex = input.extmarkToPartIndex.get(extmark.id)
    if (partIndex === undefined) continue
    const part = input.parts[partIndex]
    if (part?.type !== "text" || !part.text) continue
    text = text.slice(0, extmark.start) + part.text + text.slice(extmark.end)
  }
  return text
}

/**
 * Parse the first line of a prompt as a slash command, preserving multi-line
 * content in the argument string. Returns `undefined` when the input is not a
 * slash command.
 */
export function parseSlashCommand(input: string): { name: string; args: string } | undefined {
  if (!input.startsWith("/")) return undefined
  const firstLineEnd = input.indexOf("\n")
  const firstLine = firstLineEnd === -1 ? input : input.slice(0, firstLineEnd)
  const [command, ...firstLineArgs] = firstLine.split(" ")
  if (!command) return undefined
  const rest = firstLineEnd === -1 ? "" : input.slice(firstLineEnd + 1)
  return {
    name: command.slice(1),
    args: firstLineArgs.join(" ") + (rest ? "\n" + rest : ""),
  }
}

/** Compose the `#12-15 +2` selection label shown next to the editor file name. */
export function editorSelectionLabel(ranges: EditorSelection["ranges"] | undefined) {
  if (!ranges) return undefined
  const first = ranges.find(hasEditorRangeSelection) ?? ranges[0]
  if (!first) return undefined
  return [getEditorRangeLabel(first), ranges.length > 1 ? `+${ranges.length - 1}` : undefined].filter(Boolean).join(" ")
}

/** Derive the textarea placeholder (ghost suggestion, shell example, or prompt hint). */
export function promptPlaceholder(input: {
  showPlaceholder: boolean
  mode: PromptMode
  ghost: string
  shell: string[]
  list: string[]
  index: number
}): string | undefined {
  if (!input.showPlaceholder) return undefined
  if (input.mode === "normal" && input.ghost) return `${input.ghost}  (Tab to accept)`
  if (input.mode === "shell") {
    if (!input.shell.length) return undefined
    const example = input.shell[input.index % input.shell.length]
    return `Run a command... "${example}"`
  }
  if (!input.list.length) return undefined
  return `Ask anything... "${input.list[input.index % input.list.length]}"`
}

export function shouldShowVariant(variants: string[], current: string | undefined) {
  return variants.length > 0 && !!current
}

/** Drafts are retained in history only when substantial enough to be worth it. */
export function isDraftWorthRetaining(input: string, partCount: number, minChars: number) {
  return input.trim().length >= minChars || partCount > 0
}

/** History "previous" only fires when the cursor is on the first visual row. */
export function canMoveHistoryPrevious(cursorOffset: number, visualRow: number) {
  return cursorOffset === 0 || visualRow === 0
}

/** History "next" only fires when the cursor is on the last visual row. */
export function canMoveHistoryNext(cursorOffset: number, textLength: number, visualRow: number, height: number) {
  return cursorOffset === textLength || visualRow === height - 1
}
