# Plugin runtime guide

## Hook execution

- `trigger()` iterates hooks sequentially but each hook is individually error-isolated via `Effect.tryPromise` + `Effect.catch`. A single failing plugin hook does NOT break the chain for other plugins. This is critical because hooks come from third-party code.
- The `event` hook in the bus subscription is fire-and-forget (`Promise.resolve(fn(...)).catch(...)`) — it does NOT block the event stream. Errors are logged but not propagated.
- Plugin loading order is deterministic: server plugins are loaded sequentially (not in parallel) so hook registration order is stable across runs. See `plugin/index.ts:210-211`.

## Legacy plugin format

- `getLegacyPlugins()` throws `TypeError("Plugin export is not a function")` if ANY export in the module is not a function or a `{ server: fn }` object. Legacy plugin modules must only export plugin functions — constants, types, or other non-function exports will cause the entire plugin to fail to load.

## Plugin meta tracking

- `PluginMeta.touchMany()` uses `Flock.withLock` (file-level locking) to serialize concurrent metadata updates across processes. The entire store is read, modified, and written atomically under the lock.

## Compatibility

- npm plugins are checked for opencode version compatibility via `engines.opencode` in `package.json`. File plugins (local development code) skip this check entirely.

## Testing

- `Plugin.defaultLayer` includes `Config.defaultLayer` and triggers `import("../server/server")` in the init closure. Tests using `defaultLayer` time out in test context. Use `TestConfig.layer()` mock + `Plugin.layer` instead. See `auth-override.test.ts` and `loader-shared.test.ts` for the working pattern.
- `trigger.test.ts` and `workspace-adapter.test.ts` have a pre-existing timeout issue on Windows for this reason. They are not runnable without a running server or a mocked config layer.

### Plugin config hooks modify the config object in-place

When a plugin's `config` hook modifies `cfg` (e.g., `cfg.agent["my_agent"] = {...}`), the modification only persists if `config.get()` returns the **same mutable object** across calls. With `TestConfig.layer()`, the `get` callback must return a stable reference — create the config object once at module level and return it from `get`. A fresh object per call means the plugin's modifications are lost before `Agent.state` init reads them.

```typescript
// Correct: mutable config object, same reference every time
const configObj = { plugin: [pluginUrl], plugin_origins: [...] }
const mockConfig = TestConfig.layer({
  get: () => Effect.succeed(configObj as Config.Info),
})
```

### `Agent.defaultLayer` cascades through `Plugin.defaultLayer`

`Agent.defaultLayer` (line 507-513) provides `Plugin.defaultLayer`, `Provider.defaultLayer`, `Auth.defaultLayer`, `Config.defaultLayer`, and `Skill.defaultLayer`. To avoid the heavy `Plugin.defaultLayer` in tests, you must use `Agent.layer` (not `defaultLayer`) and provide all five dependencies manually. `Layer.mock` works for `Auth.Service`, `Skill.Service`, and `Provider.Service` since `Agent.state` init only calls `config.get()` and `skill.dirs()` — the other services are captured but unused until `Agent.generate()`.
