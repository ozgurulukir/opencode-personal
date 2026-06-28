import * as Bom from "../util/bom"
import {
  Comparators,
  findPattern,
  findPatternAmbiguity,
  findExactPattern,
  findPatternBackward,
  type Comparator,
} from "../tool/matcher"

export type Hunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; move_path?: string; force?: boolean; chunks: UpdateFileChunk[] }

export interface UpdateFileChunk {
  old_lines: string[]
  new_lines: string[]
  change_context?: string
  is_end_of_file?: boolean
}

// Parser implementation
function parsePatchHeader(
  lines: string[],
  startIdx: number,
): { filePath: string; movePath?: string; force?: boolean; nextIdx: number } | null {
  const line = lines[startIdx]

  if (line.startsWith("*** Add File:")) {
    const filePath = line.slice("*** Add File:".length).trim()
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null
  }

  if (line.startsWith("*** Delete File:")) {
    const filePath = line.slice("*** Delete File:".length).trim()
    return filePath ? { filePath, nextIdx: startIdx + 1 } : null
  }

  if (line.startsWith("*** Update File:")) {
    const filePath = line.slice("*** Update File:".length).trim()
    let movePath: string | undefined
    let force: boolean | undefined
    let nextIdx = startIdx + 1

    // Check for move directive (force variant must be tested first — "Force Move to"
    // does not start with "Move to" but is a distinct keyword)
    if (nextIdx < lines.length && lines[nextIdx].startsWith("*** Force Move to:")) {
      movePath = lines[nextIdx].slice("*** Force Move to:".length).trim()
      force = true
      nextIdx++
    } else if (nextIdx < lines.length && lines[nextIdx].startsWith("*** Move to:")) {
      movePath = lines[nextIdx].slice("*** Move to:".length).trim()
      nextIdx++
    }

    return filePath ? { filePath, movePath, force, nextIdx } : null
  }

  return null
}

function parseUpdateFileChunks(lines: string[], startIdx: number): { chunks: UpdateFileChunk[]; nextIdx: number } {
  const chunks: UpdateFileChunk[] = []
  let i = startIdx

  while (i < lines.length && !lines[i].startsWith("***")) {
    if (lines[i].startsWith("@@")) {
      // Parse context line
      const contextLine = lines[i].substring(2).trim()
      i++

      const oldLines: string[] = []
      const newLines: string[] = []
      let isEndOfFile = false

      // Parse change lines
      while (i < lines.length && !lines[i].startsWith("@@") && !lines[i].startsWith("***")) {
        const changeLine = lines[i]

        if (changeLine === "*** End of File") {
          isEndOfFile = true
          i++
          break
        }

        if (changeLine.startsWith(" ")) {
          // Keep line - appears in both old and new
          const content = changeLine.substring(1)
          oldLines.push(content)
          newLines.push(content)
        } else if (changeLine.startsWith("-")) {
          // Remove line - only in old
          oldLines.push(changeLine.substring(1))
        } else if (changeLine.startsWith("+")) {
          // Add line - only in new
          newLines.push(changeLine.substring(1))
        } else {
          // Inside a chunk, any non-prefix line is malformed. Blank lines are
          // the only exception (LLMs sometimes emit them between changes).
          if (changeLine.trim() !== "") {
            throw new Error(`Malformed patch line in update body: ${changeLine}`)
          }
        }

        i++
      }

      // Reject empty hunks early — they signal a parser bug or LLM confusion
      if (oldLines.length === 0 && newLines.length === 0 && !isEndOfFile) {
        throw new Error(`Empty hunk${contextLine ? ` (context: ${contextLine})` : ""}`)
      }

      chunks.push({
        old_lines: oldLines,
        new_lines: newLines,
        change_context: contextLine || undefined,
        is_end_of_file: isEndOfFile || undefined,
      })
    } else {
      // Between chunks: only blank lines are allowed. Anything else is malformed.
      if (lines[i].trim() !== "") {
        throw new Error(`Malformed patch line in update body: ${lines[i]}`)
      }
      i++
    }
  }

  return { chunks, nextIdx: i }
}

