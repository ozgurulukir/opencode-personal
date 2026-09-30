export const docsLocale = ["tr"] as const

export type DocsLocale = (typeof docsLocale)[number]

export const locale = ["root", ...docsLocale] as const

export type Locale = (typeof locale)[number]

export const localeAlias = {
  en: "root",
  root: "root",
  tr: "tr",
} as const satisfies Record<string, Locale>

const starts = [
  ["tr", "tr"],
  ["en", "root"],
] as const satisfies readonly (readonly [string, Locale])[]

function parse(input: string) {
  let decoded = ""
  try {
    decoded = decodeURIComponent(input)
  } catch {
    return null
  }

  const value = decoded.trim().toLowerCase()
  if (!value) return null
  return value
}

export function exactLocale(input: string) {
  const value = parse(input)
  if (!value) return null

  const alias = Object.entries(localeAlias).find(([key]) => key === value)?.[1]
  if (alias) return alias

  return null
}

export function matchLocale(input: string) {
  const value = parse(input)
  if (!value) return null

  const alias = Object.entries(localeAlias).find(([key]) => key === value)?.[1]
  if (alias) return alias

  return starts.find((item) => value.startsWith(item[0]))?.[1] ?? null
}
