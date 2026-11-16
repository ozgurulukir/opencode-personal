import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from "solid-js"
import type { Accessor } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { Spinner } from "@tui/component/spinner"
import { useTheme } from "@tui/context/theme"
import { formatDuration } from "@/util/format"
import { useDialog } from "@tui/ui/dialog"
import { DialogAlert } from "../../ui/dialog-alert"
import type { WorkspaceStatus } from "../workspace-label"
import type { JSX } from "@opentui/solid"

export type WorkspaceLabel =
  | { type: "new"; workspaceType: string }
  | { type: "existing"; workspaceType: string; workspaceName: string; status?: WorkspaceStatus }
  | undefined

/**
 * Status row beneath the prompt input: active-run spinner + retry detail,
 * interrupt hint, transient warp notice, workspace label, or the caller hint.
 */
export function PromptStatusRow(props: {
  status: Accessor<SessionStatus>
  interrupt: number
  warpNotice: string | undefined
  workspaceLabel: Accessor<WorkspaceLabel>
  workspaceCreating: boolean
  workspaceCreatingDots: number
  spinnerColor: RGBA
  hint?: JSX.Element
}) {
  const { theme } = useTheme()
  return (
    <Switch>
      <Match when={props.status().type !== "idle"}>
        <box
          flexDirection="row"
          gap={1}
          flexGrow={1}
          justifyContent={props.status().type === "retry" ? "space-between" : "flex-start"}
        >
          <box flexShrink={0} flexDirection="row" gap={1}>
            <box marginLeft={1}>
              <Spinner variant="blocks" color={props.spinnerColor} />
            </box>
            <box flexDirection="row" gap={1} flexShrink={0}>
              <RetryStatus status={props.status} />
            </box>
          </box>
          <text fg={props.interrupt > 0 ? theme.primary : theme.text}>
            esc{" "}
            <span style={{ fg: props.interrupt > 0 ? theme.primary : theme.textMuted }}>
              {props.interrupt > 0 ? "again to interrupt" : "interrupt"}
            </span>
          </text>
        </box>
      </Match>
      <Match when={props.warpNotice}>
        {(notice) => (
          <box paddingLeft={3}>
            <text fg={theme.accent}>{notice()}</text>
          </box>
        )}
      </Match>
      <Match when={props.workspaceLabel()}>
        {(workspace) => (
          <box paddingLeft={3} flexDirection="row" gap={1}>
            <Show when={props.workspaceCreating}>
              <Spinner color={theme.accent} />
            </Show>
            <text fg={props.workspaceCreating ? theme.accent : theme.text}>
              {(() => {
                const item = workspace()
                if (item.type === "new") {
                  if (props.workspaceCreating)
                    return `Creating ${item.workspaceType}${".".repeat(props.workspaceCreatingDots)}`
                  return (
                    <>
                      Workspace <span style={{ fg: theme.textMuted }}>(new {item.workspaceType})</span>
                    </>
                  )
                }
                return (
                  <>
                    Workspace <span style={{ fg: theme.textMuted }}>{item.workspaceName}</span>
                  </>
                )
              })()}
            </text>
          </box>
        )}
      </Match>
      <Match when={true}>{props.hint ?? <text />}</Match>
    </Switch>
  )
}

function RetryStatus(props: { status: Accessor<SessionStatus> }) {
  const { theme } = useTheme()
  const dialog = useDialog()
  const retry = createMemo(() => {
    const s = props.status()
    if (s.type !== "retry") return
    return s
  })
  const message = createMemo(() => {
    const r = retry()
    if (!r) return
    if (r.message.includes("exceeded your current quota") && r.message.includes("gemini"))
      return "gemini is way too hot right now"
    if (r.message.length > 80) return r.message.slice(0, 80) + "..."
    return r.message
  })
  const isTruncated = createMemo(() => {
    const r = retry()
    if (!r) return false
    return r.message.length > 120
  })
  const [seconds, setSeconds] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => {
      const next = retry()?.next
      if (next) setSeconds(Math.round((next - Date.now()) / 1000))
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })
  const handleMessageClick = () => {
    const r = retry()
    if (!r) return
    if (isTruncated()) void DialogAlert.show(dialog, "Retry Error", r.message)
  }
  const retryText = () => {
    const r = retry()
    if (!r) return ""
    const baseMessage = message()
    const truncatedHint = isTruncated() ? " (click to expand)" : ""
    const duration = formatDuration(seconds())
    const retryInfo = ` [retrying ${duration ? `in ${duration} ` : ""}attempt #${r.attempt}]`
    return baseMessage + truncatedHint + retryInfo
  }

  return (
    <Show when={retry()}>
      <box onMouseUp={handleMessageClick}>
        <text fg={theme.error}>{retryText()}</text>
      </box>
    </Show>
  )
}
