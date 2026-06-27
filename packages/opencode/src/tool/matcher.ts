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
  const search = pattern[pattern.length - 1] === "" ? pattern.slice(0, -1) : pattern
  if (search.length === 0) return -1

  for (let i = startIndex; i <= lines.length - search.length; i++) {
    let matches = true
    for (let j = 0; j < search.length; j++) {
      if (!compare(lines[i + j], search[j])) {
        matches = false
        break
      }
    }
    if (matches) return i
  }
  return -1
}

export function findPatternBackward(lines: string[], pattern: string[], compare: Comparator): number {
  const search = pattern[pattern.length - 1] === "" ? pattern.slice(0, -1) : pattern
  if (search.length === 0) return -1

  const fromEnd = lines.length - search.length
  if (fromEnd < 0) return -1

  for (let j = 0; j < search.length; j++) {
    if (!compare(lines[fromEnd + j], search[j])) return -1
  }
  return fromEnd
}
