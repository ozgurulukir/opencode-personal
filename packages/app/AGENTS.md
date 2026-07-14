## Debugging

- NEVER try to restart the app, or the server process, EVER.

## Local Dev

- `opencode dev web` proxies `https://app.opencode.ai`, so local UI/CSS changes will not show there.
- For local UI changes, run the backend and app dev servers separately.
- Backend (from `packages/opencode`): `bun run --conditions=browser ./src/index.ts serve --port 4096`
- App (from `packages/app`): `bun dev -- --port 4444`
- Open `http://localhost:4444` to verify UI changes (it targets the backend at `http://localhost:4096`).

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls
- In hot `createMemo` paths, `for...of` still allocates iterator objects. Use index-based `for` loops with pre-allocated arrays to eliminate GC pressure from iteration.
- Never replace `createResource` with `createMemo` + `Object.assign` to mock the `Resource` shape. SolidJS tracks resource state internally — `List`'s `<For each={grouped.latest}>` and `grouped.loading` rely on native `Resource` reactivity. Commit `016a457` did this in `use-filtered-list.tsx` and broke async `List` dialogs (Open project, Model selection): API calls returned 200 OK but items never rendered. Reverted; the `keys` memo optimization is safe.
- `useFilteredList` in `packages/ui/src/hooks/use-filtered-list.tsx` uses a single `createResource` for grouped/filtered data. The `items` prop can be `T[]` (static) or `(filter: string) => T[] | Promise<T[]>` (sync or async). The `createResource` fetcher handles both cases via `(await Promise.resolve(items))`.

## Tool Calling

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.

## i18n

- Use `common.*` namespace for generic UI labels (Clear, Cancel, Open, etc.). Don't reuse domain-specific keys (e.g., `dialog.server.default.clear`) for generic icon buttons — it creates fragile coupling between unrelated components. Adding a new `common.*` key requires updating all 17 locale files; `parity.test.ts` only spot-checks specific keys, not full parity.

## Browser Automation

Use `agent-browser` for web automation. Run `agent-browser --help` for all commands.

Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes
