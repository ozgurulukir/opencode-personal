# Search

## ZvecIndex is a low-level class, not a service

`ZvecIndex` (`search/zvec.ts:59`) is a private class wrapping the native zvec HNSW binding. It is NOT a service — it has no Effect layer, no `InstanceState`, and its methods return `Effect<void, Error>` not `Effect<void, never>`. To use it outside `SearchService`, `export` the class and manage its lifecycle (path, dimension, open/close) manually. The `SearchService` layer wraps one `ZvecIndex` per workspace; other consumers (e.g., `Skill.Service`) create their own `ZvecIndex` instance in a separate `InstanceState`.

## EmbeddingService config is lazy, not eager

`EmbeddingService` reads config (provider, model, API key) on the first `embed()` call, not at layer build time (`embedding.ts:211-214`). This is because config reading requires the `Instance` context, which is only bound during tool/session execution, not when the registry builds layers at startup. Any service that uses `EmbeddingService` in its layer init must capture the embedder reference at build time but defer the actual config-dependent backend creation to first use.

## Separate `InstanceState` per resource to avoid Error type leakage

If a single `InstanceState<State, Error, ...>` holds a resource whose methods return `Effect<A, Error>`, the `Error` type pollutes all methods that read from that state. The fix: split the error-prone resource into its own `InstanceState` and compose them. See `skill/index.ts` for the pattern — `ZvecIndex` lives in its own `InstanceState`, separate from the skill metadata state.
