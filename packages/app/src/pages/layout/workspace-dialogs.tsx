import type { Session } from "@opencode-ai/sdk/v2/client"
import { createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { getFilename } from "@opencode-ai/core/util/path"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"

export function DialogDeleteWorkspace(props: {
  root: string
  directory: string
  isCurrentWorkspace: () => boolean
  onNavigateSidebarReset: (href: string) => void
  onDelete: (root: string, directory: string, leaveDeletedWorkspace: boolean) => void
}) {
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const name = createMemo(() => getFilename(props.directory))
  const [data, setData] = createStore({
    status: "loading" as "loading" | "ready" | "error",
    dirty: false,
  })

  onMount(() => {
    globalSDK.client.file
      .status({ directory: props.directory })
      .then((x) => {
        const files = x.data ?? []
        const dirty = files.length > 0
        setData({ status: "ready", dirty })
      })
      .catch(() => {
        setData({ status: "error", dirty: false })
      })
  })

  const handleDelete = () => {
    const leaveDeletedWorkspace = props.isCurrentWorkspace()
    if (leaveDeletedWorkspace) {
      props.onNavigateSidebarReset(`/${base64Encode(props.root)}/session`)
    }
    dialog.close()
    void props.onDelete(props.root, props.directory, leaveDeletedWorkspace)
  }

  const description = () => {
    if (data.status === "loading") return language.t("workspace.status.checking")
    if (data.status === "error") return language.t("workspace.status.error")
    if (!data.dirty) return language.t("workspace.status.clean")
    return language.t("workspace.status.dirty")
  }

  return (
    <Dialog title={language.t("workspace.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("workspace.delete.confirm", { name: name() })}
          </span>
          <span class="text-12-regular text-text-weak">{description()}</span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={data.status === "loading"} onClick={handleDelete}>
            {language.t("workspace.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

export function DialogResetWorkspace(props: {
  root: string
  directory: string
  onReset: (root: string, directory: string) => void
}) {
  const globalSDK = useGlobalSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const name = createMemo(() => getFilename(props.directory))
  const [state, setState] = createStore({
    status: "loading" as "loading" | "ready" | "error",
    dirty: false,
    sessions: [] as Session[],
  })

  const refresh = async () => {
    const sessions = await globalSDK.client.v2.session
      .list({ directory: props.directory, limit: 100 })
      .then((x) => x.data?.items ?? [])
      .catch(() => [])
    const active = sessions.filter((session) => session.time.archived === undefined)
    setState({ sessions: active })
  }

  onMount(() => {
    globalSDK.client.file
      .status({ directory: props.directory })
      .then((x) => {
        const files = x.data ?? []
        const dirty = files.length > 0
        setState({ status: "ready", dirty })
        void refresh()
      })
      .catch(() => {
        setState({ status: "error", dirty: false })
      })
  })

  const handleReset = () => {
    dialog.close()
    void props.onReset(props.root, props.directory)
  }

  const archivedCount = () => state.sessions.length

  const description = () => {
    if (state.status === "loading") return language.t("workspace.status.checking")
    if (state.status === "error") return language.t("workspace.status.error")
    if (!state.dirty) return language.t("workspace.status.clean")
    return language.t("workspace.status.dirty")
  }

  const archivedLabel = () => {
    const count = archivedCount()
    if (count === 0) return language.t("workspace.reset.archived.none")
    if (count === 1) return language.t("workspace.reset.archived.one")
    return language.t("workspace.reset.archived.many", { count })
  }

  return (
    <Dialog title={language.t("workspace.reset.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">
            {language.t("workspace.reset.confirm", { name: name() })}
          </span>
          <span class="text-12-regular text-text-weak">
            {description()} {archivedLabel()} {language.t("workspace.reset.note")}
          </span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" disabled={state.status === "loading"} onClick={handleReset}>
            {language.t("workspace.reset.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
