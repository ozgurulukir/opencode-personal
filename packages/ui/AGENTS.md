## Testing

- Tests are co-located in `src/components/` alongside source files (not in a separate `test/` directory). This is a deviation from the root AGENTS.md convention.
- Run tests from `packages/ui` with `bun test <filename>` (e.g., `bun test message-part-utils.test.ts`). Do not prefix with `./src/components/` — bun resolves the filename against the package directory.

## Theme System Architecture

### Context vs Loader Separation

The theme system has **two separate concerns**:

1. **`theme/context.tsx`** — SolidJS context provider
   - Exports `useTheme()` hook and `ThemeProvider` component
   - Manages reactive theme state (`createSignal`, `createContext`)
   - Used by UI components to read current theme

2. **`theme/loader.ts`** — Theme file loading
   - Loads theme JSON from disk/remote
   - Validates theme schema
   - **Does NOT** manage reactive state

**Do NOT merge these files.** The context manages UI state; the loader manages file I/O. They communicate via props, not imports.

### Vite Glob Caching Pattern

`theme-glob.ts` uses a **triple-cache pattern** for `import.meta.glob`:

```ts
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
```

**Why cache?** `import.meta.glob` is a Vite compile-time feature that returns a fresh object on every call in development mode. Caching prevents:
- Repeated filesystem scans
- Identity comparisons failing (`===`)
- Unnecessary re-renders in development

**Test mocking:** Tests must mock the glob module directly:

```ts
// Mock the theme-glob module since import.meta.glob is a Vite compile-time feature
mock.module("../../src/theme/theme-glob", () => ({
  getThemeFiles: () => ({}),
  themeIDs: () => [],
  knownThemes: () => new Set(),
}))
```
