import { Match, Show, Switch } from "solid-js"
import type { Accessor } from "solid-js"
import type { SessionStatus } from "@opencode-ai/sdk/v2"
import { useTheme } from "@tui/context/theme"
import type { EditorLabelState } from "@tui/context/editor"
import type { PromptMode } from "./prompt.shared"

export type PromptUsage = { context: string; cost?: string }

/**
 * Right-hand hint cluster under the prompt: editor file label, context/cost
 * meter, and the agent/palette shortcut legends.
 */
export function PromptHints(props: {
  status: Accessor<SessionStatus>
  mode: PromptMode
  editorLabelState: EditorLabelState
  editorFileLabel: string | undefined
  usage: PromptUsage | undefined
  agentShortcut: string
  paletteShortcut: string
}) {
  const { theme } = useTheme()
  return (
    <Show when={props.status().type !== "retry"}>
      <box gap={2} flexDirection="row">
        <Show when={props.editorLabelState !== "none" ? props.editorFileLabel : undefined}>
          {(file) => (
            <text fg={props.editorLabelState === "pending" ? theme.secondary : theme.textMuted}>{file()}</text>
          )}
        </Show>
        <Switch>
          <Match when={props.mode === "normal"}>
            <Switch>
              <Match when={props.usage}>
                {(item) => (
                  <text fg={theme.textMuted} wrapMode="none">
                    {[item().context, item().cost].filter(Boolean).join(" · ")}
                  </text>
                )}
              </Match>
              <Match when={true}>
                <text fg={theme.text}>
                  {props.agentShortcut} <span style={{ fg: theme.textMuted }}>agents</span>
                </text>
              </Match>
            </Switch>
            <text fg={theme.text}>
              {props.paletteShortcut} <span style={{ fg: theme.textMuted }}>commands</span>
            </text>
          </Match>
          <Match when={props.mode === "shell"}>
            <text fg={theme.text}>
              esc <span style={{ fg: theme.textMuted }}>exit shell mode</span>
            </text>
          </Match>
        </Switch>
      </box>
    </Show>
  )
}
