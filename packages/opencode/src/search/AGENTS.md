# Search

## ZvecIndex is a low-level class, not a service

`ZvecIndex` (`search/zvec.ts`) is an exported class wrapping the native zvec HNSW binding. It is NOT an Effect service — it has no layer of its own and no `InstanceState`. The `SearchService` layer wraps one `ZvecIndex` per workspace; other consumers (e.g., `Skill.Service`) construct their own `ZvecIndex` in a separate `InstanceState` closure and must register `Effect.addFinalizer(() => index.close())` there (both instantiation sites do).

Constructor: `(path, dimension: () => number, fs: AppFileSystem.Interface)`. Dimension resolution has a strict precedence — the actual embedding vector length is always authoritative over the getter: (1) `index()`/`search()` pass `embedding.length` explicitly to `open()`, so the collection always matches the vectors actually written/read; (2) the explicit `search.open` / skill-side open paths call `EmbeddingService.resolve` FIRST (an idempotent, cheap config read — heavy ONNX/API init stays inside `embed()`) so the getter reflects config; (3) unresolved, the getter returns the pre-config default (384) and must never drive a create-or-migrate decision — resolve failures skip the early open rather than risk destroying a valid collection via a bogus migration. `open()` is idempotent: create → already-exists fallback → validate persisted dimension (only positive-number mismatches migrate) → on mismatch destroy + recreate AND wipe the companion manifest (a surviving manifest would make consumers skip re-embedding). Consumers must therefore open BEFORE reading the manifest — that is why `SearchServiceInterface.open` exists; `IndexWorkspace` and `Skill.state` both call it first.

## Manifest adjacency invariant

The companion manifest for an index at `{indexPath}` always lives at `{indexPath}_manifest.json`. Derive paths via `manifestPathFor()` (`search/manifest.ts`) — never hand-build them. `ZvecIndex.reset()` owns manifest removal (index dir + manifest); consumers must not duplicate it.

## Native errors are coded; status results are checked

The raw binding throws `Error` objects carrying a `ZVEC_*` `code`. `zvec.ts` mirrors `@zvec/zvec`'s structural `isZVecError` locally — do NOT import the wrapper's helper, the wrapper is bypassed for Bun `--compile` (see the comment at the `zvec()` loader). Caveat: this binding version (0.6.0) throws `ZVEC_INVALID_ARGUMENT` with a `"path validate failed: ... exists"` message for a duplicate create, NOT `ZVEC_ALREADY_EXISTS` — `alreadyExists()` matches the code OR the message for that reason. All failures surface as `ZvecError` (an `Error` subclass with a `code`). `upsertSync`/`deleteSync` return per-doc `ZVecStatus {ok, code, message}`: `checkStatuses` fails fully-failed batches and treats `ZVEC_NOT_FOUND` deletes as benign (idempotent delete of absent ids).

## EmbeddingService config is lazy, not eager

`EmbeddingService` reads config (provider, model, API key) on the first `embed()` call, not at layer build time (`embedding.ts`). This is because config reading requires the `Instance` context, which is only bound during tool/session execution, not when the registry builds layers at startup. Any service that uses `EmbeddingService` in its layer init must capture the embedder reference at build time but defer the actual config-dependent backend creation to first use.

## ONNX runtime and WASM are module-level eager — use dynamic import

Despite backend creation being lazy, `embedding.ts` previously had a static `import * as ort from "onnxruntime-web"` and static `import ... with { type: "file" }` for the 13 MB WASM files. These load the entire ONNX runtime + WASM binary into memory at module parse time, even when semantic search is never used. The fix: `import type * as ort` (type-only, erased at runtime) + `await import("onnxruntime-web")` and `await import("./wasm/...", { with: { type: "file" } })` inside `createLocalProvider`. The `ortModule` variable holds the runtime reference for `InferenceSession.create` and `Tensor` construction.

## Separate `InstanceState` per resource to avoid Error type leakage

If a single `InstanceState<State, Error, ...>` holds a resource whose methods return `Effect<A, Error>`, the `Error` type pollutes all methods that read from that state. The fix: split the error-prone resource into its own `InstanceState` and compose them. See `skill/index.ts` for the pattern — `ZvecIndex` lives in its own `InstanceState`, separate from the skill metadata state.