function parseAddFileContent(lines: string[], startIdx: number): { content: string; nextIdx: number } {
  let content = ""
  let i = startIdx

  while (i < lines.length && !lines[i].startsWith("***")) {
    if (lines[i].startsWith("+")) {
      content += lines[i].substring(1) + "\n"
    }
    i++
  }

  // Remove trailing newline
  if (content.endsWith("\n")) {
    content = content.slice(0, -1)
  }

  return { content, nextIdx: i }
}

function stripHeredoc(input: string): string {
  // Match heredoc patterns like: cat <<'EOF'\n...\nEOF or <<EOF\n...\nEOF
  const heredocMatch = input.match(/^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/)
  if (heredocMatch) {
    return heredocMatch[2]
  }
  return input
}

export function parsePatch(patchText: string): { hunks: Hunk[] } {
  const cleaned = stripHeredoc(patchText.trim())
  const lines = cleaned.split("\n")
  const hunks: Hunk[] = []
  let i = 0

  // Look for Begin/End patch markers
  const beginMarker = "*** Begin Patch"
  const endMarker = "*** End Patch"

  const beginIdx = lines.findIndex((line) => line.trim() === beginMarker)
  const endIdx = lines.findIndex((line) => line.trim() === endMarker)

  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    throw new Error("Invalid patch format: missing Begin/End markers")
  }

  // Parse content between markers
  i = beginIdx + 1

  while (i < endIdx) {
    const header = parsePatchHeader(lines, i)
    if (!header) {
      if (lines[i].startsWith("***") && lines[i] !== "*** End of File") {
        throw new Error(`Unrecognized patch header: ${lines[i]}`)
      }
      i++
      continue
    }

    if (lines[i].startsWith("*** Add File:")) {
      const { content, nextIdx } = parseAddFileContent(lines, header.nextIdx)
      hunks.push({
        type: "add",
        path: header.filePath,
        contents: content,
      })
      i = nextIdx
    } else if (lines[i].startsWith("*** Delete File:")) {
      hunks.push({
        type: "delete",
        path: header.filePath,
      })
      i = header.nextIdx
    } else if (lines[i].startsWith("*** Update File:")) {
      const { chunks, nextIdx } = parseUpdateFileChunks(lines, header.nextIdx)
      hunks.push({
        type: "update",
        path: header.filePath,
        move_path: header.movePath,
        force: header.force,
        chunks,
      })
      i = nextIdx
    } else {
      i++
    }
  }

  return { hunks }
}

interface ApplyPatchFileUpdate {
  content: string
  bom: boolean
}

export function deriveNewContentsFromChunks(
  filePath: string,
  chunks: UpdateFileChunk[],
  original: { text: string; bom: boolean },
): ApplyPatchFileUpdate {
  let originalLines = original.text.split("\n")

  // Drop trailing empty element for consistent line counting
  if (originalLines.length > 0 && originalLines[originalLines.length - 1] === "") {
    originalLines.pop()
  }

  const replacements = computeReplacements(originalLines, filePath, chunks)
  let newLines = applyReplacements(originalLines, replacements)

  // Ensure trailing newline
  if (newLines.length === 0 || newLines[newLines.length - 1] !== "") {
    newLines.push("")
  }

  const next = Bom.split(newLines.join("\n"))
  const newContent = next.text

  return {
    content: newContent,
    bom: original.bom || next.bom,
  }
}

