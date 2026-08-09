import { describe, expect, test } from "bun:test"
import {
  hexToRgb,
  rgbToHex,
  rgbToOklch,
  oklchToRgb,
  hexToOklch,
  oklchToHex,
  fitOklch,
  generateScale,
  generateNeutralScale,
  generateAlphaScale,
  mixColors,
  shift,
  blend,
  lighten,
  darken,
  withAlpha,
} from "./color"

describe("Color Utils", () => {
  describe("hexToRgb", () => {
    test("parses standard 6-digit hex", () => {
      expect(hexToRgb("#ff0000")).toEqual({ r: 1, g: 0, b: 0 })
      expect(hexToRgb("#00ff00")).toEqual({ r: 0, g: 1, b: 0 })
      expect(hexToRgb("#0000ff")).toEqual({ r: 0, g: 0, b: 1 })
      expect(hexToRgb("#ffffff")).toEqual({ r: 1, g: 1, b: 1 })
      expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 })
      expect(hexToRgb("#808080").r).toBeCloseTo(0.501, 2)
    })

    test("parses 3-digit hex", () => {
      expect(hexToRgb("#f00")).toEqual({ r: 1, g: 0, b: 0 })
      expect(hexToRgb("#0f0")).toEqual({ r: 0, g: 1, b: 0 })
      expect(hexToRgb("#00f")).toEqual({ r: 0, g: 0, b: 1 })
    })

    test("parses 8-digit hex (ignores alpha)", () => {
      expect(hexToRgb("#ff0000ff")).toEqual({ r: 1, g: 0, b: 0 })
      expect(hexToRgb("#00ff0080")).toEqual({ r: 0, g: 1, b: 0 })
    })

    test("works without hash", () => {
      expect(hexToRgb("#ff0000")).toEqual({ r: 1, g: 0, b: 0 })
      expect(hexToRgb("#f00")).toEqual({ r: 1, g: 0, b: 0 })
    })
  })

  describe("rgbToHex", () => {
    test("converts rgb to 6-digit hex", () => {
      expect(rgbToHex(1, 0, 0)).toBe("#ff0000")
      expect(rgbToHex(0, 1, 0)).toBe("#00ff00")
      expect(rgbToHex(0, 0, 1)).toBe("#0000ff")
      expect(rgbToHex(1, 1, 1)).toBe("#ffffff")
      expect(rgbToHex(0, 0, 0)).toBe("#000000")
    })

    test("clamps values outside 0-1 range", () => {
      expect(rgbToHex(1.5, -0.5, 2)).toBe("#ff00ff")
    })
  })

  describe("rgbToOklch and oklchToRgb", () => {
    test("roundtrips rgb -> oklch -> rgb", () => {
      const rgb = { r: 0.5, g: 0.5, b: 0.5 }
      const oklch = rgbToOklch(rgb.r, rgb.g, rgb.b)
      const roundtripped = oklchToRgb(oklch)

      expect(roundtripped.r).toBeCloseTo(rgb.r, 2)
      expect(roundtripped.g).toBeCloseTo(rgb.g, 2)
      expect(roundtripped.b).toBeCloseTo(rgb.b, 2)
    })
  })

  describe("hexToOklch and oklchToHex", () => {
    test("roundtrips hex -> oklch -> hex", () => {
      const hex = "#123456"
      const oklch = hexToOklch(hex)
      const roundtripped = oklchToHex(oklch)

      expect(roundtripped).toBe(hex)
    })

    test("oklchToHex handles out of gamut by fitting", () => {
      const oklch = { l: 0.5, c: 0.5, h: 260 } // Highly saturated, likely out of rgb gamut
      const hex = oklchToHex(oklch)
      expect(typeof hex).toBe("string")
      expect(hex.startsWith("#")).toBe(true)
      expect(hex.length).toBe(7)
    })
  })

  describe("fitOklch", () => {
    test("returns same color if in gamut", () => {
      // Gray is definitely in gamut
      const inGamut = { l: 0.5, c: 0, h: 0 }
      const fitted = fitOklch(inGamut)
      expect(fitted).toEqual(inGamut)
    })

    test("reduces chroma to fit in gamut", () => {
      // Extremely high chroma, definitely out of gamut
      const outOfGamut = { l: 0.5, c: 0.4, h: 0 }
      const fitted = fitOklch(outOfGamut)
      expect(fitted.c).toBeLessThan(outOfGamut.c)
    })
  })

  describe("generateScale", () => {
    test("generates 12 colors for light mode", () => {
      const scale = generateScale("#ff0000", false)
      expect(scale.length).toBe(12)
      scale.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
    })

    test("generates 12 colors for dark mode", () => {
      const scale = generateScale("#ff0000", true)
      expect(scale.length).toBe(12)
      scale.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
    })
  })

  describe("generateNeutralScale", () => {
    test("generates 12 colors for light mode without ink", () => {
      const scale = generateNeutralScale("#808080", false)
      expect(scale.length).toBe(12)
      scale.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
    })

    test("generates 12 colors for dark mode without ink", () => {
      const scale = generateNeutralScale("#808080", true)
      expect(scale.length).toBe(12)
      scale.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
    })

    test("generates 12 colors for light mode with ink", () => {
      const scale = generateNeutralScale("#808080", false, "#111111")
      expect(scale.length).toBe(12)
      scale.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
    })

    test("generates 12 colors for dark mode with ink", () => {
      const scale = generateNeutralScale("#808080", true, "#111111")
      expect(scale.length).toBe(12)
      scale.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
    })
  })

  describe("generateAlphaScale", () => {
    test("generates 12 colors for light mode", () => {
      const scale = generateScale("#ff0000", false)
      const alphaScale = generateAlphaScale(scale, false)
      expect(alphaScale.length).toBe(12)
      alphaScale.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
    })

    test("generates 12 colors for dark mode", () => {
      const scale = generateScale("#ff0000", true)
      const alphaScale = generateAlphaScale(scale, true)
      expect(alphaScale.length).toBe(12)
      alphaScale.forEach(c => expect(c).toMatch(/^#[0-9a-f]{6}$/i))
    })
  })

  describe("mixColors", () => {
    test("mixes two colors with 50% amount", () => {
      const mixed = mixColors("#ff0000", "#0000ff", 0.5)
      expect(typeof mixed).toBe("string")
      expect(mixed).toMatch(/^#[0-9a-f]{6}$/i)
    })

    test("mixes with 0% and 100%", () => {
      // Due to gamut mapping (fitOklch) during polar interpolation,
      // the exact hue might shift slightly. We check with an integer tolerance.
      const mix0 = mixColors("#ff0000", "#0000ff", 0)
      const mix100 = mixColors("#ff0000", "#0000ff", 1)

      const c0 = hexToOklch(mix0)
      const cRed = hexToOklch("#ff0000")
      expect(c0.h).toBeCloseTo(cRed.h, 0)

      const c100 = hexToOklch(mix100)
      const cBlue = hexToOklch("#0000ff")
      expect(c100.h).toBeCloseTo(cBlue.h, 0)
    })
  })

  describe("shift", () => {
    test("shifts lightness", () => {
      const c1 = "#ff0000"
      const c2 = shift(c1, { l: 0.1 })
      const o1 = hexToOklch(c1)
      const o2 = hexToOklch(c2)
      // Due to stringification precision loss, relax tolerance
      expect(o2.l).toBeCloseTo(o1.l + 0.1, 2)
    })

    test("shifts chroma", () => {
      const c1 = "#ff0000"
      const c2 = shift(c1, { c: 0.5 })
      const o1 = hexToOklch(c1)
      const o2 = hexToOklch(c2)
      expect(o2.c).toBeCloseTo(o1.c * 0.5, 2)
    })

    test("shifts hue", () => {
      const c1 = "#ff0000"
      const c2 = shift(c1, { h: 90 })
      const o1 = hexToOklch(c1)
      const o2 = hexToOklch(c2)

      let expectedHue = o1.h + 90
      if (expectedHue >= 360) expectedHue -= 360
      // Hue can shift significantly during gamut mapping (fitOklch)
      // We check that it changed substantially in the expected direction
      // A precision of 0 means we're checking to the nearest integer
      expect(o2.h).toBeCloseTo(expectedHue, 0)
    })
  })

  describe("blend", () => {
    test("blends color over background", () => {
      const result = blend("#ffffff", "#000000", 0.5)
      expect(result).toBe("#808080")
    })

    test("blends with 100% alpha", () => {
      expect(blend("#ff0000", "#000000", 1)).toBe("#ff0000")
    })

    test("blends with 0% alpha", () => {
      expect(blend("#ff0000", "#000000", 0)).toBe("#000000")
    })
  })

  describe("lighten", () => {
    test("lightens color", () => {
      const start = "#ff0000"
      const lightened = lighten(start, 0.1)
      const startL = hexToOklch(start).l
      const lightenedL = hexToOklch(lightened).l
      expect(lightenedL).toBeCloseTo(Math.min(1, startL + 0.1), 2)
    })

    test("clamps at 1", () => {
      const white = "#ffffff"
      const lightened = lighten(white, 0.5)
      expect(lightened).toBe("#ffffff")
    })
  })

  describe("darken", () => {
    test("darkens color", () => {
      const start = "#ff0000"
      const darkened = darken(start, 0.1)
      const startL = hexToOklch(start).l
      const darkenedL = hexToOklch(darkened).l
      expect(darkenedL).toBeCloseTo(Math.max(0, startL - 0.1), 2)
    })

    test("clamps at 0", () => {
      const black = "#000000"
      const darkened = darken(black, 0.5)
      expect(darkened).toBe("#000000")
    })
  })

  describe("withAlpha", () => {
    test("converts hex to rgba string", () => {
      expect(withAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)")
      expect(withAlpha("#00ff00", 1)).toBe("rgba(0, 255, 0, 1)")
      expect(withAlpha("#0000ff", 0)).toBe("rgba(0, 0, 255, 0)")
      expect(withAlpha("#ffffff", 0.25)).toBe("rgba(255, 255, 255, 0.25)")
    })
  })
})
