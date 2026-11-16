import { createMemo, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import { useTheme } from "../../context/theme"
import { useSync } from "../../context/sync"
import { useDirectory } from "../../context/directory"
import { useConnected } from "../../component/use-connected"
import { createStore } from "solid-js/store"
import { useRoute } from "../../context/route"

export function Footer() {
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()

  // ⚡ Bolt Optimization: Replace Object.values().filter().length with a single loop to reduce GC pressure
  const mcpStats = createMemo(() => {
    let connected = 0
    let hasError = false
    const mcpData = sync.data.mcp
    for (const key in mcpData) {
      if (Object.prototype.hasOwnProperty.call(mcpData, key)) {
        const item = mcpData[key]
        if (item.status === "connected") connected++
        else if (item.status === "failed") hasError = true
      }
    }
    return { connected, hasError }
  })

  const mcp = () => mcpStats().connected
  const mcpError = () => mcpStats().hasError

  const lsp = createMemo(() => Object.keys(sync.data.lsp))
  const permissions = createMemo(() => {
    if (route.data.type !== "session") return []
    return sync.data.permission[route.data.sessionID] ?? []
  })
  const directory = useDirectory()
  const connected = useConnected()

  const [store, setStore] = createStore({
    welcome: false,
  })

  onMount(() => {
    // Single pending timer: the tick chain previously pushed every fired
    // handle into the array without removal (unbounded growth while
    // disconnected).
    let pending: ReturnType<typeof setTimeout> | undefined

    function tick() {
      pending = undefined
      // Connecting during the 5s welcome window must clear the hint — the
      // welcome <Match> precedes the connected <Match>, so a stale hint
      // otherwise stays on screen forever.
      if (connected()) {
        if (store.welcome) setStore("welcome", false)
        return
      }
      if (!store.welcome) {
        setStore("welcome", true)
        pending = setTimeout(() => tick(), 5000)
        return
      }

      setStore("welcome", false)
      pending = setTimeout(() => tick(), 10_000)
    }
    pending = setTimeout(() => tick(), 10_000)

    onCleanup(() => {
      if (pending) clearTimeout(pending)
    })
  })

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{directory()}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <Switch>
          <Match when={store.welcome && !connected()}>
            <text fg={theme.text}>
              Get started <span style={{ fg: theme.textMuted }}>/connect</span>
            </text>
          </Match>
          <Match when={connected()}>
            <Show when={permissions().length > 0}>
              <text fg={theme.warning}>
                <span style={{ fg: theme.warning }}>△</span> {permissions().length} Permission
                {permissions().length > 1 ? "s" : ""}
              </text>
            </Show>
            <text fg={theme.text}>
              <span style={{ fg: lsp().length > 0 ? theme.success : theme.textMuted }}>•</span> {lsp().length} LSP
            </text>
            <Show when={mcp()}>
              <text fg={theme.text}>
                <Switch>
                  <Match when={mcpError()}>
                    <span style={{ fg: theme.error }}>⊙ </span>
                  </Match>
                  <Match when={true}>
                    <span style={{ fg: theme.success }}>⊙ </span>
                  </Match>
                </Switch>
                {mcp()} MCP
              </text>
            </Show>
            <text fg={theme.textMuted}>/status</text>
          </Match>
        </Switch>
      </box>
    </box>
  )
}
