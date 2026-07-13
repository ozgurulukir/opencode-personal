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
## 2025-03-09 - Avoid Intermediate Arrays in SolidJS Counting
**Learning:** In SolidJS applications, using chained array methods like `.filter().length` or `.map().filter()` inside a `createMemo` (especially during high-frequency updates) leads to unnecessary intermediate array allocations, which creates Garbage Collection (GC) pressure.
**Action:** Use single-pass, index-based `for` loops to calculate counts or filtered values directly. This avoids intermediate allocations and preserves performance.
