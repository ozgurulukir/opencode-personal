import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { STORAGE_KEYS, clearThemeCss, drop, normalize, read, write } from "./theme-storage"

// Mock localStorage for bun test environment
const store = new Map<string, string>()
const mockLocalStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, value) },
  removeItem: (key: string) => { store.delete(key) },
  clear: () => store.clear(),
  get length() { return store.size },
  key: (index: number) => [...store.keys()][index] ?? null,
}

beforeAll(() => {
  globalThis.localStorage = mockLocalStorage as unknown as Storage
})

afterAll(() => {
  store.clear()
})

describe("normalize", () => {
  test("returns oc-2 for oc-1", () => {
    expect(normalize("oc-1")).toBe("oc-2")
  })

  test("returns same id for non-oc-1 values", () => {
    expect(normalize("dracula")).toBe("dracula")
    expect(normalize("oc-2")).toBe("oc-2")
  })

  test("returns null for null", () => {
    expect(normalize(null)).toBeNull()
  })

  test("returns undefined for undefined", () => {
    expect(normalize(undefined)).toBeUndefined()
  })
})

describe("read/write/drop", () => {
  const key = "opencode-test-key"

  test("write and read a value", () => {
    write(key, "test-value")
    expect(read(key)).toBe("test-value")
  })

  test("drop removes a value", () => {
    write(key, "to-drop")
    drop(key)
    expect(read(key)).toBeNull()
  })

  test("read returns null for missing key", () => {
    expect(read("opencode-nonexistent-key")).toBeNull()
  })

  test("overwrite replaces existing value", () => {
    write(key, "first")
    write(key, "second")
    expect(read(key)).toBe("second")
  })

  test("drop on non-existent key does not throw", () => {
    expect(() => drop("opencode-nonexistent-key")).not.toThrow()
  })

  test("write with empty string", () => {
    write(key, "")
    expect(read(key)).toBe("")
  })
})

describe("clearThemeCss", () => {
  test("clears both theme CSS storage keys", () => {
    write(STORAGE_KEYS.THEME_CSS_LIGHT, ":root { color: red; }")
    write(STORAGE_KEYS.THEME_CSS_DARK, ":root { color: blue; }")
    clearThemeCss()
    expect(read(STORAGE_KEYS.THEME_CSS_LIGHT)).toBeNull()
    expect(read(STORAGE_KEYS.THEME_CSS_DARK)).toBeNull()
  })
})

describe("SSR safety", () => {
  test("read returns null when localStorage is not available", () => {
    const saved = globalThis.localStorage
    // @ts-expect-error - removing localStorage to simulate SSR
    delete globalThis.localStorage
    expect(read("any-key")).toBeNull()
    globalThis.localStorage = saved
  })

  test("write does not throw when localStorage is not available", () => {
    const saved = globalThis.localStorage
    // @ts-expect-error - removing localStorage to simulate SSR
    delete globalThis.localStorage
    expect(() => write("any-key", "value")).not.toThrow()
    globalThis.localStorage = saved
  })

  test("drop does not throw when localStorage is not available", () => {
    const saved = globalThis.localStorage
    // @ts-expect-error - removing localStorage to simulate SSR
    delete globalThis.localStorage
    expect(() => drop("any-key")).not.toThrow()
    globalThis.localStorage = saved
  })
})
