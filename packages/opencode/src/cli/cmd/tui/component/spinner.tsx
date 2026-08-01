import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import type { JSX } from "@opentui/solid"
import { RGBA, type ColorInput } from "@opentui/core"
import type { ColorGenerator } from "opentui-spinner"
import "opentui-spinner/solid"
import { getSpinnerConfig, SPINNER_FRAMES, type SpinnerVariant } from "../ui/spinner-config"
import type { KnightRiderOptions } from "../ui/spinner"

export { SPINNER_FRAMES }

export interface SpinnerProps extends Omit<KnightRiderOptions, "color"> {
  children?: JSX.Element
  color?: ColorInput | ColorGenerator
  variant?: SpinnerVariant
  frames?: string[]
  interval?: number
}

export function Spinner(props: SpinnerProps) {
  const { theme } = useTheme()
  const kv = useKV()

  const textColor = () => {
    if (typeof props.color === "string" || props.color instanceof RGBA) {
      return props.color
    }
    return theme.textMuted
  }

  const config = createMemo(() => {
    const variant = props.variant ?? "dots"
    const fallbackColor = textColor()
    const options: KnightRiderOptions = {
      color: fallbackColor,
      style: props.style,
      inactiveFactor: props.inactiveFactor,
      minAlpha: props.minAlpha,
      width: props.width,
      holdStart: props.holdStart,
      holdEnd: props.holdEnd,
      colors: props.colors,
      defaultColor: props.defaultColor,
      enableFading: props.enableFading,
    }

    const cfg = getSpinnerConfig(variant, options)
    return {
      frames: props.frames ?? cfg.frames,
      color:
        typeof props.color === "function"
          ? props.color
          : props.variant && props.variant !== "dots"
            ? cfg.color
            : (props.color ?? theme.textMuted),
      interval: props.interval ?? cfg.interval,
    }
  })

  return (
    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={textColor()}>⋯ {props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={config().frames} interval={config().interval} color={config().color} />
        <Show when={props.children}>
          <text fg={textColor()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  )
}
