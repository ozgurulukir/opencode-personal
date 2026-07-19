import type { Todo } from "@/session/todo"
import { RGBA } from "@opentui/core"
import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: Todo.TodoStatus
  content: string
  priority?: Todo.TodoPriority
}

function todoIcon(status: Todo.TodoStatus): string {
  switch (status) {
    case "completed":
      return "✓"
    case "in_progress":
      return "•"
    case "cancelled":
      return "✕"
    case "pending":
      return " "
  }
}

function priorityBadge(priority?: Todo.TodoPriority): string {
  switch (priority) {
    case "high":
      return "[H]"
    case "medium":
      return "[M]"
    case "low":
      return "[L]"
    default:
      return ""
  }
}

function priorityColor(priority: Todo.TodoPriority | undefined, theme: ReturnType<typeof useTheme>["theme"]): RGBA | undefined {
  switch (priority) {
    case "high":
      return theme.error
    case "medium":
      return theme.warning
    case "low":
      return theme.success
    default:
      return undefined
  }
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: priorityColor(props.priority, theme) ?? (props.status === "in_progress" ? theme.warning : theme.textMuted),
        }}
      >
        {priorityBadge(props.priority)}{todoIcon(props.status)}{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        {props.content}
      </text>
    </box>
  )
}
