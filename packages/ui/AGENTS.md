## Component Patterns

### Module-level `Math.random()` breaks SSR/HMR determinism

Module-level `Math.random()` calls (e.g., in `spinner.tsx` for animation delay/duration) produce different values on every HMR reload and would cause SSR hydration mismatches. Use deterministic arrays of pre-computed values instead. This applies to any module-scope initialization in SolidJS components.

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

## Storybook Patterns

### DataProvider Wrapper Pattern

Context-dependent components (e.g., `SessionTurn`) require `DataProvider` + `FileComponentProvider` wrappers in stories:

```tsx
// @ts-nocheck
import { DataProvider } from "../context/data"
import { FileComponentProvider } from "../context/file"

const FileStub = () => <div>File viewer stub</div>

export const MyStory = () => (
  <DataProvider data={...} directory="/project">
    <FileComponentProvider component={FileStub}>
      <MyComponent />
    </FileComponentProvider>
  </DataProvider>
)
```

**Why:** The `create()` scaffold generates empty-args stories that render nothing for context-dependent components. Manual `render` functions with wrappers are required (see `timeline-playground.stories.tsx`).

### Mock Data Factory Pattern

Create a shared `*-mock.ts` file with `@ts-nocheck` pragma for complex union types:

```ts
// @ts-nocheck
// session-turn-mock.ts
export function mkUser(text, parts = [], sessionID = "story-session") { ... }
export function mkAssistant(parentID, sessionID = "story-session", overrides = {}) { ... }
export const TOOL_SAMPLES = { bash: {...}, edit: {...}, ... }
export function mkTurn(config) { ... }
```

**Why:** Avoids duplicating 200+ lines of mock data builders across stories. Use `@ts-nocheck` only in mock files (complex types), not in stories.

### FileStub for Diff Viewer

Use a stub component to avoid loading the real `@pierre/diffs` web component in stories:

```tsx
const FileStub = () => (
  <div style={{ padding: "8px", color: "var(--text-weak)" }}>
    File viewer stub
  </div>
)
```

**Why:** The real diff viewer requires a web worker and Shiki highlighter — too heavy for Storybook. Stubs keep stories fast and deterministic.

### Deterministic IDs for Snapshots

Use fixed IDs in stories for visual regression testing:

```ts
const SESSION_ID = "story-session"  // NOT Date.now()
const USER_ID = "story-user-1"      // NOT uid()
```

**Why:** `Date.now()`-based IDs change on every render, breaking snapshot comparisons. Fixed IDs ensure stable DOM snapshots.
