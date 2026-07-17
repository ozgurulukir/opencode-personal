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

## `systemPromptDelivery` — OpenAI OAuth uses `instructions`, not `system`

`ProviderTransform.systemPromptDelivery(providerID, authInfo)` returns `{ type: "instructions" }` for OpenAI OAuth (which doesn't support `system` role messages). The system prompt is passed via `providerOptions.instructions` instead. All other providers use `{ type: "messages" }`.
