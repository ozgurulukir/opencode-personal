import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createResource, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { normalizeServerUrl, ServerConnection, useServer } from "@/context/server"
import { Spinner } from "@opencode-ai/ui/spinner"
import { type ServerHealth, useCheckServerHealth } from "@/utils/server-health"

const DEFAULT_USERNAME = "opencode"

interface ServerFormProps {
  value: string
  name: string
  username: string
  password: string
  placeholder: string
  busy: boolean
  error: string
  status: boolean | undefined
  onChange: (value: string) => void
  onNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onBack: () => void
}

function showRequestError(language: ReturnType<typeof useLanguage>, err: unknown) {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

function useDefaultServer() {
  const language = useLanguage()
  const platform = usePlatform()
  const [defaultKey, defaultUrlActions] = createResource(
    async () => {
      try {
        const key = await platform.getDefaultServer?.()
        if (!key) return null
        return key
      } catch (err) {
        showRequestError(language, err)
        return null
      }
    },
    { initialValue: null },
  )

  const canDefault = createMemo(() => !!platform.getDefaultServer && !!platform.setDefaultServer)
  const setDefault = async (key: ServerConnection.Key | null) => {
    try {
      await platform.setDefaultServer?.(key)
      defaultUrlActions.mutate(key)
    } catch (err) {
      showRequestError(language, err)
    }
  }

  return { defaultKey, canDefault, setDefault }
}

function useServerPreview() {
  const checkServerHealth = useCheckServerHealth()

  const looksComplete = (value: string) => {
    const normalized = normalizeServerUrl(value)
    if (!normalized) return false
    const host = normalized.replace(/^https?:\/\//, "").split("/")[0]
    if (!host) return false
    if (host.includes("localhost") || host.startsWith("127.0.0.1")) return true
    return host.includes(".") || host.includes(":")
  }

  const previewStatus = async (
    value: string,
    username: string,
    password: string,
    setStatus: (value: boolean | undefined) => void,
  ) => {
    setStatus(undefined)
    if (!looksComplete(value)) return
    const normalized = normalizeServerUrl(value)
    if (!normalized) return
    const http: ServerConnection.HttpBase = { url: normalized }
    if (username) http.username = username
    if (password) http.password = password
    const result = await checkServerHealth(http)
    setStatus(result.healthy)
  }

  return { previewStatus }
}

function useServerFormState(input: {
  language: ReturnType<typeof useLanguage>
  previewStatus: ReturnType<typeof useServerPreview>["previewStatus"]
}) {
  const [store, setStore] = createStore({
    addServer: {
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      error: "",
      showForm: false,
      status: undefined as boolean | undefined,
    },
    editServer: {
      id: undefined as string | undefined,
      value: "",
      name: "",
      username: "",
      password: "",
      error: "",
      status: undefined as boolean | undefined,
    },
  })

  const resetAdd = () => {
    setStore("addServer", {
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      error: "",
      showForm: false,
      status: undefined,
    })
  }

  const resetEdit = () => {
    setStore("editServer", {
      id: undefined,
      value: "",
      name: "",
      username: "",
      password: "",
      error: "",
      status: undefined,
    })
  }

  const resetForm = () => {
    resetAdd()
    resetEdit()
  }

  const startAdd = () => {
    resetEdit()
    setStore("addServer", {
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      error: "",
      showForm: true,
      status: undefined,
    })
  }

  const startEdit = (conn: ServerConnection.Http, initialStatus?: boolean | undefined) => {
    resetAdd()
    setStore("editServer", {
      id: conn.http.url,
      value: conn.http.url,
      name: conn.displayName ?? "",
      username: conn.http.username ?? "",
      password: conn.http.password ?? "",
      error: "",
      status: initialStatus,
    })
  }

  const handleAddChange = (value: string) => {
    setStore("addServer", { url: value, error: "" })
    void input.previewStatus(value, store.addServer.username, store.addServer.password, (next) =>
      setStore("addServer", { status: next }),
    )
  }

  const handleAddNameChange = (value: string) => {
    setStore("addServer", { name: value, error: "" })
  }

  const handleAddUsernameChange = (value: string) => {
    setStore("addServer", { username: value, error: "" })
    void input.previewStatus(store.addServer.url, value, store.addServer.password, (next) =>
      setStore("addServer", { status: next }),
    )
  }

  const handleAddPasswordChange = (value: string) => {
    setStore("addServer", { password: value, error: "" })
    void input.previewStatus(store.addServer.url, store.addServer.username, value, (next) =>
      setStore("addServer", { status: next }),
    )
  }

  const handleEditChange = (value: string) => {
    setStore("editServer", { value, error: "" })
    void input.previewStatus(value, store.editServer.username, store.editServer.password, (next) =>
      setStore("editServer", { status: next }),
    )
  }

  const handleEditNameChange = (value: string) => {
    setStore("editServer", { name: value, error: "" })
  }

  const handleEditUsernameChange = (value: string) => {
    setStore("editServer", { username: value, error: "" })
    void input.previewStatus(store.editServer.value, value, store.editServer.password, (next) =>
      setStore("editServer", { status: next }),
    )
  }

  const handleEditPasswordChange = (value: string) => {
    setStore("editServer", { password: value, error: "" })
    void input.previewStatus(store.editServer.value, store.editServer.username, value, (next) =>
      setStore("editServer", { status: next }),
    )
  }

  const mode = createMemo<"list" | "add" | "edit">(() => {
    if (store.editServer.id) return "edit"
    if (store.addServer.showForm) return "add"
    return "list"
  })

  const isFormMode = createMemo(() => mode() !== "list")
  const isAddMode = createMemo(() => mode() === "add")

  const formTitle = createMemo(() => {
    if (!isFormMode()) return input.language.t("dialog.server.title")
    return (
      <div class="flex items-center gap-2 -ml-2">
        <IconButton icon="arrow-left" variant="ghost" onClick={resetForm} aria-label={input.language.t("common.goBack")} />
        <span>{isAddMode() ? input.language.t("dialog.server.add.title") : input.language.t("dialog.server.edit.title")}</span>
      </div>
    )
  })

  return {
    store,
    setStore,
    addServer: store.addServer,
    editServer: store.editServer,
    resetAdd,
    resetEdit,
    resetForm,
    startAdd,
    startEdit,
    handleAddChange,
    handleAddNameChange,
    handleAddUsernameChange,
    handleAddPasswordChange,
    handleEditChange,
    handleEditNameChange,
    handleEditUsernameChange,
    handleEditPasswordChange,
    mode,
    isFormMode,
    isAddMode,
    formTitle,
  }
}

function useServerMutations(input: {
  language: ReturnType<typeof useLanguage>
  checkServerHealth: ReturnType<typeof useCheckServerHealth>
  server: ReturnType<typeof useServer>
  platform: ReturnType<typeof usePlatform>
  select: (conn: ServerConnection.Any, persist?: boolean) => Promise<void>
  form: ReturnType<typeof useServerFormState>
}) {
  const addMutation = useMutation(() => ({
    mutationFn: async (value: string) => {
      const normalized = normalizeServerUrl(value)
      if (!normalized) {
        input.form.resetAdd()
        return
      }

      const conn: ServerConnection.Http = {
        type: "http",
        http: { url: normalized },
      }
      if (input.form.store.addServer.name.trim()) conn.displayName = input.form.store.addServer.name.trim()
      if (input.form.store.addServer.password) conn.http.password = input.form.store.addServer.password
      if (input.form.store.addServer.password && input.form.store.addServer.username) conn.http.username = input.form.store.addServer.username
      const result = await input.checkServerHealth(conn.http)
      if (!result.healthy) {
        input.form.setStore("addServer", { error: input.language.t("dialog.server.add.error") })
        return
      }

      input.form.resetAdd()
      await input.select(conn, true)
    },
  }))

  const editMutation = useMutation(() => ({
    mutationFn: async (inputData: { original: ServerConnection.Any; value: string }) => {
      if (inputData.original.type !== "http") return
      const normalized = normalizeServerUrl(inputData.value)
      if (!normalized) {
        input.form.resetEdit()
        return
      }

      const name = input.form.store.editServer.name.trim() || undefined
      const username = input.form.store.editServer.username || undefined
      const password = input.form.store.editServer.password || undefined
      const existingName = inputData.original.displayName
      if (
        normalized === inputData.original.http.url &&
        name === existingName &&
        username === inputData.original.http.username &&
        password === inputData.original.http.password
      ) {
        input.form.resetEdit()
        return
      }

      const conn: ServerConnection.Http = {
        type: "http",
        displayName: name,
        http: { url: normalized, username, password },
      }
      const result = await input.checkServerHealth(conn.http)
      if (!result.healthy) {
        input.form.setStore("editServer", { error: input.language.t("dialog.server.add.error") })
        return
      }
      if (normalized === inputData.original.http.url) {
        input.server.add(conn)
      } else {
        replaceServer(inputData.original, conn)
      }

      input.form.resetEdit()
    },
  }))

  const replaceServer = (original: ServerConnection.Http, next: ServerConnection.Http) => {
    const active = input.server.key
    const newConn = input.server.add(next)
    if (!newConn) return
    const nextActive = active === ServerConnection.key(original) ? ServerConnection.key(newConn) : active
    if (nextActive) input.server.setActive(nextActive)
    input.server.remove(ServerConnection.key(original))
  }

  const handleRemove = async (url: ServerConnection.Key) => {
    input.server.remove(url)
    if ((await input.platform.getDefaultServer?.()) === url) {
      void input.platform.setDefaultServer?.(null)
    }
  }

  const submitForm = () => {
    if (input.form.mode() === "add") {
      if (addMutation.isPending) return
      input.form.setStore("addServer", { error: "" })
      addMutation.mutate(input.form.store.addServer.url)
      return
    }
    const original = editing()
    if (!original) return
    if (editMutation.isPending) return
    input.form.setStore("editServer", { error: "" })
    editMutation.mutate({ original, value: input.form.store.editServer.value })
  }

  function editing() {
    if (!input.form.store.editServer.id) return
    return input.server.list.find((x) => x.type === "http" && x.http.url === input.form.store.editServer.id)
  }

  const formBusy = createMemo(() => (input.form.isAddMode() ? addMutation.isPending : editMutation.isPending))

  return {
    addMutation,
    editMutation,
    replaceServer,
    handleRemove,
    submitForm,
    editing,
    formBusy,
  }
}

function ServerForm(props: ServerFormProps) {
  const language = useLanguage()
  const keyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      props.onBack()
      return
    }
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    props.onSubmit()
  }

  return (
    <div class="px-5">
      <div class="bg-surface-base rounded-md p-5 flex flex-col gap-3">
        <div class="flex-1 min-w-0 [&_[data-slot=input-wrapper]]:relative">
          <TextField
            type="text"
            label={language.t("dialog.server.add.url")}
            placeholder={props.placeholder}
            value={props.value}
            autofocus
            validationState={props.error ? "invalid" : "valid"}
            error={props.error}
            disabled={props.busy}
            onChange={props.onChange}
            onKeyDown={keyDown}
          />
        </div>
        <TextField
          type="text"
          label={language.t("dialog.server.add.name")}
          placeholder={language.t("dialog.server.add.namePlaceholder")}
          value={props.name}
          disabled={props.busy}
          onChange={props.onNameChange}
          onKeyDown={keyDown}
        />
        <div class="grid grid-cols-2 gap-2 min-w-0">
          <TextField
            type="text"
            label={language.t("dialog.server.add.username")}
            placeholder={language.t("dialog.server.add.usernamePlaceholder")}
            value={props.username}
            disabled={props.busy}
            onChange={props.onUsernameChange}
            onKeyDown={keyDown}
          />
          <TextField
            type="password"
            label={language.t("dialog.server.add.password")}
            placeholder={language.t("dialog.server.add.passwordPlaceholder")}
            value={props.password}
            disabled={props.busy}
            onChange={props.onPasswordChange}
            onKeyDown={keyDown}
          />
        </div>
      </div>
    </div>
  )
}

