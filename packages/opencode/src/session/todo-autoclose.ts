import type { Info } from "./todo"

export interface FileChange {
  filePath: string
  diff: string
}

/**
 * Returns true if the todo should be auto-completed based on matching
 * significant keywords in the provided file diffs.
 *
 * A todo is eligible if:
 * 1. It is not already completed or cancelled
 * 2. It has at least one significant word (>3 characters)
 * 3. All significant words appear in at least one diff (case insensitive)
 */
export function shouldComplete(todo: Info, fileChanges: FileChange[]): boolean {
  if (todo.status === "completed" || todo.status === "cancelled") return false

  const contentLower = todo.content.toLowerCase()
  const words = contentLower.split(/\s+/).filter((w) => w.length > 3)
  if (words.length === 0) return false

  return fileChanges.some((change) => {
    const diffLower = change.diff.toLowerCase()
    return words.every((word) => diffLower.includes(word))
  })
}

/**
 * Applies autoclose logic to a list of todos.
 *
 * Returns the same array reference if no todos were changed (reference equality
 * optimization for callers that check `changed`).
 */
export function applyAutoclose(todos: Info[], fileChanges: FileChange[]): Info[] {
  if (todos.length === 0) return todos

  let changed = false
  const next = todos.map((todo) => {
    if (shouldComplete(todo, fileChanges)) {
      changed = true
      return { ...todo, status: "completed" }
    }
    return todo
  })

  return changed ? next : todos
}
