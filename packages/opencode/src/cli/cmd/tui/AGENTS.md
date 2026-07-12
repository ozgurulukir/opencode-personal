# TUI guide

This file covers TUI-specific patterns for `packages/opencode/src/cli/cmd/tui/`.

## OpenTUI stderr handling — critical gotcha

**OpenTUI core only intercepts `process.stdout.write`, never `process.stderr.write`.** This is not documented and causes display corruption if stderr writes occur during TUI rendering.

- TUI uses `alternate-screen` mode with `externalOutputMode: "passthrough"` (default)
- Any stderr output — Bun JIT warnings, `console.error`, unhandled rejection traces — leaks directly onto the alternate screen buffer
- **Fix:** Override `process.stderr.write` before creating the renderer and restore on exit. See `stderr-capture.ts` for the pattern.
- Bun Workers share the same process stderr, so worker output also leaks unless captured.
- `console.error`/`console.warn` internally call `process.stderr.write` in Bun/Node, so overriding it captures console output too.

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

## TUI plugin runtime

- TUI plugins have a scoped lifecycle backed by `AbortController`. Each plugin's dispose functions are tracked and cleaned up in reverse order with a 5-second timeout per plugin (`DISPOSE_TIMEOUT_MS = 5000` in `plugin/runtime.ts:118`).
- The keymap API exposed to TUI plugins is a `Proxy`-based scoped wrapper (`createScopedKeymap` in `plugin/runtime.ts:142`). All registration methods (`registerLayer`, `intercept`, `on`, etc.) are intercepted to auto-track their dispose functions via `scope.track()`. Non-registration methods pass through transparently.
- TUI plugins are activated sequentially (not in parallel) to guarantee deterministic side-effect order — command registration order affects keybind/command precedence, route registration is last-wins, and hook chains rely on stable ordering. See `plugin/runtime.ts:1064-1071`.
- The `api.command` shim (`plugin/command-shim.ts`) bridges v1 plugins to the v2 keymap API. It warns once per deprecated API call via `console.warn`. Remove the shim entirely in v2.
- `api.slots.register` and `api.theme.install` throw errors when called outside a plugin context (from `api.tsx`). They are only available inside the scoped plugin API created in `runtime.ts:pluginApi()`.
- Plugin enabled/disabled state is persisted in KV store under key `"plugin_enabled"` and merged with `tuiConfig.plugin_enabled` at startup. See `plugin/runtime.ts:447-466`.
