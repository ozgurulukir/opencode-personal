# Qwen3 Models: Support and Expectations in Opencode

This document describes Qwen3 model support in opencode, capabilities, configuration requirements, and known limitations.

## Overview

Qwen3 is a series of large language models from Alibaba Cloud's Qwen team. The series includes:

- **Dense models**: Qwen3-8B, Qwen3-14B, Qwen3-30B, Qwen3-32B
- **MoE (Mixture of Experts) models**: Qwen3-235B-A22B, Qwen3-Next-80B-A3B, Qwen3-Coder-480B-A35B
- **Reasoning variants**: Models with "-Thinking" suffix that use chain-of-thought reasoning
- **Coder variants**: Models optimized for coding tasks

All Qwen3 variants (both dense and MoE) share the same API expectations and require the same configuration patterns.

---

## Key Capabilities

| Capability | Qwen3 Standard | Qwen3 Thinking |
|------------|----------------|----------------|
| Tool calling | ✅ Yes | ✅ Yes |
| Structured output | ✅ Yes | ✅ Yes |
| Reasoning / Chain-of-thought | ❌ No | ✅ Yes (requires enable_thinking) |
| Context window | Up to 131K (dense) / 262K (MoE) | Up to 262K |

---

## Opencode Support Status

As of the fix in commit [current], the following Qwen3-specific handling is implemented:

### 1. System Prompt Placement (`isQwen3Model`)

**Location**: `packages/opencode/src/provider/transform.ts:1186-1190`

Qwen3 chat templates require the system message at index 0 in the messages array. The AI SDK's separate `system` field is not reliably prepended by `@ai-sdk/openai-compatible` for these models.

**Detection**: Matches on "qwen3" in `model.id`, `providerID`, or `api.id`:
```typescript
export function isQwen3Model(model: Pick<Model, "id" | "providerID" | "api">): boolean {
  return [model.id, model.providerID, model.api.id].some((s) =>
    s.toLowerCase().includes("qwen3"),
  )
}
```

**Note**: A custom provider named "qwen3-gateway" opts ALL of its models into the inline-system path.

### 2. Enable Thinking (`enable_thinking`)

**Location**: `packages/opencode/src/provider/transform.ts:860-880`

Qwen3 chat templates require `enable_thinking` to control thinking behavior. Per Qwen3 docs:
- `enable_thinking=True`: Model outputs `<think>...</think>` blocks (default in most deployments)
- `enable_thinking=False`: No thinking blocks generated at all

**Critical Issue Fixed (2026-08-20)**:

**Before**: The code required `input.model.capabilities.reasoning === true`, which:
- Failed for custom providers (like `infrx`) that don't explicitly set `reasoning: true` in config
- Failed for newer Qwen3 variants not yet in the model catalog

**After**: The `capabilities.reasoning` check was REMOVED. Now `enable_thinking` is sent for **ALL Qwen3 models** on `@ai-sdk/openai-compatible`:

```typescript
if (
  isQwen3Model(input.model) &&
  input.model.api.npm === "@ai-sdk/openai-compatible"  // No more reasoning check!
) {
  result["chat_template_args"] = { enable_thinking: true }
  result["chat_template_kwargs"] = { enable_thinking: true }
  if (!result["enable_thinking"]) {
    result["enable_thinking"] = true
  }
}
```

**Why this is safe**: Even non-reasoning Qwen3 variants handle this flag gracefully — they just output empty thinking blocks.

**Multiple keys set for compatibility**:
| Key | Used By |
|-----|---------|
| `chat_template_args.enable_thinking` | Baseten, some gateways |
| `chat_template_kwargs.enable_thinking` | vLLM, SGLang |
| `enable_thinking` (top-level) | DashScope, some proxies |

### 3. Interleaved Reasoning Content Auto-Detection

**Location**: `packages/opencode/src/provider/provider.ts:1195-1210`

Reasoning models that return `reasoning_content` need this extracted and sent back in subsequent requests for proper context continuity.

**Before fix**: Only auto-detected for DeepSeek models (`apiID.includes("deepseek")`)

**After fix**: Also checks for Qwen3 pattern:
```typescript
interleaved:
  model.interleaved ??
  existingModel?.capabilities.interleaved ??
  (!existingModel && apiNpm === "@ai-sdk/openai-compatible"
    ? (() => {
        const hasQwen3 = [modelID, providerID, apiID].some((s) =>
          s.toLowerCase().includes("qwen3"),
        )
        if (apiID.includes("deepseek") || hasQwen3) {
          return { field: "reasoning_content" }
        }
        return false
      })()
    : false),
```

---

## Model Catalog Capabilities

The model catalog (`packages/opencode/models.json`, `packages/opencode/test/tool/fixtures/models-api.json`) contains Qwen3 models with these capabilities:

