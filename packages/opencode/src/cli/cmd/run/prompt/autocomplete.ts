// Pure autocomplete logic for the prompt textarea.
//
// Handles mention (@) and slash (/) detection, line range extraction,
// and query parsing. All functions are pure — no TUI or SolidJS dependencies.

export type LineRange = {
  base: string
  line?: {
    start: number
    end?: number
  }
}

export function clamp(rows: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, rows))
}

export function removeLineRange(input: string): string {
  const hash = input.lastIndexOf("#")
  return hash === -1 ? input : input.slice(0, hash)
}

export function extractLineRange(input: string): LineRange {
  const hash = input.lastIndexOf("#")
  if (hash === -1) {
    return { base: input }
  }

  const base = input.slice(0, hash)
  const line = input.slice(hash + 1)
  const match = line.match(/^(\d+)(?:-(\d*))?$/)
  if (!match) {
    return { base }
  }

  const start = Number(match[1])
  const end = match[2] && start < Number(match[2]) ? Number(match[2]) : undefined
  return { base, line: { start, end } }
}

export function slashHead(text: string): { name: string; arguments: string; end: number } | undefined {
  if (!text.startsWith("/")) {
    return
  }

  for (let i = 1; i < text.length; i++) {
    switch (text[i]) {
      case " ":
      case "\t":
      case "\n":
        return { name: text.slice(1, i), arguments: text.slice(i + 1), end: i }
    }
  }

  return { name: text.slice(1), arguments: "", end: text.length }
}

export function slashQuery(text: string, cursor: number): string | undefined {
  const head = slashHead(text.slice(0, cursor))
  if (!head || head.end !== cursor) {
    return
  }

  return head.name
}
