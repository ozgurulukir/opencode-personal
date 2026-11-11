import type { ContentPart } from "@/context/prompt"
import type { AtOption } from "./slash-popover"

export function atOptionKey(option: AtOption | undefined) {
  if (!option) return ""
  return option.type === "agent" ? `agent:${option.name}` : `file:${option.path}`
}

export function atOptionGroup(item: AtOption) {
  if (item.type === "agent") return "agent"
  if (item.recent) return "recent"
  return "file"
}

export function compareAtGroups(a: { category: string }, b: { category: string }) {
  const rank = (category: string) => {
    if (category === "agent") return 0
    if (category === "recent") return 1
    return 2
  }
  return rank(a.category) - rank(b.category)
}

export function atSelectPart(option: AtOption): ContentPart {
  if (option.type === "agent") {
    return { type: "agent", name: option.name, content: "@" + option.name, start: 0, end: 0 }
  }
  return { type: "file", path: option.path, content: "@" + option.path, start: 0, end: 0 }
}

export function createAtMentionItems(input: {
  agents: () => AtOption[]
  recentPaths: () => string[]
  searchFiles: (query: string) => Promise<string[]>
}) {
  return async (query: string): Promise<AtOption[]> => {
    const agents = input.agents()
    const open = input.recentPaths()
    const seen = new Set(open)
    const pinned: AtOption[] = open.map((path) => ({ type: "file", path, display: path, recent: true }))
    if (!query.trim()) return [...agents, ...pinned]
    const paths = await input.searchFiles(query)
    const fileOptions: AtOption[] = paths
      .filter((path) => !seen.has(path))
      .map((path) => ({ type: "file", path, display: path }))
    return [...agents, ...pinned, ...fileOptions]
  }
}
