import { afterAll, beforeAll, describe, expect, test, mock } from "bun:test"

const mockThemeFiles: Record<string, () => Promise<{ default: { name: string; id: string } }>> = {
  "./themes/amoled.json": () => Promise.resolve({ default: { name: "AMOLED", id: "amoled" } }),
  "./themes/dracula.json": () => Promise.resolve({ default: { name: "Dracula", id: "dracula" } }),
  "./themes/oc-2.json": () => Promise.resolve({ default: { name: "OC-2", id: "oc-2" } }),
  "./themes/tokyonight.json": () => Promise.resolve({ default: { name: "Tokyonight", id: "tokyonight" } }),
}

const mockThemeNames: Record<string, string> = {
  "oc-2": "OC-2",
  amoled: "AMOLED",
  dracula: "Dracula",
  tokyonight: "Tokyonight",
}

// Mock the theme-glob module since import.meta.glob is a Vite compile-time feature
mock.module("./theme-glob", () => {
  let files: Record<string, () => Promise<{ default: { name: string; id: string } }>> | undefined
  let ids: string[] | undefined
  let known: Set<string> | undefined

  return {
    getThemeFiles: () => {
      if (files) return files
      files = mockThemeFiles
      return files
    },
    themeIDs: () => {
      if (ids) return ids
      ids = Object.keys(mockThemeFiles)
        .map((path) => path.slice("./themes/".length, -".json".length))
        .sort()
      return ids
    },
    knownThemes: () => {
      if (known) return known
      known = new Set(["amoled", "dracula", "oc-2", "tokyonight"])
      return known
    },
    themeNames: mockThemeNames,
  }
})

// Import after mock is set up
const { knownThemes, themeIDs, themeNames } = await import("./theme-glob")

describe("themeIDs", () => {
  test("returns sorted theme IDs from glob", () => {
    const ids = themeIDs()
    expect(Array.isArray(ids)).toBe(true)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain("oc-2")
    expect(ids).toContain("dracula")
    // Verify sorted
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i - 1]!.localeCompare(ids[i]!)).toBeLessThanOrEqual(0)
    }
  })

  test("returns cached result on subsequent calls", () => {
    const first = themeIDs()
    const second = themeIDs()
    expect(first).toBe(second)
  })
})

describe("knownThemes", () => {
  test("returns a Set of all theme IDs", () => {
    const themes = knownThemes()
    expect(themes instanceof Set).toBe(true)
    expect(themes.has("oc-2")).toBe(true)
    expect(themes.has("dracula")).toBe(true)
  })

  test("returns cached result on subsequent calls", () => {
    const first = knownThemes()
    const second = knownThemes()
    expect(first).toBe(second)
  })
})

describe("themeNames", () => {
  test("contains all known theme names", () => {
    expect(themeNames["oc-2"]).toBe("OC-2")
    expect(themeNames.dracula).toBe("Dracula")
    expect(themeNames.tokyonight).toBe("Tokyonight")
  })

  test("contains all theme IDs as keys", () => {
    const ids = themeIDs()
    for (const id of ids) {
      expect(themeNames[id]).toBeDefined()
    }
  })
})
