// Shared file-reading primitives for the read tool (and the shell tool's former
// copies). Extracted verbatim from `read.ts` so line-window semantics — line
// truncation, byte budget, offset/limit — live in one place and are testable
// in isolation. Streaming is intentionally preserved: files can be large, and
// the read tool only keeps a small window while still counting total lines.

import { createReadStream } from "fs"
import { createInterface } from "readline"

export const MAX_LINE_LENGTH = 2000
export const MAX_BYTES = 50 * 1024
export const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
export const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`

export function truncateLine(text: string): string {
  return text.length > MAX_LINE_LENGTH ? text.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : text
}

export type ReadWindow = {
  raw: string[]
  count: number
  cut: boolean
  more: boolean
  offset: number
}

export async function lines(filepath: string, opts: { limit: number; offset: number }): Promise<ReadWindow> {
  const stream = createReadStream(filepath, { encoding: "utf8" })
  const rl = createInterface({
    input: stream,
    // Note: we use the crlfDelay option to recognize all instances of CR LF
    // ('\r\n') in file as a single line break.
    crlfDelay: Infinity,
  })

  const start = opts.offset - 1
  const raw: string[] = []
  let bytes = 0
  let count = 0
  let cut = false
  let more = false
  try {
    for await (const text of rl) {
      count += 1
      if (count <= start) continue

      if (raw.length >= opts.limit) {
        more = true
        continue
      }

      const line = truncateLine(text)
      const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
      if (bytes + size > MAX_BYTES) {
        cut = true
        more = true
        break
      }

      raw.push(line)
      bytes += size
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  return { raw, count, cut, more, offset: opts.offset }
}

export function getChangedRanges(diffText: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const lines = diffText.split("\n")
  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
      if (match) {
        const start = parseInt(match[1], 10)
        const length = match[2] ? parseInt(match[2], 10) : 1
        ranges.push({ start, end: start + (length > 0 ? length - 1 : 0) })
      }
    }
  }
  return ranges
}

export async function linesWithHunks(
  filepath: string,
  ranges: Array<{ start: number; end: number }>,
  contextLines = 3,
): Promise<ReadWindow> {
  const stream = createReadStream(filepath, { encoding: "utf8" })
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  // Expand ranges with context padding and merge overlapping ones
  const expanded = ranges
    .map((r) => ({
      start: Math.max(1, r.start - contextLines),
      end: r.end + contextLines,
    }))
    .sort((a, b) => a.start - b.start)

  const merged: Array<{ start: number; end: number }> = []
  for (const r of expanded) {
    if (merged.length === 0) {
      merged.push(r)
    } else {
      const last = merged[merged.length - 1]
      if (r.start <= last.end + 1) {
        last.end = Math.max(last.end, r.end)
      } else {
        merged.push(r)
      }
    }
  }

  const raw: string[] = []
  let count = 0
  let bytes = 0
  let cut = false

  try {
    for await (const text of rl) {
      count += 1

      // Check if current line falls into any of the merged ranges
      const inRange = merged.some((r) => count >= r.start && count <= r.end)
      if (!inRange) continue

      const line = truncateLine(text)
      const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
      if (bytes + size > MAX_BYTES) {
        cut = true
        break
      }

      raw.push(`${count}: ${line}`)
      bytes += size
    }
  } finally {
    rl.close()
    stream.destroy()
  }

  return { raw, count, cut, more: false, offset: 1 }
}