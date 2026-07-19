import { describe, expect, test } from "bun:test"
import { shouldComplete, applyAutoclose } from "../../src/session/todo-autoclose"
import type { Info } from "../../src/session/todo"

const pending: Info = { content: "implement verification logic", status: "pending", priority: "high" }
const completed: Info = { content: "already completed task", status: "completed", priority: "low" }
const cancelled: Info = { content: "cancelled task", status: "cancelled", priority: "medium" }
const shortWords: Info = { content: "fix it", status: "pending", priority: "high" }

const matchingDiff = { filePath: "src/verify.ts", diff: "implement verification logic here" }
const nonMatchingDiff = { filePath: "src/other.ts", diff: "unrelated changes to something else" }

describe("shouldComplete", () => {
  test("returns true when all significant words appear in a diff", () => {
    expect(shouldComplete(pending, [matchingDiff])).toBe(true)
  })

  test("returns false when no significant words appear in any diff", () => {
    expect(shouldComplete(pending, [nonMatchingDiff])).toBe(false)
  })

  test("returns false when todo is already completed", () => {
    expect(shouldComplete(completed, [matchingDiff])).toBe(false)
  })

  test("returns false when todo is already cancelled", () => {
    expect(shouldComplete(cancelled, [matchingDiff])).toBe(false)
  })

  test("returns false when todo has no significant words (all <= 3 chars)", () => {
    expect(shouldComplete(shortWords, [matchingDiff])).toBe(false)
  })

  test("is case insensitive", () => {
    const upperTodo: Info = { content: "IMPLEMENT VERIFICATION LOGIC", status: "pending", priority: "high" }
    expect(shouldComplete(upperTodo, [matchingDiff])).toBe(true)
  })

  test("matches across multiple file changes", () => {
    const diffs = [
      { filePath: "src/a.ts", diff: "unrelated" },
      { filePath: "src/b.ts", diff: "implement verification logic" },
    ]
    expect(shouldComplete(pending, diffs)).toBe(true)
  })

  test("returns false with empty fileChanges", () => {
    expect(shouldComplete(pending, [])).toBe(false)
  })
})

describe("applyAutoclose", () => {
  test("returns same array reference when no todos match", () => {
    const todos: Info[] = [pending]
    const result = applyAutoclose(todos, [nonMatchingDiff])
    expect(result).toBe(todos) // reference equality optimization
  })

  test("returns new array with completed status when match found", () => {
    const todos: Info[] = [pending]
    const result = applyAutoclose(todos, [matchingDiff])
    expect(result).not.toBe(todos)
    expect(result[0].status).toBe("completed")
    expect(result[0].content).toBe(pending.content)
  })

  test("skips already completed todos", () => {
    const todos: Info[] = [completed]
    const result = applyAutoclose(todos, [matchingDiff])
    expect(result).toBe(todos)
  })

  test("skips already cancelled todos", () => {
    const todos: Info[] = [cancelled]
    const result = applyAutoclose(todos, [matchingDiff])
    expect(result).toBe(todos)
  })

  test("handles empty todos array", () => {
    const todos: Info[] = []
    const result = applyAutoclose(todos, [matchingDiff])
    expect(result).toBe(todos)
  })

  test("preserves non-matching todos and completes matching ones", () => {
    const todos: Info[] = [
      { content: "implement verification logic", status: "pending", priority: "high" },
      { content: "unrelated task", status: "pending", priority: "medium" },
    ]
    const result = applyAutoclose(todos, [matchingDiff])
    expect(result).not.toBe(todos)
    expect(result[0].status).toBe("completed")
    expect(result[1].status).toBe("pending")
    expect(result[1].content).toBe("unrelated task")
  })

  test("handles empty fileChanges", () => {
    const todos: Info[] = [pending]
    const result = applyAutoclose(todos, [])
    expect(result).toBe(todos)
  })
})