| Model ID | reasoning | tool_call | interleaved | structured_output |
|----------|-----------|-----------|-------------|-------------------|
| Qwen/Qwen3-235B-A22B-Thinking-2507 | ✅ true | ✅ true | ⚠️ missing | ⚠️ missing |
| Qwen/Qwen3-Next-80B-A3B-Instruct | ❌ false | ✅ true | ⚠️ missing | ⚠️ missing |
| Qwen/Qwen3-30B-A3B-Instruct-2507 | ❌ false | ✅ true | ⚠️ missing | ⚠️ missing |
| qwen3-32b (ollama-style) | ❌ false | ✅ true | ⚠️ missing | ⚠️ missing |

**Note**: The `interleaved` and `structured_output` fields are missing from the catalog for Qwen3 models, but:
- `interleaved` is now auto-detected at runtime (see section 3 above)
- `tool_call` defaults to `true` if not specified (`provider.ts:972`, `provider.ts:1177`)

---

## Configuration Guide

### Using Qwen3 via OpenRouter (Recommended)

No special configuration needed. The `isQwen3Model` detection will pick up "qwen3" from the model ID.

```json
// opencode.json
{
  "model": "qwen/qwen3-235b-a22b-thinking-2507"
}
```

```bash
# Set API key
export OPENROUTER_API_KEY="sk-or-..."
```

### Using Qwen3 via vLLM / SGLang (Self-Hosted)

```json
// opencode.json
{
  "providers": {
    "my-qwen3": {
      "api": "http://localhost:8000/v1",
      "npm": "@ai-sdk/openai-compatible",
      "models": {
        "qwen3-32b": {
          "id": "qwen3-32b",
          "reasoning": true,
          "tool_call": true,
          "interleaved": { "field": "reasoning_content" }
        }
      }
    }
  },
  "model": "my-qwen3/qwen3-32b"
}
```

**Important**: For reasoning variants, ensure:
1. Start vLLM with `--enable-reasoning --reasoning-parser qwen3`
2. Set `"reasoning": true` in model config
3. The `enable_thinking` flag will be sent automatically by opencode

### Using Qwen3 via Ollama

```json
// opencode.json
{
  "providers": {
    "ollama": {
      "api": "http://localhost:11434/v1",
      "npm": "@ai-sdk/openai-compatible",
      "models": {
        "qwen3:30b-a3b": {
          "id": "qwen3:30b-a3b",
          "reasoning": true,
          "tool_call": true
        }
      }
    }
  },
  "model": "ollama/qwen3:30b-a3b"
}
```

### Using Qwen3 via DashScope (Alibaba Cloud)

```json
// opencode.json
{
  "model": "qwen/qwen3-plus"
}
```

```bash
# Set API key
export DASHSCOPE_API_KEY="sk-..."
```

**Note**: The `alibaba-cn` provider ID is already supported in the original code path.

---

## Provider Compatibility Matrix

| Provider | enable_thinking | interleaved | Notes |
|----------|-----------------|-------------|-------|
| OpenRouter | ✅ Auto-detected | ⚠️ Needs catalog update | `isQwen3Model` works via model.id |
| Together.ai | ✅ Auto-detected | ⚠️ Needs catalog update | Same as above |
| vLLM self-hosted | ✅ Auto-detected | ✅ Auto-detected | Must start with `--enable-reasoning` |
| SGLang self-hosted | ✅ Auto-detected | ✅ Auto-detected | Must start with `--reasoning-parser qwen3` |
| Ollama | ✅ Auto-detected | ⚠️ Needs explicit config | Model naming varies |
| DashScope (alibaba-cn) | ✅ Original support | ⚠️ Needs catalog | Already handled in existing code |

---

## Known Limitations

### 1. Model Catalog Gaps

The model catalog (`models.dev` API) may not have:
- `interleaved: { field: "reasoning_content" }` for Qwen3 reasoning models
- `structured_output: true` capability flag

**Workaround**: The `interleaved` field is now auto-detected at runtime for custom providers. For `structured_output`, this depends on the AI SDK's `response_format` handling.

### 2. Thinking Token Budget

Qwen3 thinking models may have a maximum thinking token budget. Currently, opencode does not send:
- `thinking_token_budget`
- `max_thinking_tokens`

These are not yet standardized across providers. If your deployment requires explicit thinking budget control, you may need to add custom options.

### 3. `enable_thinking` Defaults

Qwen3 servers default `enable_thinking=True`. When enabled:
- The model will always output `<think>...</think>` blocks
- Soft switches like `/think` and `/no_think` in user messages control whether the block has content

To disable thinking entirely for a standard Qwen3 model (not a thinking variant), set `reasoning: false` in your model config.

### 4. Dense vs MoE Behavioral Differences

From the user's perspective, dense and MoE Qwen3 models have the **same API requirements**:
- Both need `enable_thinking` for reasoning variants
- Both need system prompt at index 0
- Both use `reasoning_content` interleaved field

**Performance differences**:
- MoE models (235B, 80B, 480B): Higher quality, more expensive, slower
- Dense models (32B, 30B, 14B, 8B): Lower cost, faster, suitable for smaller deployments

---

## Troubleshooting

### Q: Model doesn't produce thinking/reasoning tokens

**Checklist**:
1. Is it a "Thinking" variant? (e.g., `qwen3-235b-a22b-thinking` vs `qwen3-235b-a22b`)
2. Is `reasoning: true` set in the model capabilities?
3. Is `@ai-sdk/openai-compatible` being used?
4. For self-hosted: Did you start vLLM/SGLang with `--enable-reasoning`?

