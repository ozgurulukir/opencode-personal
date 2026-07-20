import type { DesktopTheme } from "./types"

let files: Record<string, () => Promise<{ default: DesktopTheme }>> | undefined
let ids: string[] | undefined
let known: Set<string> | undefined

export function getThemeFiles() {
  if (files) return files
  files = import.meta.glob<{ default: DesktopTheme }>("./themes/*.json")
  return files
}

export function themeIDs() {
  if (ids) return ids
  ids = Object.keys(getThemeFiles())
    .map((path) => path.slice("./themes/".length, -".json".length))
    .sort()
  return ids
}

export function knownThemes() {
  if (known) return known
  known = new Set(themeIDs())
  return known
}

export const themeNames: Record<string, string> = {
  "oc-2": "OC-2",
  amoled: "AMOLED",
  aura: "Aura",
  ayu: "Ayu",
  carbonfox: "Carbonfox",
  catppuccin: "Catppuccin",
  "catppuccin-frappe": "Catppuccin Frappe",
  "catppuccin-macchiato": "Catppuccin Macchiato",
  cobalt2: "Cobalt2",
  cursor: "Cursor",
  dracula: "Dracula",
  everforest: "Everforest",
  flexoki: "Flexoki",
  github: "GitHub",
  gruvbox: "Gruvbox",
  kanagawa: "Kanagawa",
  "lucent-orng": "Lucent Orng",
  material: "Material",
  matrix: "Matrix",
  mercury: "Mercury",
  monokai: "Monokai",
  nightowl: "Night Owl",
  nord: "Nord",
  "one-dark": "One Dark",
  onedarkpro: "One Dark Pro",
  opencode: "OpenCode",
  orng: "Orng",
  "osaka-jade": "Osaka Jade",
  palenight: "Palenight",
  rosepine: "Rose Pine",
  shadesofpurple: "Shades of Purple",
  solarized: "Solarized",
  synthwave84: "Synthwave '84",
  tokyonight: "Tokyonight",
  vercel: "Vercel",
  vesper: "Vesper",
  zenburn: "Zenburn",
}