function computeReplacements(
  originalLines: string[],
  filePath: string,
  chunks: UpdateFileChunk[],
): Array<[number, number, string[]]> {
  const replacements: Array<[number, number, string[]]> = []
  let lineIndex = 0

  for (const chunk of chunks) {
    // Track whether the LLM provided @@ context for this chunk. When context
    // is present, lineIndex is narrowed (line 242 below), so we accept the
    // first match without ambiguity checking. Without context, fuzzy matches
    // must be unique in the rest of the file to avoid silent wrong-location
    // edits.
    const requireUnique = !chunk.change_context

    // Handle context-based seeking
    if (chunk.change_context) {
      const contextIdx = seekSequence(originalLines, [chunk.change_context], lineIndex)
      if (contextIdx === -1) {
        throw new Error(`Failed to find context '${chunk.change_context}' in ${filePath}`)
      }
      lineIndex = contextIdx + 1
    }

    // Handle pure addition (no old lines)
    if (chunk.old_lines.length === 0) {
      const insertionIdx =
        originalLines.length > 0 && originalLines[originalLines.length - 1] === ""
          ? originalLines.length - 1
          : originalLines.length
      replacements.push([insertionIdx, 0, chunk.new_lines])
      continue
    }

    // Try to match old lines in the file.
    // LLM patches often have a trailing empty line that doesn't exist in the file.
    // Strip it from both pattern (for matching) and newSlice (for replacement content)
    // so the splice lengths stay consistent.
    let pattern = chunk.old_lines
    let newSlice = chunk.new_lines
    let found = seekSequence(originalLines, pattern, lineIndex, chunk.is_end_of_file, requireUnique)

    if (found === -1 && pattern.length > 1 && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1)
      if (newSlice.length > 0 && newSlice[newSlice.length - 1] === "") {
        newSlice = newSlice.slice(0, -1)
      }
      found = seekSequence(originalLines, pattern, lineIndex, chunk.is_end_of_file, requireUnique)
    }

    if (found !== -1) {
      replacements.push([found, pattern.length, newSlice])
      lineIndex = found + pattern.length
    } else {
      throw new Error(`Failed to find expected lines in ${filePath}:\n${chunk.old_lines.join("\n")}`)
    }
  }

  // Sort replacements by index to apply in order
  replacements.sort((a, b) => a[0] - b[0])

  // Defensive invariant: replacements must not overlap. lineIndex monotonic
  // advancement in the loop above normally prevents this; the check exists
  // to catch regressions in lineIndex logic or custom chunk flows and to
  // document the contract that callers can rely on non-overlapping ranges.
  for (let k = 1; k < replacements.length; k++) {
    const prev = replacements[k - 1]
    const curr = replacements[k]
    // Pure insertions (length 0) at the same position are allowed — they
    // represent sequential inserts, not range conflicts.
    if (curr[0] < prev[0] + prev[1]) {
      throw new Error(
        `Overlapping hunks in ${filePath}: chunk at line ${curr[0]} overlaps previous chunk at line ${prev[0]} (length ${prev[1]})`,
      )
    }
  }

  return replacements
}

function applyReplacements(lines: string[], replacements: Array<[number, number, string[]]>): string[] {
  // Apply replacements in reverse order to avoid index shifting
  const result = [...lines]

  for (let i = replacements.length - 1; i >= 0; i--) {
    const [startIdx, oldLen, newSegment] = replacements[i]

    // Remove old lines
    result.splice(startIdx, oldLen)

    // Insert new lines
    for (let j = 0; j < newSegment.length; j++) {
      result.splice(startIdx + j, 0, newSegment[j])
    }
  }

  return result
}

function seekSequence(
  lines: string[],
  pattern: string[],
  startIndex: number,
  eof = false,
  requireUnique = false,
): number {
  if (pattern.length === 0) return -1

  // Pass 1: exact match with indexOf prefilter (O(n+m))
  const exact = findExactPattern(lines, pattern, startIndex, eof)
  if (exact !== -1) return exact

  // Pass 2-4: fuzzy comparators (rstrip → trim → normalized)
  for (const compare of [Comparators.rstrip, Comparators.trim, Comparators.normalized] as const) {
    if (requireUnique) {
      // Stop at the second match to detect ambiguity without scanning the
      // whole rest of the file unnecessarily.
      const { position, ambiguous } = findPatternAmbiguity(lines, pattern, startIndex, compare)
      if (ambiguous) {
        throw new Error(`Ambiguous fuzzy match for ${JSON.stringify(pattern[0])}. Provide @@ context to disambiguate.`)
      }
      if (position !== -1) return position
    } else {
      const result = findPattern(lines, pattern, startIndex, compare)
      if (result !== -1) return result
    }
    if (eof) {
      const back = findPatternBackward(lines, pattern, compare)
      if (back >= startIndex) return back
    }
  }

  return -1
}

export * as Patch from "."
