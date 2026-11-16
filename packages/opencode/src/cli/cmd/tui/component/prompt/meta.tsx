import { RGBA } from "@opentui/core"
import { Show } from "solid-js"
import type { JSX } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { Locale } from "@/util/locale"
import type { PromptMode } from "./prompt.shared"

export function fadeColor(color: RGBA, alpha: number) {
  return RGBA.fromValues(color.r, color.g, color.b, color.a * alpha)
}

/**
 * Agent / model / variant row rendered under the prompt input.
 *
 * Alphas are pre-computed by the caller (`createFadeIn`) so this stays a
 * presentation component — no animation state lives here.
 */
export function PromptMeta(props: {
  mode: PromptMode
  agentName: string | undefined
  leader: boolean
  model: string
  provider: string
  showVariant: boolean
  variant: string | undefined
  agentAlpha: number
  modelAlpha: number
  variantAlpha: number
  highlight: RGBA
  right?: JSX.Element
}) {
  const { theme } = useTheme()
  return (
    <box flexDirection="row" flexShrink={0} paddingTop={1} gap={1} justifyContent="space-between">
      <box flexDirection="row" gap={1}>
        <Show when={props.agentName} fallback={<box height={1} />}>
          {(agent) => (
            <>
              <text fg={fadeColor(props.highlight, props.agentAlpha)}>
                {props.mode === "shell" ? "Shell" : Locale.titlecase(agent())}
              </text>
              <Show when={props.mode === "normal"}>
                <box flexDirection="row" gap={1}>
                  <text fg={fadeColor(theme.textMuted, props.modelAlpha)}>·</text>
                  <text flexShrink={0} fg={fadeColor(props.leader ? theme.textMuted : theme.text, props.modelAlpha)}>
                    {props.model}
                  </text>
                  <text fg={fadeColor(theme.textMuted, props.modelAlpha)}>{props.provider}</text>
                  <Show when={props.showVariant}>
                    <text fg={fadeColor(theme.textMuted, props.variantAlpha)}>·</text>
                    <text>
                      <span style={{ fg: fadeColor(theme.warning, props.variantAlpha), bold: true }}>
                        {props.variant}
                      </span>
                    </text>
                  </Show>
                </box>
              </Show>
            </>
          )}
        </Show>
      </box>
      <Show when={props.right}>
        <box flexDirection="row" gap={1} alignItems="center">
          {props.right}
        </box>
      </Show>
    </box>
  )
}
