export function normalizeUnicode(str: string): string {
  return str
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
}

export const Comparators = {
  exact: (a: string, b: string) => a === b,
  rstrip: (a: string, b: string) => a.trimEnd() === b.trimEnd(),
  trim: (a: string, b: string) => a.trim() === b.trim(),
  normalized: (a: string, b: string) => normalizeUnicode(a.trim()) === normalizeUnicode(b.trim()),
} as const

export type Comparator = (a: string, b: string) => boolean

export function findPattern(lines: string[], pattern: string[], startIndex: number, compare: Comparator): number {
  if (pattern.length === 0) return -1

  for (let i = startIndex; i <= lines.length - pattern.length; i++) {
    let matches = true
    for (let j = 0; j < pattern.length; j++) {
      if (!compare(lines[i + j], pattern[j])) {
        matches = false
        break
      }
    }
    if (matches) return i
  }
  return -1
}

export function findExactPattern(lines: string[], pattern: string[], startIndex: number, eof: boolean): number {
  if (pattern.length === 0) return -1

  if (eof) {
    const back = findPatternBackward(lines, pattern, Comparators.exact)
    if (back >= startIndex) return back
  }

  if (pattern[0] === "") return -1
  const content = lines.join("\n")
  const prefix = startIndex > 0 ? lines.slice(0, startIndex).join("\n").length + 1 : 0
  const searchTarget = pattern[0] + "\n"
  let from = prefix
  while (from < content.length) {
    const idx = content.indexOf(searchTarget, from)
    if (idx === -1) break
    if (idx === 0 || content[idx - 1] === "\n") {
      const lineIdx = content.substring(0, idx).split("\n").length - 1
      if (lineIdx <= lines.length - pattern.length) {
        let matches = true
        for (let j = 1; j < pattern.length; j++) {
          if (lines[lineIdx + j] !== pattern[j]) {
            matches = false
            break
          }
        }
        if (matches) return lineIdx
      }
    }
    from = idx + searchTarget.length
  }
  return -1
}

export function findPatternBackward(lines: string[], pattern: string[], compare: Comparator): number {
  if (pattern.length === 0) return -1

  const fromEnd = lines.length - pattern.length
  if (fromEnd < 0) return -1

  for (let j = 0; j < pattern.length; j++) {
    if (!compare(lines[fromEnd + j], pattern[j])) return -1
  }
  return fromEnd
}
