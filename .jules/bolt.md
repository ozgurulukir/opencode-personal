## 2025-07-06 - SolidJS Reactivity Array Allocations
**Learning:** Chained array methods (`.map().filter().flatMap()`) inside SolidJS `createMemo` functions (specifically in high-frequency updates like message streaming) cause excessive intermediate array allocations and GC pressure.
**Action:** Use single-pass `for...of` loops to directly populate final arrays or `Map`s within frequently triggered `createMemo` blocks.

## 2025-07-08 - SolidJS Getter Array Map GC Pressure
**Learning:** Returning `.map()` from a `createList` getter or any frequently accessed property (e.g. `items: () => flat().map(...)`) forces the array to be mapped and recreated *every single time* the list is accessed internally, causing massive garbage collection pressure and lag in long lists.
**Action:** Extract the `.map()` into its own `createMemo` outside the list configuration, and pass the memoized signal directly to `items`.

## 2026-07-08 - SolidJS useFilteredList optimization

**Learning:** `createResource` inherently resolves its promise in a microtask, meaning any UI using it will experience a brief asynchronous delay/flicker—even if the initial resource resolution resolves immediately or wraps synchronous lists.
**Action:** When filtering static arrays or handling synchronous logic, extract that logic into a `createMemo` (which evaluates synchronously upon access) rather than wrapping it in a `createResource` fetcher, preserving instantaneous updates in the UI. If you are modifying a hook that returned a `Resource` type, use `Object.assign` to mock out the original `Resource` shape (`() => T` accessor with `get latest()` / `get loading()`) to avoid API breaking changes while injecting custom Memo implementations.

## 2024-03-24 - Array Map vs Loop in createMemo
**Learning:** In SolidJS `createMemo`, using `new Array(length)` with a `for...of` loop avoids intermediate array allocations that come from chaining `.map()` on observable lists or doing `new Map(list.map(...))`. This drastically reduces garbage collection pressure on frequently re-rendered or large lists (like `visibleUserMessages`, `diffs`, `renderedUserMessages`, `terminal.all()`).
**Action:** Replace `.map()` chains inside high-frequency `createMemo`s with pre-allocated arrays and `for` loops, or single pass iteration to build Maps.
