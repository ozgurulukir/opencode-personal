# TUI guide

This file covers TUI-specific patterns for `packages/opencode/src/cli/cmd/tui/`.

## OpenTUI stdout/stderr handling — critical gotcha

**In Bun, `console.{error,warn,log,info,debug}` does NOT route through `process.stderr.write`/`process.stdout.write`** — the optimized Bun console implementation writes directly to fd 1/2. This is the opposite of Node, where `console.error` calls `process.stderr.write`. Therefore:

- Overriding `process.stderr.write` alone is **insufficient** — every `console.error(...)` call still leaks onto the alternate screen buffer.
- The TUI uses `alternate-screen` mode with `externalOutputMode: "passthrough"` (default). `passthrough` mode does NOT intercept `process.stdout.write` either — only `capture-stdout` mode intercepts stdout, and that requires `screenMode: "split-footer"` (which the TUI does not use). So `console.log` and direct `process.stdout.write` calls ALSO leak.
- The exception is `tui/util/clipboard.ts:31` which writes OSC 52 escape sequences via `process.stdout.write` — these MUST reach the terminal, so `process.stdout.write` is intentionally NOT captured.

**Fix:** `stderr-capture.ts` overrides BOTH `process.stderr.write` AND `console.{error,warn,log,info,debug}` to route everything to the log file (via `appendFileSync`). It does NOT touch `process.stdout.write`. Bun Workers share the parent's stderr/stdout, so worker output also needs capture at the parent level.

**Specific leak vector:** `tui/plugin/runtime.ts:fail()` calls `console.error(\`[tui.plugin] ${text}\`, next)` where `next = {...data, error: errorData(error)}`. `errorData()` includes `cause: errorFormat(error.cause)` which JSON.stringifies non-Error object causes — meaning API request/response bodies attached as `error.cause` leak to the terminal. Always capture before calling plugin loading code, and prefer logging sensitive payloads via `log.error(...)` (which goes through `Log.write` → file) over `console.error`.

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

## Message store ordering — newest-first (`find`, not `findLast`)

- `sync.data.messages[sessionID]` is ordered **newest-first**: initial load comes from `V2Session.messages()` (`desc(time_created), desc(id)`, default `order: "desc"` at `v2/session.ts:432`) and live `session.next.*` message events are applied by `reduceMessageEvent` in `context/sync-messages.shared.ts`, which `unshift`s new messages (sync.tsx routes the event cases at `context/sync.tsx:250-278`; the reducer mutates the caller-owned draft in place, newest-first, and is covered by characterization tests in `test/cli/cmd/tui/sync-messages.test.ts`). The plugin API's `state.session.messages()` delegates to the same store (`plugin/api.tsx:158`), so plugin views share this contract. To get the LATEST message, use `find` (first match); `findLast` walks from the end and returns the OLDEST — this froze the context meters (prompt footer, sidebar context panel, subagent footer) at the first response.
- Some call sites intentionally `.toReversed()` first and then `findLast` (`routes/session/index.tsx:179`, `feature-plugins/system/session-v2.tsx:52`) — both frames are correct; don't "fix" one to match the other.
- Token usage/cost display has a single authority: `tui/context-usage.shared.ts` (`latestAssistantUsage`, `totalAssistantCost`; characterization tests in `test/cli/cmd/tui/`). Reuse it for any new tokens/percent/cost display instead of re-deriving the input+output+reasoning+cache sum.

## TUI plugin runtime

- TUI plugins have a scoped lifecycle backed by `AbortController`. Each plugin's dispose functions are tracked and cleaned up in reverse order with a 5-second timeout per plugin (`DISPOSE_TIMEOUT_MS = 5000` in `plugin/runtime.ts:118`).
- The keymap API exposed to TUI plugins is a `Proxy`-based scoped wrapper (`createScopedKeymap` in `plugin/runtime.ts:142`). All registration methods (`registerLayer`, `intercept`, `on`, etc.) are intercepted to auto-track their dispose functions via `scope.track()`. Non-registration methods pass through transparently.
- TUI plugins are activated sequentially (not in parallel) to guarantee deterministic side-effect order — command registration order affects keybind/command precedence, route registration is last-wins, and hook chains rely on stable ordering. See `plugin/runtime.ts:1064-1071`.
- The `api.command` shim (`plugin/command-shim.ts`) bridges v1 plugins to the v2 keymap API. It warns once per deprecated API call via `console.warn`. Remove the shim entirely in v2.
- `api.slots.register` and `api.theme.install` throw errors when called outside a plugin context (from `api.tsx`). They are only available inside the scoped plugin API created in `runtime.ts:pluginApi()`.
- Plugin enabled/disabled state is persisted in KV store under key `"plugin_enabled"` and merged with `tuiConfig.plugin_enabled` at startup. See `plugin/runtime.ts:447-466`.