export function DialogSelectServer() {
  const navigate = useNavigate()
  const dialog = useDialog()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()

  const { defaultKey, canDefault, setDefault } = useDefaultServer()
  const { previewStatus } = useServerPreview()
  const checkServerHealth = useCheckServerHealth()

  const form = useServerFormState({ language, previewStatus })

  const [statusStore, setStatusStore] = createStore({
    status: {} as Record<ServerConnection.Key, ServerHealth | undefined>,
  })

  const mutations = useServerMutations({
    language,
    checkServerHealth,
    server,
    platform,
    select: async (conn: ServerConnection.Any, persist?: boolean) => {
      if (!persist && statusStore.status[ServerConnection.key(conn)]?.healthy === false) return
      dialog.close()
      if (persist && conn.type === "http") {
        server.add(conn)
        navigate("/")
        return
      }
      navigate("/")
      queueMicrotask(() => server.setActive(ServerConnection.key(conn)))
    },
    form,
  })

  const items = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    if (!list.includes(current)) return [current, ...list]
    return [current, ...list.filter((x) => x !== current)]
  })

  const current = createMemo(() => items().find((x) => ServerConnection.key(x) === server.key) ?? items()[0])

  const sortedItems = createMemo(() => {
    const list = items()
    if (!list.length) return list
    const active = current()
    const order = new Map(list.map((url, index) => [url, index] as const))
    const rank = (value?: ServerHealth) => {
      if (value?.healthy === true) return 0
      if (value?.healthy === false) return 2
      return 1
    }
    return list.slice().sort((a, b) => {
      if (a === active) return -1
      if (b === active) return 1
      const diff = rank(statusStore.status[ServerConnection.key(a)]) - rank(statusStore.status[ServerConnection.key(b)])
      if (diff !== 0) return diff
      return (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
  })

  async function refreshHealth() {
    const results: Record<ServerConnection.Key, ServerHealth> = {}
    await Promise.all(
      items().map(async (conn) => {
        results[ServerConnection.key(conn)] = await checkServerHealth(conn.http)
      }),
    )
    setStatusStore("status", reconcile(results))
  }

  createEffect(() => {
    items()
    void refreshHealth()
    const interval = setInterval(refreshHealth, 10_000)
    onCleanup(() => clearInterval(interval))
  })

  async function select(conn: ServerConnection.Any, persist?: boolean) {
    if (!persist && statusStore.status[ServerConnection.key(conn)]?.healthy === false) return
    dialog.close()
    if (persist && conn.type === "http") {
      server.add(conn)
      navigate("/")
      return
    }
    navigate("/")
    queueMicrotask(() => server.setActive(ServerConnection.key(conn)))
  }

  const startEdit = (conn: ServerConnection.Http) => {
    form.startEdit(conn, statusStore.status[ServerConnection.key(conn)]?.healthy)
  }

  const editing = createMemo(() => {
    if (!form.editServer.id) return
    return items().find((x) => x.type === "http" && x.http.url === form.editServer.id)
  })

  createEffect(() => {
    if (!form.editServer.id) return
    if (editing()) return
    form.resetEdit()
  })

  return (
    <Dialog title={form.formTitle()}>
      <div class="flex flex-1 min-h-0 flex-col gap-2">
        <Show
          when={!form.isFormMode()}
          fallback={
            <ServerForm
              value={form.isAddMode() ? form.addServer.url : form.editServer.value}
              name={form.isAddMode() ? form.addServer.name : form.editServer.name}
              username={form.isAddMode() ? form.addServer.username : form.editServer.username}
              password={form.isAddMode() ? form.addServer.password : form.editServer.password}
              placeholder={language.t("dialog.server.add.placeholder")}
              busy={mutations.formBusy()}
              error={form.isAddMode() ? form.addServer.error : form.editServer.error}
              status={form.isAddMode() ? form.addServer.status : form.editServer.status}
              onChange={form.isAddMode() ? form.handleAddChange : form.handleEditChange}
              onNameChange={form.isAddMode() ? form.handleAddNameChange : form.handleEditNameChange}
              onUsernameChange={form.isAddMode() ? form.handleAddUsernameChange : form.handleEditUsernameChange}
              onPasswordChange={form.isAddMode() ? form.handleAddPasswordChange : form.handleEditPasswordChange}
              onSubmit={mutations.submitForm}
              onBack={form.resetForm}
            />
          }
        >
          <List
            search={{
              placeholder: language.t("dialog.server.search.placeholder"),
              autofocus: false,
            }}
            noInitialSelection
            emptyMessage={language.t("dialog.server.empty")}
            items={sortedItems}
            key={(x) => x.http.url}
            onSelect={(x) => {
              if (x) void select(x)
            }}
            divider={true}
            class="flex-1 min-h-0 px-5 [&_[data-slot=list-search-wrapper]]:w-full [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:overflow-y-auto [&_[data-slot=list-items]]:bg-surface-base [&_[data-slot=list-items]]:rounded-md [&_[data-slot=list-item]]:min-h-14 [&_[data-slot=list-item]]:p-3 [&_[data-slot=list-item]]:!bg-transparent"
          >
            {(i) => {
              const key = ServerConnection.key(i)
              return (
                <div class="flex items-center gap-3 min-w-0 flex-1 w-full group/item">
                  <div class="flex flex-col h-full items-start w-5">
                    <ServerHealthIndicator health={statusStore.status[key]} />
                  </div>
                  <ServerRow
                    conn={i}
                    dimmed={statusStore.status[key]?.healthy === false}
                    status={statusStore.status[key]}
                    class="flex items-center gap-3 min-w-0 flex-1"
                    badge={
                      <Show when={defaultKey() === ServerConnection.key(i)}>
                        <span class="text-text-base bg-surface-base text-14-regular px-1.5 rounded-xs">
                          {language.t("dialog.server.status.default")}
                        </span>
                      </Show>
                    }
                    showCredentials
                  />
                  <div class="flex items-center justify-center gap-4 pl-4">
                    <Show when={ServerConnection.key(current()) === key}>
                      <Icon name="check" class="h-6" />
                    </Show>

                    <Show when={i.type === "http"}>
                      <DropdownMenu>
                        <DropdownMenu.Trigger
                          as={IconButton}
                          icon="dot-grid"
                          variant="ghost"
                          class="shrink-0 size-8 hover:bg-surface-base-hover data-[expanded]:bg-surface-base-active"
                          onClick={(e: MouseEvent) => e.stopPropagation()}
                          onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                        />
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content class="mt-1">
                            <DropdownMenu.Item
                              onSelect={() => {
                                if (i.type !== "http") return
                                startEdit(i)
                              }}
                            >
                              <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.edit")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <Show when={canDefault() && defaultKey() !== key}>
                              <DropdownMenu.Item onSelect={() => setDefault(key)}>
                                <DropdownMenu.ItemLabel>
                                  {language.t("dialog.server.menu.default")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </Show>
                            <Show when={canDefault() && defaultKey() === key}>
                              <DropdownMenu.Item onSelect={() => setDefault(null)}>
                                <DropdownMenu.ItemLabel>
                                  {language.t("dialog.server.menu.defaultRemove")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </Show>
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item
                              onSelect={() => mutations.handleRemove(ServerConnection.key(i))}
                              class="text-text-on-critical-base hover:bg-surface-critical-weak"
                            >
                              <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.delete")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    </Show>
                  </div>
                </div>
              )
            }}
          </List>
        </Show>

        <div class="shrink-0 px-5 pb-5">
          <Show
            when={form.isFormMode()}
            fallback={
              <Button
                variant="secondary"
                icon="plus-small"
                size="large"
                onClick={form.startAdd}
                class="py-1.5 pl-1.5 pr-3 flex items-center gap-1.5"
              >
                {language.t("dialog.server.add.button")}
              </Button>
            }
          >
            <Button variant="primary" size="large" onClick={mutations.submitForm} disabled={mutations.formBusy()} class="px-3 py-1.5">
              {mutations.formBusy() ? (
                <div class="flex items-center gap-2">
                  <Spinner class="size-4" />
                  <span>{language.t("dialog.server.add.checking")}</span>
                </div>
              ) : form.isAddMode() ? (
                language.t("dialog.server.add.button")
              ) : (
                language.t("common.save")
              )}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
