import type { Accessor } from "solid-js"
import type { DragEvent } from "@thisbeyond/solid-dnd"
import type { LocalProject } from "@/context/layout"
import { pathKey } from "@/utils/path-key"
import { getDraggableId } from "@/utils/solid-dnd"
import { reorderWorkspaceIds } from "./workspace-order"

/**
 * Drag handlers for the workspace list. Persists the reordered workspace ids
 * (excluding the project root, which is always first) to layout state.
 */
export function createWorkspaceDragController(input: {
  sidebarProject: Accessor<LocalProject | undefined>
  workspaceIds: (project: LocalProject) => string[]
  setActiveWorkspace: (id: string | undefined) => void
  setWorkspaceOrder: (worktree: string, order: string[]) => void
}) {
  const handleWorkspaceDragStart = (event: unknown) => {
    const id = getDraggableId(event)
    if (!id) return
    input.setActiveWorkspace(id)
  }

  const handleWorkspaceDragOver = (event: DragEvent) => {
    const { draggable, droppable } = event
    if (!draggable || !droppable) return

    const project = input.sidebarProject()
    if (!project) return

    const result = reorderWorkspaceIds(
      input.workspaceIds(project),
      draggable.id.toString(),
      droppable.id.toString(),
    )
    if (!result) return

    input.setWorkspaceOrder(
      project.worktree,
      result.filter((directory) => pathKey(directory) !== pathKey(project.worktree)),
    )
  }

  const handleWorkspaceDragEnd = () => {
    input.setActiveWorkspace(undefined)
  }

  return { handleWorkspaceDragStart, handleWorkspaceDragOver, handleWorkspaceDragEnd }
}
