export const STORAGE_KEYS = {
  THEME_ID: "opencode-theme-id",
  COLOR_SCHEME: "opencode-color-scheme",
  THEME_CSS_LIGHT: "opencode-theme-css-light",
  THEME_CSS_DARK: "opencode-theme-css-dark",
} as const

export function normalize(id: string | null | undefined) {
  return id === "oc-1" ? "oc-2" : id
}

export function read(key: string) {
  if (typeof localStorage !== "object") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function write(key: string, value: string) {
  if (typeof localStorage !== "object") return
  try {
    localStorage.setItem(key, value)
  } catch {}
}

export function drop(key: string) {
  if (typeof localStorage !== "object") return
  try {
    localStorage.removeItem(key)
  } catch {}
}

export function clearThemeCss() {
  drop(STORAGE_KEYS.THEME_CSS_LIGHT)
  drop(STORAGE_KEYS.THEME_CSS_DARK)
}
