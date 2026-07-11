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
