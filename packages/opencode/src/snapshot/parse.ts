export interface DiffRow {
  file: string
  status: "added" | "deleted" | "modified"
  binary: boolean
  additions: number
  deletions: number
}

export function parseNameStatus(text: string): Map<string, "added" | "deleted" | "modified"> {
  const status = new Map<string, "added" | "deleted" | "modified">()
  for (const line of text.trim().split("\n")) {
    if (!line) continue
    const [code, file] = line.split("\t")
    if (!code || !file) continue
    status.set(file, code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified")
  }
  return status
}

export function parseNumstat(text: string, status: Map<string, "added" | "deleted" | "modified">): DiffRow[] {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [adds, dels, file] = line.split("\t")
      if (!file) return []
      const binary = adds === "-" && dels === "-"
      const additions = binary ? 0 : parseInt(adds)
      const deletions = binary ? 0 : parseInt(dels)
      return [
        {
          file,
          status: status.get(file) ?? "modified",
          binary,
          additions: Number.isFinite(additions) ? additions : 0,
          deletions: Number.isFinite(deletions) ? deletions : 0,
        },
      ]
    })
}
