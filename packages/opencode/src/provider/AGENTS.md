# Provider

## `transform.ts` — orchestrator + per-provider modules in `transform/`

`normalizeMessages` is a thin orchestrator (30 lines) that delegates to 7 sibling modules in `transform/`. The orchestrator is NOT exported — it's only called by the public `ProviderTransform.message()`. Tests for provider transforms go through `ProviderTransform.message()`, not the internal functions directly.

### Transform execution order is load-bearing

The orchestrator applies transforms in a specific sequence: `sanitize → anthropic.removeEmptyContent → bedrock.removeEmptyContent → claudeIds.scrubToolCallIds → anthropic.reorderToolUseBlocks → mistral (early return) → deepseek → interleaved (early return)`. Reordering breaks provider-specific message normalization.

### Mistral and Interleaved have early returns

`TransformMistral.normalizeForMistral` and `TransformInterleaved.extractReasoningField` return their own result arrays (early return from the orchestrator), unlike the other transforms which chain via `msgs = transform(msgs)`. The orchestrator must `return` immediately after calling them, not assign to `msgs` and continue.

### Mistral mutates `msg.content` in-place

`TransformMistral.normalizeForMistral` reassigns `msg.content = msg.content.map(...)` which mutates the input array's message objects. This matches the original inline behavior — do not "fix" it to use immutable spreads without understanding the caller's expectations.

### Mistral tool-call ID normalization algorithm

3 steps: `replace(/[^a-zA-Z0-9]/g, "")` → `substring(0, 9)` → `padEnd(9, "0")`. For input `"call_abc-123!"` this produces `"callabc12"` (truncated to 9, not padded — the input had 10 alphanumeric chars).

### `interleaved.ts` type guard duplication

`extractReasoningField` needs `typeof model.capabilities.interleaved !== "object"` at the top because the `Model` type's `interleaved` field is `boolean | { field: string }`. The calling `if` in the orchestrator already narrows it, but the extracted function receives the full `model` without that narrowing. The guard is a no-op at runtime.

### `sanitizeSurrogates` lives in `transform/sanitize.ts`

Moved out of `transform.ts` — it has NO external callers (all 8 references were internal to the old `normalizeMessages`). Not re-exported from `transform.ts`. If you need it externally, import from `transform/sanitize`.

### `transform/` is a multi-sibling directory — no barrel

Each module self-reexports as `TransformFoo` (e.g., `export * as TransformAnthropic from "./anthropic"`). No `index.ts` — following the package's no-barrel rule for multi-sibling directories.

## `provider/error.ts` — never include raw `responseBody` in user-facing messages

`APICallError.responseBody` can be large JSON, HTML, or binary. The
`message()` helper MUST extract a concise message from it (`message`,
`error.message`, or `error` fields) rather than appending the raw body to
the returned string. Raw body leaks through `Session.Event.Error` →
`emit("error")` → stdout in JSON format mode, and inflates TUI error
commits.

Use `extractResponseMessage(body)` (defined in this file) instead of
repeating inline JSON parse logic.

## `systemPromptDelivery` — OpenAI OAuth uses `instructions`, not `system`