## TodoWrite component — single source pattern

**Gate/iteration consistency**: Use single source `props.input.todos` for both gate and iteration. Avoid `<Match when={props.metadata.todos?.length}>` + `<For each={props.input.todos ?? []}>` mismatch.

**Pattern**:
```tsx
{(() => {
  const todos = props.input.todos ?? []
  if (todos.length === 0) {
    return <InlineTool ...>Updating todos...</InlineTool>
  }
  return (
    <BlockTool ...>
      <For each={todos}>{(todo) => <TodoItem ... />}</For>
    </BlockTool>
  )
})()}
```

**Priority badge**: `[H]`/`[M]`/`[L]` before status icon. TUI uses `theme.error/warning/success` colors. See `todo-item.tsx:priorityBadge()`, `todo-item.tsx:priorityColor()`.

## Interrupt command — separate from footer state

`component/prompt/index.tsx` registers `session.interrupt` as a hidden command with its own `store.interrupt` counter and 5s `setTimeout` reset. This is **independent** from the footer's `handleInterrupt` in `cli/cmd/run/footer.ts`:

- Prompt: `store.interrupt` (SolidJS store, component-local)
- Footer: `state().interrupt` (class signal, footer-owned)

They have the same name and same two-press pattern, but different substrates, different timer guards, and different second-press actions (`sdk.client.v2.session.abort` vs `options.onInterrupt`). Do not attempt to unify them.

## Unified TUI Spinner component

The `Spinner` component (`component/spinner.tsx`) wraps the native `<spinner>` element with an `animations_enabled` KV check and a `⋯` fallback. It supports variants (`"dots"`, `"knight-rider"`, `"blocks"`) with centralized configurations in `ui/spinner-config.ts`. All TUI callers (prompt, footer, dialogs) use `<Spinner>` rather than native `<spinner>` elements to ensure consistent fallback behavior and animation toggling.

## `createFrames` layout vs color generation

`createFrames()` from `ui/spinner.ts` derives frame strings based on geometric layout params (`width`, `style`, `holdStart`, `holdEnd`, `trailSteps`). Color distribution across frames is handled separately by `createColors()`. Frame layout configs are generated via `ui/spinner-config.ts` factories.

## Skill warnings

`skill.warning` bus events are emitted for non-critical skill frontmatter issues. The event is not in the generated SDK `Event` union and is NOT shown as a TUI toast. Warnings are surfaced to the user via the `skill` tool output when an invalid skill is loaded.

## Permission/question prompts aggregate over the full descendant session subtree

The session route renders pending prompts from **every** session in the viewed session's subtree (`collectSessionDescendants`, `tui/util/session-tree.ts`), not just the viewed session + its direct children. This is load-bearing: a depth-2+ subagent's `Permission.ask` is keyed under its own `sessionID`, and if aggregation were limited to direct children that ask would never surface → the subagent's shell command hangs (its `Deferred.await` never resolves). The `children` memo (direct children) is kept for subagent tab navigation only — don't reuse it for prompt aggregation.

Live child sessions are synchronized into `sync.data.session` as soon as the
`session.created` event arrives. Keep those entries filtered by the active
directory query and sorted by session id; otherwise a subagent can exist on the
server but remain absent from Ctrl+X/session-tree navigation until a refresh.

## V2 shell message rendering — silent gaps and failure modes

- **Unhandled V2 message types render NOTHING.** The main session route's message `<Switch>` (`routes/session/index.tsx`, cases around `:1136-1268`) has no fall-through `<Match when={true}>`, so any `sync.data.messages` record lacking a matching case (`shell`, `synthetic`, `switch`) is silently skipped — the feature looks like it "does nothing", with no error. Adding a new V2 message type / `session.next.*` message record REQUIRES adding a renderer case. The source comment at `routes/session/index.tsx:178-182` documents this.
- **The TUI `!` shell path is not fire-and-forget at the transport level.** Submit (`component/prompt/index.tsx`) → `sdk.client.v2.session.shell(...)` → POST `/api/session/:id/shell` is awaited server-side for the ENTIRE command duration (`SessionPrompt.shell` → `Runner.startShell` awaits the forked fiber). Output arrives as standalone `session.next.shell.started/ended` message records, NOT in the POST response; the client resolves failures via `res.error` and never rejects, so a bare `void` call loses both the output and the failure/busy signal.
- Debugging: in the session SQLite DB, TUI `!` shell parts are identifiable by a ULID `callID` (e.g. `01M3KW…`) and an `input` WITHOUT `description`; LLM `bash` calls use `call_…` ids and carry `description`.
