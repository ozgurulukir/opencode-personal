import { parsePatch } from "diff"

export function getRevertDiffFiles(diffText: string) {
  if (!diffText) return []

  try {
    return parsePatch(diffText).map((patch) => {
      const filename = [patch.newFileName, patch.oldFileName].find((item) => item && item !== "/dev/null") ?? "unknown"

      // ⚡ Bolt Optimization: Replace multiple .reduce() and .filter().length with a single loop to reduce GC pressure
      let additions = 0
      let deletions = 0
      for (let i = 0; i < patch.hunks.length; i++) {
        const lines = patch.hunks[i].lines
        for (let j = 0; j < lines.length; j++) {
          const line = lines[j]
          if (line.startsWith("+")) additions++
          else if (line.startsWith("-")) deletions++
        }
      }

      return {
        filename: filename.replace(/^[ab]\//, ""),
        additions,
        deletions,
      }
    })
  } catch {
    return []
  }
}
