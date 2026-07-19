import type { Todo } from "@/session/todo"
import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: Todo.TodoStatus
  content: string
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

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        [{todoIcon(props.status)}]{" "}
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