`ProviderTransform.systemPromptDelivery(providerID, authInfo)` returns `{ type: "instructions" }` for OpenAI OAuth (which doesn't support `system` role messages). The system prompt is passed via `providerOptions.instructions` instead. All other providers use `{ type: "messages" }`.

## `models-snapshot.js` is eagerly transformed — use lazy `getDatabaseProvider`

`provider.ts:1031` previously did `const database = mapValues(modelsDev, fromModelsDevProvider)`, transforming all 5949 models (178 providers) into full `Model` objects at init time. The fix is a `databaseCache` + `getDatabaseProvider(providerID)` wrapper that calls `fromModelsDevProvider` only on first access. This cuts provider init memory by ~50-100 MB. Call sites (`mergeProvider`, env loop, plugin hooks, `custom()`) must use `getDatabaseProvider` instead of direct `database[providerID]` access.

## models.dev is an unvalidated remote source — never let it crash the provider

The catalog is fetched over the network and cached on disk, so it is NOT trusted input. Two rules follow:

- **`JSON.parse` throws a defect, and `Effect.catch` only intercepts typed failures.** A corrupt or truncated cache file therefore used to kill the whole `ModelsDev` service (`Effect.orDie` on the populate path). The parse must live inside a plain `try/catch` (`parseCatalog`), and the disk read is guarded with `Effect.catchDefect`. Never wrap a raw `JSON.parse` in `Effect.catch` and assume it is handled.
- **Validate before writing.** `fetchAndWrite` parses the payload *before* `writeWithDirs`. A proxy/captive portal answering HTTP 200 with an HTML error page used to be written verbatim to `models.json`, permanently poisoning the cache for every later run.

`fromModelsDevModel` must also tolerate missing fields (`model.limit?.context ?? 0`). The declared `ModelsDev.Model` schema is a *description* of the upstream shape, not a guarantee: 301 of 9200 real models omit `temperature` and 411 omit `cost`, so `temperature` and `limit` are optional in the schema. Do not add non-optional fields to it without checking the live payload.

## `OPENCODE_MODELS_PATH` is authoritative — never fetch over it

When `OPENCODE_MODELS_PATH` is set, the user's local file IS the catalog. `refresh()` must be a no-op in that case: fetching would write the upstream catalog to a file the user never reads, and `opencode models --refresh` would report success while changing nothing. The read path and the write path are therefore different files by design (`readPath` vs `filepath`).

`refresh()` also honors `OPENCODE_DISABLE_MODELS_FETCH` — the flag means "no network", and a forced refresh must not bypass it.

The bundled snapshot (`models-snapshot.js`) is the **boot-time floor**: `populate` prefers disk → snapshot → fetch. This matches upstream, where the bundled snapshot is used even when the network fetch is disabled. Only if all three are unavailable does the catalog come back empty.

## A real model must win over a colliding experimental-mode variant

`fromModelsDevProvider` builds variant models as `${model.id}-${mode}`. That id can collide with a REAL model in the same provider — models.dev ships both a real `openai/gpt-5-fast` model and a `fast` variant of `openai/gpt-5` whose id is also `openai/gpt-5-fast` (9 such collisions in `vercel` alone). Overwriting the real entry replaced a catalog model with a differently-priced variant that also injected the variant's request body (`service_tier: priority`) into the real model.

**Rule:** write all real models first, then add variants only if their id is still free. The order must not matter — a single-pass loop that writes variants inline makes the outcome depend on the catalog's key order.

## The `/provider` endpoint memoizes the catalog transform

Transforming the whole models.dev catalog costs ~60ms and allocates thousands of model objects; serializing the result costs ~140ms and produces a ~6.8 MB payload. The HTTP handler keeps a `WeakMap` keyed on the raw provider object so the transform is reused across requests. The raw catalog objects are stable because `ModelsDev.Service` caches them. When the catalog is replaced, the old entries are collected with it.

## HTTP request timeout is now applied as a default in `customFetch`

The `customFetch` wrapper (`provider.ts`) applies `AbortSignal.timeout(resolveHttpTimeout(options["timeout"]))` with `DEFAULT_HTTP_TIMEOUT = 300_000` (5 min) unless `timeout` is explicitly `false`. This matters because the raw fetch is called with `timeout: false` (Bun's own fetch timeout is disabled), so previously a provider request could hang indefinitely when no `timeout`/`chunkTimeout` was configured.

## `chunkTimeout` is a liveness watchdog, not a deadline, and is SSE-only

`resolveChunkTimeout` defaults to `DEFAULT_CHUNK_TIMEOUT = 60_000`. `wrapSSE` resets its timer on every successful `reader.read()`, so a **drip** stream (a provider dribbling partial tokens/keepalives periodically) defeats it — it only guards a fully **silent** stream. It also only applies to SSE responses (non-`text/event-stream` responses bypass `wrapSSE`). Configure `timeout` for an absolute cap, `chunkTimeout` for idle-stream detection; a stream can still hang if it drips within the chunk window without ever finishing.

## Plugin auth fetch must never be clobbered by `options.fetch`

Provider state build merges options in this order: plugin auth-loader loop → `custom(dep)` loader loop → config re-apply, all through remeda `mergeDeep` (per-key, source wins). A custom loader that ships `options.fetch` therefore **clobbers the OAuth fetch wrapper** a plugin auth loader installed (codex/xAI plugins return `{ apiKey: OAUTH_DUMMY_KEY, fetch }` — the wrapper swaps the dummy key for the real token and rewrites `api.openai.com/v1/responses` to `chatgpt.com/backend-api/codex`). Clobbering sends the literal dummy key upstream → 401 "Incorrect API key provided: opencode-oauth-dummy-key". This regression shipped twice: `050157cb3` (openai/xai, via PR #136) and was only half-fixed for copilot by `8413d8bbb` (PR #144); the general fix is `1221fe80f`.

**Rule:** request REWRITERS (e.g. `rewriteMaxOutputTokens`) must never ride on `options.fetch`. Set `rewriteFetch: true` on the CustomLoader result instead — the merge step composes the rewrite over whatever fetch the provider already has (plugin wrapper or global). Auth-fetch owners (github-copilot) keep `options: {}`; google-vertex builds its auth fetch in its own loader and has no plugin conflict. The behavioral lock is the "codex 401 regression" test in `test/provider/provider.test.ts`.
