# TUI guide

This file covers TUI-specific patterns for `packages/opencode/src/cli/cmd/tui/`.

## OpenTUI keymap — event order and global keys

- Global keymap runs **before** renderable handlers. `e.preventDefault()` in a textarea's `onKeyDown` does NOT block a global keybind — only `ctx.consume()` from a `keymap.intercept("key", fn, opts)` callback does.
- Default intercept priority is 0. To win over an existing global keybind (e.g. `tab` is bound to `agent_cycle`), pass `{ priority: 1 }` (higher = earlier).
- `intercept("key", fn)` returns an unregister function. Register it inside a `createEffect` and return the unregister via `onCleanup`. The cleanup fires automatically when the effect re-runs, so conditional registration (e.g. "only intercept while ghost is showing") is safe.
- To pass the key through to the original binding, just don't call `ctx.consume()`. To swallow it (and prevent the original keybind), call `ctx.consume()`.

## Status signal and idle detection

- The session status is reactive: `sync.data.session_status?.[props.sessionID ?? ""]?.type` returns `"idle" | "busy" | "retry"`.
- To detect a transition (e.g. busy → idle), use `createEffect(on(() => status().type, (type, prev) => ...))` and compare `prev`. Reading `status().type` directly inside the effect re-fires on every reactive change, not just transitions.

## Component-local state and the `input` ref

- `let input: TextareaRenderable` at the top of the component starts as `undefined`. It's only assigned via the `<textarea ref={r => input = r} />` callback. Guard every reference with `if (!input || input.isDestroyed)` until the JSX mounts.
- `input.setText(text)` resets the buffer (clears undo history). `input.insertText(text)` inserts at the cursor and is undoable. Use `input.setText` for "commit an external value" and `input.insertText` for "user is typing more".
- The `onContentChange` callback does not fire for non-text keys (arrows, Tab, Esc). To clear suggestions on any keypress, intercept globally — the textarea's `onKeyDown` only sees keys that survive the global keymap.

## Sync with the store

- `store.prompt.input` and the textarea's `plainText` can drift briefly during IME composition. Read `input.plainText` and call `setStore("prompt", "input", value)` to reconcile, or trust the textarea and sync the store at submission time. See `submit()` in `component/prompt/index.tsx` for the canonical double-defer pattern.
