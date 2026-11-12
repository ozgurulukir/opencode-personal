import type { Accessor } from "solid-js"
import { produce } from "solid-js/store"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { showToast, toaster } from "@opencode-ai/ui/toast"
import { pathKey } from "@/utils/path-key"
import { effectiveWorkspaceOrder, errorMessage } from "./helpers"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"

export function shouldLeaveDeletedWorkspace(input: {
  leaveDeletedWorkspace: boolean
  hasRouteSlug: boolean
  currentDirectory: string
  deletedDirectory: string
}): boolean {
  return input.leaveDeletedWorkspace || (input.hasRouteSlug && pathKey(input.currentDirectory) === pathKey(input.deletedDirectory))
}

export function needsPostDeleteRedirect(input: {
  hasRouteSlug: boolean
  resolvedRoot: string
  root: string
  nextKey: string
  workspaceDirs: string[]
}): boolean {
  const valid = input.workspaceDirs.some((item) => pathKey(item) === pathKey(input.nextKey))
  return input.hasRouteSlug && input.resolvedRoot === input.root && !valid
}

export function createWorkspaceOperations(input: {
  currentDir: Accessor<string>
  params: { dir?: string }
  globalSDK: ReturnType<typeof useGlobalSDK>
  globalSync: ReturnType<typeof useGlobalSync>
  language: ReturnType<typeof useLanguage>
  layout: ReturnType<typeof useLayout>
  store: {
    lastProjectSession: { [directory: string]: { directory: string; id: string; at: number } }
    workspaceOrder: { [root: string]: string[] }
  }
  navigateRoot: (href: string) => void
  navigate: (href: string) => void
  setBusy: (directory: string, value: boolean) => void
  clearTerminals: (directory: string, sessionIDs: string[]) => void
  removeWorkspaceOrder: (root: string, directory: string) => void
  resolveProjectRoot: (directory: string) => string
  clearLastProjectSession: (root: string) => void
}) {
  const deleteWorkspace = async (root: string, directory: string, leaveDeletedWorkspace = false) => {
    if (directory === root) return

    const current = input.currentDir()
    const shouldLeave = shouldLeaveDeletedWorkspace({
      leaveDeletedWorkspace,
      hasRouteSlug: input.params.dir !== undefined,
      currentDirectory: current,
      deletedDirectory: directory,
    })
    if (!leaveDeletedWorkspace && shouldLeave) {
      input.navigateRoot(`/${base64Encode(root)}/session`)
    }

    input.setBusy(directory, true)

    const result = await input.globalSDK.client.worktree
      .remove({ directory: root, worktreeRemoveInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: input.language.t("workspace.delete.failed.title"),
          description: errorMessage(err, input.language.t("common.requestFailed")),
        })
        return false
      })

    input.setBusy(directory, false)

    if (!result) return

    if (pathKey(input.store.lastProjectSession[root]?.directory ?? "") === pathKey(directory)) {
      input.clearLastProjectSession(root)
    }

    input.globalSync.set(
      "project",
      produce((draft) => {
        const project = draft.find((item) => item.worktree === root)
        if (!project) return
        project.sandboxes = (project.sandboxes ?? []).filter((sandbox) => sandbox !== directory)
      }),
    )
    input.removeWorkspaceOrder(root, directory)

    input.layout.projects.close(directory)
    input.layout.projects.open(root)

    if (shouldLeave) return

    const nextCurrent = input.currentDir()
    const nextKey = pathKey(nextCurrent)
    const project = input.layout.projects.list().find((item) => item.worktree === root)
    const dirs = project
      ? effectiveWorkspaceOrder(root, [root, ...(project.sandboxes ?? [])], input.store.workspaceOrder[root])
      : [root]
    if (
      needsPostDeleteRedirect({
        hasRouteSlug: input.params.dir !== undefined,
        resolvedRoot: input.resolveProjectRoot(nextCurrent),
        root,
        nextKey,
        workspaceDirs: dirs,
      })
    ) {
      input.navigateRoot(`/${base64Encode(root)}/session`)
    }
  }

  const resetWorkspace = async (root: string, directory: string) => {
    if (directory === root) return
    input.setBusy(directory, true)

    const progress = showToast({
      persistent: true,
      title: input.language.t("workspace.resetting.title"),
      description: input.language.t("workspace.resetting.description"),
    })
    const dismiss = () => toaster.dismiss(progress)

    const sessions: Session[] = await input.globalSDK.client.v2.session
      .list({ directory, limit: 100 })
      .then((x) => x.data?.items ?? [])
      .catch(() => [])

    input.clearTerminals(directory, sessions.map((s) => s.id))
    await input.globalSDK.client.instance.dispose({ directory }).catch(() => undefined)

    const result = await input.globalSDK.client.worktree
      .reset({ directory: root, worktreeResetInput: { directory } })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: input.language.t("workspace.reset.failed.title"),
          description: errorMessage(err, input.language.t("common.requestFailed")),
        })
        return false
      })

    if (!result) {
      input.setBusy(directory, false)
      dismiss()
      return
    }

    const archivedAt = Date.now()
    await Promise.all(
      sessions
        .filter((session) => session.time.archived === undefined)
        .map((session) =>
          input.globalSDK.client.v2.session.update({
            sessionID: session.id,
            directory: session.directory,
            time: { archived: archivedAt },
          })
            .catch(() => undefined),
        ),
    )

    input.setBusy(directory, false)
    dismiss()

    showToast({
      title: input.language.t("workspace.reset.success.title"),
      description: input.language.t("workspace.reset.success.description"),
      actions: [
        {
          label: input.language.t("command.session.new"),
          onClick: () => {
            const href = `/${base64Encode(directory)}/session`
            input.navigate(href)
            input.layout.mobileSidebar.hide()
          },
        },
        {
          label: input.language.t("common.dismiss"),
          onClick: "dismiss",
        },
      ],
    })
  }
  return { deleteWorkspace, resetWorkspace }
}
