import type { ColorInput } from "@opentui/core"
import type { ColorGenerator } from "opentui-spinner"
import { createColors, createFrames, type KnightRiderOptions, type KnightRiderStyle } from "./spinner"

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export type SpinnerVariant = "dots" | "knight-rider" | "blocks"

export interface SpinnerConfig {
  frames: string[]
  color: ColorInput | ColorGenerator
  interval: number
}

export function createDotsSpinner(color?: ColorInput): SpinnerConfig {
  return {
    frames: SPINNER_FRAMES,
    color: color ?? "transparent",
    interval: 80,
  }
}

export function createKnightRiderSpinner(options: KnightRiderOptions = {}): SpinnerConfig {
  const style: KnightRiderStyle = options.style ?? "diamonds"
  return {
    frames: createFrames({ ...options, style }),
    color: createColors({ ...options, style }),
    interval: 40,
  }
}

export function createBlocksSpinner(options: KnightRiderOptions = {}): SpinnerConfig {
  const inactiveFactor = options.inactiveFactor ?? 0.6
  const minAlpha = options.minAlpha ?? 0.3
  return createKnightRiderSpinner({
    inactiveFactor,
    minAlpha,
    ...options,
    style: "blocks",
  })
}

export function getSpinnerConfig(
  variant: SpinnerVariant = "dots",
  options: KnightRiderOptions = {},
): SpinnerConfig {
  switch (variant) {
    case "knight-rider":
      return createKnightRiderSpinner(options)
    case "blocks":
      return createBlocksSpinner(options)
    case "dots":
    default:
      return createDotsSpinner(options.color)
  }
}
