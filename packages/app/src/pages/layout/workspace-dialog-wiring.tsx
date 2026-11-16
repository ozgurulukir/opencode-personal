import type { JSX } from "solid-js"
import { DialogDeleteWorkspace, DialogResetWorkspace } from "./workspace-dialogs"

type Dialog = { show: (element: () => JSX.Element, onClose?: () => void) => void }

/**
 * Builds the workspace reset/delete dialog openers used by the sidebar context.
 * Kept out of `layout.tsx` so the dialog wiring is declared in one place and the
 * page only supplies the operations it already owns.
 */
export function createWorkspaceDialogWiring(input: {
  dialog: Dialog
  isCurrentWorkspace: (directory: string) => boolean
  navigateWithSidebarReset: (href: string) => void
  deleteWorkspace: (root: string, directory: string, leaveDeletedWorkspace: boolean) => void | Promise<void>
  resetWorkspace: (root: string, directory: string) => void | Promise<void>
}) {
  const showResetWorkspaceDialog = (root: string, directory: string) =>
    input.dialog.show(() => <DialogResetWorkspace root={root} directory={directory} onReset={input.resetWorkspace} />)

  const showDeleteWorkspaceDialog = (root: string, directory: string) =>
    input.dialog.show(() => (
      <DialogDeleteWorkspace
        root={root}
        directory={directory}
        isCurrentWorkspace={() => input.isCurrentWorkspace(directory)}
        onNavigateSidebarReset={input.navigateWithSidebarReset}
        onDelete={input.deleteWorkspace}
      />
    ))

  return { showResetWorkspaceDialog, showDeleteWorkspaceDialog }
}
