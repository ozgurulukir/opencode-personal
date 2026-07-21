## 2025-07-06 - SolidJS Reactivity Array Allocations
**Learning:** Chained array methods (`.map().filter().flatMap()`) inside SolidJS `createMemo` functions (specifically in high-frequency updates like message streaming) cause excessive intermediate array allocations and GC pressure.
**Action:** Use single-pass `for...of` loops to directly populate final arrays or `Map`s within frequently triggered `createMemo` blocks.

## 2025-07-08 - SolidJS Getter Array Map GC Pressure
**Learning:** Returning `.map()` from a `createList` getter or any frequently accessed property (e.g. `items: () => flat().map(...)`) forces the array to be mapped and recreated *every single time* the list is accessed internally, causing massive garbage collection pressure and lag in long lists.
**Action:** Extract the `.map()` into its own `createMemo` outside the list configuration, and pass the memoized signal directly to `items`.

## 2026-07-08 - SolidJS useFilteredList optimization (REVERTED 2026-07-11)

**Learning:** `createResource` inherently resolves its promise in a microtask, meaning any UI using it will experience a brief asynchronous delay/flicker—even if the initial resource resolution resolves immediately or wraps synchronous lists.
**Action:** ~~When filtering static arrays or handling synchronous logic, extract that logic into a `createMemo` rather than wrapping it in a `createResource` fetcher.~~ **REVERTED** — see below.

## 2026-07-11 - createResource→createMemo in useFilteredList broke async dialogs (REVERT)

**Learning:** Replacing `createResource` with `createMemo` + a separate `asyncItems` `createResource` in `use-filtered-list.tsx` (commit `016a457`) broke async items in `List`-based dialogs. The `createResource`'s native reactivity for `grouped.latest` and `grouped.loading` was lost. Mocking the `Resource` shape via `Object.assign(() => grouped(), { get latest() {...}, get loading() {...} })` does **not** preserve SolidJS's internal resource tracking — the `List` component's `<For each={grouped.latest}>` and `grouped.loading` checks silently received stale/empty data. API calls succeeded (200 OK in network tab) but items never rendered. Both "Open project" (`dialog-select-directory.tsx`) and "Model selection" (`dialog-select-model.tsx`) dialogs appeared completely empty in the embedded web UI.
**Action:** Keep `createResource` as the single source of truth for grouped/filtered data in `useFilteredList` when `items` can be async. Do not split it into `createMemo` + `asyncItems`. The microtask delay from `createResource` is negligible and correct reactivity matters far more than eliminating one async tick. The `keys` memo optimization (`createMemo(() => flat().map(props.key))` passed as `() => keys()`) is safe and was preserved.
**Fix:** `packages/ui/src/hooks/use-filtered-list.tsx` — reverted to single `createResource` for grouped data; kept `keys` memo from commit `6541fdf`.

## 2024-03-24 - Array Map vs Loop in createMemo
**Learning:** In SolidJS `createMemo`, using `new Array(length)` with an index-based `for` loop avoids intermediate array allocations that come from chaining `.map()` on observable lists or doing `new Map(list.map(...))`. This drastically reduces garbage collection pressure on frequently re-rendered or large lists (like `visibleUserMessages`, `diffs`, `renderedUserMessages`, `terminal.all()`).
**Action:** Replace `.map()` chains inside high-frequency `createMemo`s with pre-allocated arrays and index-based `for` loops, or single-pass iteration to build Maps.

## 2024-03-24 - Array Methods vs Manual Loops in Typical UI Components
**Learning:** In SolidJS, while chaining array methods (`.map().filter()`) inside `createMemo` can cause GC pressure for extremely large or highly reactive lists, replacing standard methods like `.find()` or `.filter()` with verbose `for` loops in typical UI components (where arrays are small) is an unmeasurable micro-optimization that degrades readability. Crucially, `.find()` does not allocate a new array, and `.sort()` sorts in-place.
**Action:** Do not replace native array methods with manual `for` loops unless dealing with a proven bottleneck or a massive dataset. Prefer readable, idiomatic code for typical UI components.
## 2025-07-28 - Optimizing useFilteredList array allocations
**Learning:** The `useFilteredList` hook processes large datasets for File Search and command palettes. Using chained array methods (like `pipe(..., flatMap(...))` and `.map(...)`) inside `createMemo` hooks for the `flat` and `keys` arrays caused unnecessary intermediate array allocations, creating GC pressure on every keystroke during text filtering.
**Action:** Replace `pipe/flatMap` and `.map()` inside high-frequency `createMemo` blocks with pre-allocated arrays (`new Array(size)`) and standard `for` loops. This avoids creating closure arrays and reduces memory thrashing during typing in large lists.

## 2025-07-28 - O(N^2) Array operations when parsing paths
**Learning:** Parsing large lists of file paths for directory structure using array methods (`split`/`slice`/`join`) inside a `createMemo` (like `filter` in `file-tree.tsx`) causes significant GC pressure and O(D^2) complexity per path. For large workspaces, this makes rendering file trees extremely slow.
**Action:** Replace `split`/`slice`/`join` operations with a simple `indexOf()` loop and `slice()` to parse paths iteratively. This changes the complexity to O(D) and avoids creating multiple arrays per path segment.

## 2024-03-24 - Backward Loops for Array Find Last
**Learning:** In SolidJS applications, using `.filter(...).at(-1)` inside a `createMemo` to find the last matching element in an array forces a full O(N) traversal and creates an intermediate array on every evaluation. This is particularly problematic in high-frequency update paths like message streaming.
**Action:** Replace `.filter(...).at(-1)` with a backward `for` loop. This avoids intermediate array allocations and provides an early return, bringing the best-case time complexity down to O(1) and significantly reducing GC pressure.

## 2024-03-24 - Consolidating Multiple Filter Counts
**Learning:** Calling `.filter(condition).length` multiple times on the same array to calculate multiple counts forces multiple O(N) passes and allocates multiple intermediate arrays.
**Action:** Consolidate multiple `.filter(...).length` calls into a single `for` loop that iterates over the array once, incrementing local count variables. This reduces the number of traversals to 1 and eliminates all intermediate array allocations.

## 2025-07-28 - Consolidating multiple array methods in requestAnimationFrame loops
**Learning:** In high-frequency loops like `requestAnimationFrame` (e.g., `syncFrame` in `debug-bar.tsx`), chaining or sequential array methods (`.reduce()`, `.filter().length`) across the same array causes redundant O(N) passes and forces garbage collection due to intermediate array allocations.
**Action:** Replace sequential functional array operations (like multiple `reduce` and `filter`s) on the same array with a single imperative `for` loop that updates all metrics simultaneously. This eliminates redundant passes and GC pressure, providing true O(N) performance per frame.

## 2026-07-22 - Never modify bun.lock
**Learning:** `bun.lock` is a lockfile that gets updated automatically by `bun install`. Including unrelated `bun.lock` changes in a PR (e.g., a ghostty-web hash update) pollutes the diff and has nothing to do with the intended code change.
**Action:** Never include `bun.lock` changes in any PR unless the task explicitly asks to update dependencies. If `bun.lock` shows as modified, revert it before committing. Only touch source files (.ts, .tsx, .css, etc.) and `.jules/bolt.md`.
