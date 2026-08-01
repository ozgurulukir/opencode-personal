import { describe, expect, test } from "bun:test"
import { createColors, createFrames, deriveInactiveColor, deriveTrailColors } from "../../../src/cli/cmd/tui/ui/spinner"
import { RGBA } from "@opentui/core"

describe("tui spinner ui utilities", () => {
  test("createFrames generates block frames correctly", () => {
    const frames = createFrames({ style: "blocks", width: 4, holdStart: 2, holdEnd: 2 })
    expect(frames.length).toBe(4 + 2 + 3 + 2) // width + holdEnd + (width - 1) + holdStart = 11
    expect(frames[0]).toContain("■")
    expect(frames[0]).toContain("⬝")
  })

  test("createFrames generates diamond frames correctly", () => {
    const frames = createFrames({ style: "diamonds", width: 4, holdStart: 1, holdEnd: 1 })
    expect(frames.length).toBe(4 + 1 + 3 + 1)
    expect(frames[0]).toMatch(/[⬥|◆|⬩|⬪|·]/)
  })

  test("createColors returns a valid ColorGenerator", () => {
    const colorGen = createColors({ color: "#ff0000", style: "blocks" })
    expect(typeof colorGen).toBe("function")

    const color0 = colorGen(0, 0, 10, 8)
    expect(color0).toBeDefined()
  })

  test("deriveTrailColors generates expected number of gradient steps", () => {
    const colors = deriveTrailColors("#00ff00", 4)
    expect(colors.length).toBe(4)
    expect(colors[0]).toBeInstanceOf(RGBA)
  })

  test("deriveInactiveColor dims color alpha", () => {
    const inactive = deriveInactiveColor("#ffffff", 0.3)
    expect(inactive).toBeInstanceOf(RGBA)
    expect(inactive.a).toBeCloseTo(0.3)
  })
})

describe("tui spinner-config factories", () => {
  const { createDotsSpinner, createKnightRiderSpinner, createBlocksSpinner, getSpinnerConfig, SPINNER_FRAMES } = require("../../../src/cli/cmd/tui/ui/spinner-config")

  test("createDotsSpinner returns dots frames and interval 80", () => {
    const config = createDotsSpinner("#ffffff")
    expect(config.frames).toBe(SPINNER_FRAMES)
    expect(config.interval).toBe(80)
    expect(config.color).toBe("#ffffff")
  })

  test("createKnightRiderSpinner returns diamond frames and interval 40", () => {
    const config = createKnightRiderSpinner({ color: "#ff0000" })
    expect(config.interval).toBe(40)
    expect(typeof config.color).toBe("function")
    expect(config.frames[0]).toMatch(/[⬥|◆|⬩|⬪|·]/)
  })

  test("createBlocksSpinner returns block frames and interval 40", () => {
    const config = createBlocksSpinner({ color: "#0000ff" })
    expect(config.interval).toBe(40)
    expect(typeof config.color).toBe("function")
    expect(config.frames[0]).toContain("■")
  })

  test("getSpinnerConfig dispatches variants correctly", () => {
    const dots = getSpinnerConfig("dots")
    expect(dots.interval).toBe(80)

    const blocks = getSpinnerConfig("blocks")
    expect(blocks.interval).toBe(40)

    const knight = getSpinnerConfig("knight-rider")
    expect(knight.interval).toBe(40)
  })
})