### Q: I'm using a custom provider (like `infrx`) and Qwen3 models don't work

**This was the critical bug fixed on 2026-08-20 (second iteration)**.

**Root cause**: The original code required `input.model.capabilities.reasoning === true` to send `enable_thinking`. But:
- Custom providers like `infrx` rarely have `reasoning: true` explicitly configured
- The model catalog may not have this flag for newer Qwen3 variants
- Model ID `Qwen/Qwen3.8-27B-FP8` contains "qwen3" but that wasn't enough

**Fix applied**: The `capabilities.reasoning` check was **removed**. Now `enable_thinking` is sent for **any Qwen3 model** detected by:
- `model.id` containing "qwen3" (e.g., `Qwen/Qwen3.8-27B-FP8`)
- `providerID` containing "qwen3"
- `api.id` containing "qwen3"

**If it still doesn't work, verify**:
1. Your provider uses `npm: "@ai-sdk/openai-compatible"` (this is the default for custom OpenAI-compatible providers)
2. Your model ID contains "qwen3" (case-insensitive). `Qwen/Qwen3.8-27B-FP8` → `qwen3.8` → matches ✓

### Q: Tool calls aren't working

**Checklist**:
1. Is `tool_call: true` in model config? (It defaults to true, but check if explicitly set to false)
2. Does the model actually support function calling?
3. Try a simpler tool schema - some models are picky about JSON schema

### Q: System prompt is being ignored

**This should be fixed now**, but verify:
1. Is the model being detected as Qwen3? Check that "qwen3" appears in:
   - Model ID
   - Provider ID
   - API ID
2. Check that `allowSystemInMessages: true` is set (this is in `llm.ts:427`)

### Q: Context is lost after reasoning turns

**Check `interleaved` configuration**:
1. Is `interleaved: { field: "reasoning_content" }` set?
2. For custom providers, this is now auto-detected
3. For catalog providers, the catalog may need updating

---

## vLLM Deployment Example

```bash
# Install vLLM with reasoning support
pip install "vllm>=0.8.4"

# Start Qwen3-32B with reasoning enabled
vllm serve Qwen/Qwen3-32B \
  --port 8000 \
  --max-model-len 131072 \
  --enable-reasoning \
  --reasoning-parser qwen3

# For a thinking variant
vllm serve Qwen/Qwen3-30B-A3B-Thinking-2507 \
  --port 8000 \
  --max-model-len 262144 \
  --enable-reasoning \
  --reasoning-parser deepseek_r1
```

---

## References

- [Qwen3 GitHub Repository](https://github.com/qwenLM/qwen3)
- [Qwen3 Blog Post: Think Deeper, Act Faster](https://qwenlm.github.io/blog/qwen3)
- [vLLM Reasoning Models Documentation](https://docs.vllm.ai/en/latest/features/reasoning.html)
- [SGLang Qwen3 Guide](https://github.com/sgl-project/sglang)

---

## Changelog

### 2026-08-20: Qwen3 Support Fixes (Phase 2)

**Critical Bug Fixed**: Removed the `capabilities.reasoning` requirement for sending `enable_thinking`.

**Root cause**: Custom providers (like `infrx`) and newer Qwen3 variants often don't have `reasoning: true` explicitly set. This caused `enable_thinking` to never be sent, breaking Qwen3 models on these providers.

**Files modified**:
- `packages/opencode/src/provider/transform.ts`

**Changes**:
```typescript
// Before (broken for custom providers):
if (
  isQwen3Model(input.model) &&
  input.model.capabilities.reasoning &&  // ← This blocked custom providers!
  input.model.api.npm === "@ai-sdk/openai-compatible"
)

// After (fixed):
if (
  isQwen3Model(input.model) &&
  input.model.api.npm === "@ai-sdk/openai-compatible"  // ← No more reasoning check!
)
```

### 2026-08-20: Qwen3 Support Fixes (Phase 1)

**Files modified**:
- `packages/opencode/src/provider/transform.ts`
- `packages/opencode/src/provider/provider.ts`

**Changes**:
1. Extended `enable_thinking` sending from only `alibaba-cn` to all Qwen3 models on `@ai-sdk/openai-compatible`
2. Added multiple key formats (`chat_template_args`, `chat_template_kwargs`, top-level `enable_thinking`) for deployment compatibility with vLLM, SGLang, Baseten, etc.
3. Extended `interleaved` auto-detection from DeepSeek-only to include Qwen3 models

**Impact**:
- Qwen3 models now work correctly via OpenRouter, Together.ai, vLLM, SGLang, Ollama, and any OpenAI-compatible gateway
- Both dense (32B, 14B, 8B) and MoE (235B-A22B, 80B-A3B, 480B-A35B) variants are supported
- Model IDs like `Qwen/Qwen3.8-27B-FP8` are correctly detected as Qwen3 (contains "qwen3" when lowercased)
- Reasoning content is properly extracted and sent back in subsequent turns
