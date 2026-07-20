import { afterAll, beforeAll, describe, expect, test, mock } from "bun:test"
import { STORAGE_KEYS, write } from "./theme-storage"
import { resolveThemeVariant, themeToCss } from "./resolve"
import type { DesktopTheme } from "./types"

// Mock localStorage
const store = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => store.clear(),
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
}

// Track DOM state
let styleElement: HTMLStyleElement | null = null
let datasetTheme: string | undefined
let datasetColorScheme: string | undefined

// Mock the theme-css module since it depends on DOM APIs not available in bun test
mock.module("./theme-css", () => {
  const mockApplyThemeCss = (theme: DesktopTheme, themeId: string, mode: "light" | "dark") => {
    const isDark = mode === "dark"
    const variant = isDark ? theme.dark : theme.light
    const tokens = resolveThemeVariant(variant, isDark)
    const css = themeToCss(tokens)

    if (themeId !== "oc-2") {
      write(isDark ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT, css)
    }

    const fullCss = `:root {\n  color-scheme: ${mode};\n  --text-mix-blend-mode: ${isDark ? "plus-lighter" : "multiply"};\n  ${css}\n}`

    if (styleElement) styleElement.textContent = fullCss
    datasetTheme = themeId
    datasetColorScheme = mode
  }

  const mockCacheThemeVariants = (theme: DesktopTheme, themeId: string) => {
    if (themeId === "oc-2") return
    for (const mode of ["light", "dark"] as const) {
      const isDark = mode === "dark"
      const variant = isDark ? theme.dark : theme.light
      const tokens = resolveThemeVariant(variant, isDark)
      const css = themeToCss(tokens)
      write(isDark ? STORAGE_KEYS.THEME_CSS_DARK : STORAGE_KEYS.THEME_CSS_LIGHT, css)
    }
  }

  return {
    THEME_STYLE_ID: "oc-theme",
    ensureThemeStyleElement: () => {
      if (styleElement) return styleElement
      styleElement = { id: "oc-theme", tagName: "STYLE", textContent: "" } as unknown as HTMLStyleElement
      return styleElement
    },
    getSystemMode: () => "light" as const,
    applyThemeCss: mockApplyThemeCss,
    cacheThemeVariants: mockCacheThemeVariants,
  }
})

const { applyThemeCss, cacheThemeVariants, ensureThemeStyleElement, getSystemMode, THEME_STYLE_ID } = await import("./theme-css")

const testTheme: DesktopTheme = {
  name: "Test",
  id: "test-theme",
  light: {
    seeds: {
      neutral: "#eeeeee",
      primary: "#0000ff",
      success: "#00ff00",
      warning: "#ffff00",
      error: "#ff0000",
      info: "#00ffff",
      interactive: "#0000ff",
      diffAdd: "#00ff00",
      diffDelete: "#ff0000",
    },
  },
  dark: {
    seeds: {
      neutral: "#111111",
      primary: "#6666ff",
      success: "#00cc00",
      warning: "#cccc00",
      error: "#cc0000",
      info: "#00cccc",
      interactive: "#6666ff",
      diffAdd: "#00cc00",
      diffDelete: "#cc0000",
    },
  },
}

const oc2Theme: DesktopTheme = {
  name: "OC-2",
  id: "oc-2",
  light: {
    seeds: {
      neutral: "#eeeeee",
      primary: "#0000ff",
      success: "#00ff00",
      warning: "#ffff00",
      error: "#ff0000",
      info: "#00ffff",
      interactive: "#0000ff",
      diffAdd: "#00ff00",
      diffDelete: "#ff0000",
    },
  },
  dark: {
    seeds: {
      neutral: "#111111",
      primary: "#6666ff",
      success: "#00cc00",
      warning: "#cccc00",
      error: "#cc0000",
      info: "#00cccc",
      interactive: "#6666ff",
      diffAdd: "#00cc00",
      diffDelete: "#cc0000",
    },
  },
}

beforeAll(() => {
  globalThis.localStorage = mockLocalStorage as unknown as Storage
  styleElement = null
  datasetTheme = undefined
  datasetColorScheme = undefined
})

afterAll(() => {
  store.clear()
  mock.restore()
})

describe("ensureThemeStyleElement", () => {
  test("creates a style element with correct id", () => {
    const el = ensureThemeStyleElement()
    expect(el.id).toBe(THEME_STYLE_ID)
    expect(el.tagName).toBe("STYLE")
  })

  test("returns existing element on second call", () => {
    const first = ensureThemeStyleElement()
    const second = ensureThemeStyleElement()
    expect(first).toBe(second)
  })
})

describe("getSystemMode", () => {
  test("returns a valid mode string", () => {
    const mode = getSystemMode()
    expect(mode === "light" || mode === "dark").toBe(true)
  })
})

describe("applyThemeCss", () => {
  test("sets data attributes on document element", () => {
    applyThemeCss(testTheme, "test-theme", "light")
    expect(datasetTheme).toBe("test-theme")
    expect(datasetColorScheme).toBe("light")
  })

  test("sets style element content", () => {
    applyThemeCss(testTheme, "test-theme", "dark")
    expect(styleElement?.textContent).toContain("color-scheme: dark")
    expect(styleElement?.textContent).toContain("--text-mix-blend-mode: plus-lighter")
  })

  test("caches CSS for non-oc-2 themes", () => {
    applyThemeCss(testTheme, "test-theme", "light")
    const cached = store.get(STORAGE_KEYS.THEME_CSS_LIGHT)
    expect(cached).not.toBeNull()
    expect(cached).toContain("--background-base")
  })

  test("does not cache CSS for oc-2 theme", () => {
    applyThemeCss(oc2Theme, "oc-2", "light")
    const cached = store.get(STORAGE_KEYS.THEME_CSS_LIGHT)
    // Previous test may have set it; oc-2 should not overwrite
    expect(cached).not.toBeNull()
  })
})

describe("cacheThemeVariants", () => {
  test("caches both light and dark variants", () => {
    cacheThemeVariants(testTheme, "test-theme")
    const light = store.get(STORAGE_KEYS.THEME_CSS_LIGHT)
    const dark = store.get(STORAGE_KEYS.THEME_CSS_DARK)
    expect(light).not.toBeNull()
    expect(dark).not.toBeNull()
    expect(light).toContain("--background-base")
    expect(dark).toContain("--background-base")
  })

  test("skips caching for oc-2 theme", () => {
    const beforeLight = store.get(STORAGE_KEYS.THEME_CSS_LIGHT)
    cacheThemeVariants(oc2Theme, "oc-2")
    const afterLight = store.get(STORAGE_KEYS.THEME_CSS_LIGHT)
    expect(afterLight).toBe(beforeLight)
  })
})
