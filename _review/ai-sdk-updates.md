# AI SDK Dependency Upgrade Report

**Scope:** Minor/patch upgrades only. **Major** versions are intentionally excluded (the AI SDK ecosystem's `latest` dist-tag currently points at the next major — `ai@7`, provider packages `4.x`/`5.x` — which is breaking and out of scope).

**Date:** 2026-09-26
**Sources:** `package.json` (root `workspaces.catalog`) + `packages/opencode/package.json`
**Method:** npm registry `dist-tags` / `versions` via `npm view`, cross-checked with the repo's own `bun run script/check-updates.ts`. Change notes read from the [vercel/ai](https://github.com/vercel/ai) monorepo changelogs (v6 maintenance line lives on the `release-v6.0` branch / release tags, **not** `main`).

> **Supersedes** the previous run in this file (2026-08-07), which was marked *APPLIED*. Its targets have since become the current pins; this report refreshes against the registry as of 2026-09-26.
>
> **Status: NOT APPLIED** — nothing was upgraded. `package.json`, `bun.lock`, and `node_modules` are untouched.

---

## Summary

- **25** AI SDK–related dependencies audited.
- **22** have a same-major (minor/patch) upgrade available.
- **3** are already at the latest same-major version (no in-scope update).

### ⚠️ Critical caveat on `latest` dist-tags

For **every** `@ai-sdk/*` package and for `ai`, the npm `latest` dist-tag points at a **newer major**. The in-major release is carried by the **`ai-v6`** dist-tag. Since versions here are **exact-pinned** (no `^` ranges, plus `catalog:` in the root), `bun install` will **not** auto-bump — the upgrades below must be applied deliberately and stay pinned.

| Ecosystem group | `latest` (out of scope) |
| --- | --- |
| `@ai-sdk/openai` | 4.0.x |
| `@ai-sdk/anthropic` / `google` / `azure` | 4.0.x |
| `@ai-sdk/google-vertex` / `amazon-bedrock` | 5.0.x |
| `ai` | 7.0.x |
| `@ai-sdk/provider` | 4.0.x |
| `@ai-sdk/provider-utils` | 5.0.x |

---

## Dependencies WITH an upgrade available

| # | Package | Current | Target (same major) | Bump | Own behavioral changes? | Changelog |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `ai` | `6.0.246` | **`6.0.292`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/ai@6.0.292/packages/ai/CHANGELOG.md) |
| 2 | `@ai-sdk/provider` | `3.0.15` | **`3.0.17`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/@ai-sdk/provider@3.0.17/packages/provider/CHANGELOG.md) |
| 3 | `@ai-sdk/provider-utils` | `4.0.45` | **`4.0.54`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/@ai-sdk/provider-utils@4.0.54/packages/provider-utils/CHANGELOG.md) |
| 4 | `@ai-sdk/openai` | `3.0.96` | **`3.0.118`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/release-v6.0/packages/openai/CHANGELOG.md) |
| 5 | `@ai-sdk/anthropic` | `3.0.110` | **`3.0.122`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/release-v6.0/packages/anthropic/CHANGELOG.md) |
| 6 | `@ai-sdk/google` | `3.0.109` | **`3.0.127`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/release-v6.0/packages/google/CHANGELOG.md) |
| 7 | `@ai-sdk/google-vertex` | `4.0.182` | **`4.0.205`** | patch | ⚠️ mostly dependency propagation | [link](https://github.com/vercel/ai/blob/release-v6.0/packages/google-vertex/CHANGELOG.md) |
| 8 | `@ai-sdk/amazon-bedrock` | `4.0.153` | **`4.0.183`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/release-v6.0/packages/amazon-bedrock/CHANGELOG.md) |
| 9 | `@ai-sdk/azure` | `3.0.101` | **`3.0.126`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/release-v6.0/packages/azure/CHANGELOG.md) |
| 10 | `@ai-sdk/openai-compatible` | `2.0.67` | **`2.0.78`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/release-v6.0/packages/openai-compatible/CHANGELOG.md) |
| 11 | `@ai-sdk/gateway` | `3.0.173` | **`3.0.202`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/release-v6.0/packages/gateway/CHANGELOG.md) |
| 12 | `@ai-sdk/alibaba` | `1.0.45` | **`1.0.59`** | minor | ✅ yes | [link](https://github.com/vercel/ai/blob/main/packages/alibaba/CHANGELOG.md) |
| 13 | `@ai-sdk/cerebras` | `2.0.73` | **`2.0.84`** | patch | ❌ deps only | [link](https://github.com/vercel/ai/blob/main/packages/cerebras/CHANGELOG.md) |
| 14 | `@ai-sdk/cohere` | `3.0.54` | **`3.0.64`** | patch | ✅ minor | [link](https://github.com/vercel/ai/blob/main/packages/cohere/CHANGELOG.md) |
| 15 | `@ai-sdk/deepinfra` | `2.0.71` | **`2.0.82`** | patch | ✅ minor | [link](https://github.com/vercel/ai/blob/main/packages/deepinfra/CHANGELOG.md) |
| 16 | `@ai-sdk/groq` | `3.0.59` | **`3.0.69`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/main/packages/groq/CHANGELOG.md) |
| 17 | `@ai-sdk/mistral` | `3.0.57` | **`3.0.67`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/main/packages/mistral/CHANGELOG.md) |
| 18 | `@ai-sdk/perplexity` | `3.0.53` | **`3.0.63`** | patch | ✅ minor | [link](https://github.com/vercel/ai/blob/main/packages/perplexity/CHANGELOG.md) |
| 19 | `@ai-sdk/togetherai` | `2.0.73` | **`2.0.84`** | patch | ❌ deps only | [link](https://github.com/vercel/ai/blob/main/packages/togetherai/CHANGELOG.md) |
| 20 | `@ai-sdk/vercel` | `2.0.69` | **`2.0.80`** | patch | ❌ deps only | [link](https://github.com/vercel/ai/blob/@ai-sdk/vercel@2.0.80/packages/vercel/CHANGELOG.md) |
| 21 | `@ai-sdk/xai` | `3.0.121` | **`3.0.136`** | patch | ✅ yes | [link](https://github.com/vercel/ai/blob/main/packages/xai/CHANGELOG.md) |
| 22 | `gitlab-ai-provider` | `6.12.1` | **`6.18.0`** | minor | ✅ yes | [link](https://gitlab.com/vglafirov/gitlab-ai-provider/-/blob/main/CHANGELOG.md) |

---

## Per-package details

### Core runtime

#### `ai` — `6.0.246` → `6.0.292` (patch)
The core SDK. All in-range releases are patch. Highlights:
- **6.0.290** — fix Google `embedMany` >100-value batching; resume tool approvals from earlier messages; execute manually-approved tool inputs from schema transforms.
- **6.0.289** — prevent preliminary tool outputs from completing chats; prevent duplicate content types in chat transport; fix streamed tool-input callbacks firing out of order on newer Node.
- **6.0.286/6.0.287** — preserve provider metadata on failed/simulated tool calls; report the `prepareStep` model in streamed step results.
- **6.0.284** — reject embedding responses with no embeddings and invalid reranking indices.

#### `@ai-sdk/provider` — `3.0.15` → `3.0.17` (patch)
- **3.0.16** — retry unclassified empty image results; add provider-independent result retryability classification (preserved through AI Gateway); mark Google/Google Vertex content-filtered results as terminal.
- **3.0.17** — preserve opaque file URI strings for provider serialization.

#### `@ai-sdk/provider-utils` — `4.0.45` → `4.0.54` (patch)
Foundation shared by nearly every provider — highest-leverage bump.
- **4.0.46** — upgrade `undici` to a maintained release.
- **4.0.47** — preserve schema-valued additional properties when converting Zod 4 schemas.
- **4.0.48** — allow imports in runtimes without a global `fetch`.
- **4.0.49** — split OpenAI/Azure embedding requests by a UTF-8 byte budget.
- **4.0.50** — mark transient network errors during successful-body reads as retryable.
- **4.0.52** — avoid excessive memory when base64-encoding byte arrays.
- **4.0.54** — fix Google `embedMany` >100-value batch alignment; execute manually-approved tool inputs from schema transforms.

### Major providers

#### `@ai-sdk/openai` — `3.0.96` → `3.0.118` (patch)
- Adds async tool calling (3.0.110).
- New `reasoningEffortUpdate` on empty system messages so reasoning effort can change mid-conversation **while preserving the prompt-cache prefix** (3.0.118).
- New model IDs (GPT-6 Sol/Luna, `gpt-6-astra`, GPT Image 2.5 Flare/Sunburst).
- Fixes: accept `incomplete` Responses function/custom tool-call items (truncation → `length` instead of `TypeValidationError`, 3.0.116); empty chat-completion choices return an AI SDK error (3.0.112); flatten mid-stream Responses error events (3.0.107); preserve provider file refs in tool results (3.0.114).

#### `@ai-sdk/anthropic` — `3.0.110` → `3.0.122` (patch)
- Adds Claude Opus 5.5 (3.0.120) and "fable 5.1" (3.0.116) support.
- Expands preserved-thinking support to `prefix_mismatch_behavior: 'error'` (3.0.118).
- Preserves Anthropic server-tool caller metadata across multi-turn conversations (3.0.111).
- Most intermediate patches are dependency bumps only.

#### `@ai-sdk/google` — `3.0.109` → `3.0.127` (patch)
- Fixes `embedMany` for >100 values by keeping per-value multimodal content aligned across auto-batches (3.0.127).
- Adds `gemini-3.8-flash` (3.0.121) and Gemini 3.5 Transcribe support (3.0.116).
- Preserves prompt feedback/metadata across streaming chunks (3.0.123).
- Content-filter classification for prompt-level safety blocks without candidates (3.0.117).
- Schema fixes: inline local JSON Schema refs; preserve recursive tool schemas (3.0.111/3.0.114); convert enum values to Gemini schema format (3.0.116).

#### `@ai-sdk/google-vertex` — `4.0.182` → `4.0.205` (patch)
- Mostly dependency propagation from `@ai-sdk/google` (gemini-3.8-flash, Gemini 3.5 Transcribe, image retryability classification).
- Direct: avoid forced structured-output tools for incompatible Claude models (4.0.204); dead-code lint enablement (4.0.205).
- Releases 4.0.183–4.0.196, 4.0.199–4.0.203, 4.0.205 are dependency-only.

#### `@ai-sdk/amazon-bedrock` — `4.0.153` → `4.0.183` (patch)
- Stream robustness: surface modeled event-stream exceptions (4.0.159); reject incomplete buffered frames instead of silently completing with partial output (4.0.157).
- Support `reasoningContent.redactedContent` and replay (4.0.158).
- Resolve non-standard partition/service-specific endpoints (4.0.176).
- Enable Anthropic features for application inference profile chat models (4.0.177).
- Avoid forced structured-output tools for incompatible Claude models (4.0.181).
- Structured-output mode option defaulting Claude Sonnet 4.6 / Haiku 4.5 to JSON tool fallback (4.0.168).
- Return generated text from citation content blocks (4.0.171); preserve complete Converse usage objects in `usage.raw` (4.0.163).

#### `@ai-sdk/azure` — `3.0.101` → `3.0.126` (patch)
- Export `OpenAIResponsesSystemMessageOptions` for typed message-level reasoning-effort updates (3.0.126).
- Construct OpenAI v1 URLs for Azure AI Foundry (`*.services.ai.azure.com`) and Cognitive Services hostnames (3.0.113).
- Include explicit message item types in Azure AI Foundry Responses requests (3.0.118).
- Split embeddings by a UTF-8 byte budget in addition to input count (3.0.109).
- Warn and omit deprecated/ineffective DeepSeek sampling options (3.0.107).

#### `@ai-sdk/openai-compatible` — `2.0.67` → `2.0.78` (patch)
- Keep reasoning streams contiguous when deltas include empty tool-call arrays (2.0.75).
- Report truncated chat streams as errors (2.0.70).
- Preserve unmapped usage fields in `usage.raw` (2.0.69).
- Support text/thinking parts in array-based chat-completion content, ignoring unknown part types (2.0.74).
- Empty chat-completion choices return an AI SDK error (2.0.75).

#### `@ai-sdk/gateway` — `3.0.173` → `3.0.202` (patch)
- Adds Browserbase Search & Fetch tools and structured-output support in the `has` provider option (3.0.202); quantization conditions in `has` (3.0.200); `reasoning`/`tool-use` model filtering (3.0.197); Tako Search tool support (3.0.180).
- Fixes: forward server-returned warnings on `doGenerate` (3.0.193); mark transient response-body read errors as retryable (3.0.185).
- Many releases are backported gateway model-settings updates + new model IDs (Claude Opus 5.5, grok 4.7, gemini-3.8-flash, GPT-6 Sol/Luna, GLM-5.3-Flash, DeepSeek V4 Flash Vision Exp).

### Additional providers

#### `@ai-sdk/alibaba` — `1.0.45` → `1.0.59` (minor)
- Use model-specific structured output modes (1.0.57).
- Preserve reasoning in multi-turn requests by default on supported models (1.0.55).
- Preserve DeepSeek reasoning streams across empty tool-call deltas (1.0.54).
- wan3 all-in-one video generation + negative text-output-token-count fix (1.0.50).

#### `@ai-sdk/cerebras` — `2.0.73` → `2.0.84` (patch)
- Remove deprecated zai glm-4.7 model (2.0.77). All other entries are dependency bumps only.

#### `@ai-sdk/cohere` — `3.0.54` → `3.0.64` (patch)
- Preserve complete raw usage objects (3.0.59); dead-code lint enablement (3.0.64); remaining entries dependency bumps.

#### `@ai-sdk/deepinfra` — `2.0.71` → `2.0.82` (patch)
- Enable structured outputs to forward `response_format` json_schema (2.0.75); dead-code lint chore (2.0.82); remaining entries dependency bumps.

#### `@ai-sdk/groq` — `3.0.59` → `3.0.69` (patch)
- Preserve DeepSeek reasoning streams across empty tool-call deltas (3.0.66); prevent negative text output token counts when reasoning tokens are reported (3.0.62).

#### `@ai-sdk/mistral` — `3.0.57` → `3.0.67` (patch)
- Support incremental streaming tool calls (3.0.59); preserve complete Mistral chat usage objects in raw usage metadata (3.0.63).

#### `@ai-sdk/perplexity` — `3.0.53` → `3.0.63` (patch)
- Preserve complete raw chat usage objects (3.0.59); treat Perplexity reasoning tokens as separate from completion tokens to prevent negative text-output counts (3.0.56).

#### `@ai-sdk/togetherai` — `2.0.73` → `2.0.84` (patch)
- No provider-specific fixes — every entry is a dependency bump; 2.0.84 only adds the dead-code lint chore.

#### `@ai-sdk/vercel` — `2.0.69` → `2.0.80` (patch)
- No provider-specific fixes — all entries are dependency bumps (`provider-utils` 4.0.46→4.0.54, `openai-compatible` 2.0.68→2.0.78).

#### `@ai-sdk/xai` — `3.0.121` → `3.0.136` (patch)
- Add grok 4.7 model ID (3.0.134); preserve `additionalProperties: false` in tool schemas (3.0.133); preserve `web_search` action (query, sources, open_page) in responses tool results (3.0.129); preserve complete xAI Responses + Chat Completions usage objects (3.0.127); report image moderation blocks as content policy errors (3.0.125); preserve DeepSeek reasoning streams across empty tool-call deltas (3.0.132).

### Third-party providers

#### `gitlab-ai-provider` — `6.12.1` → `6.18.0` (minor)
- 6.13.0 add Claude Fable 5.1 mappings; 6.14.0 configurable reasoning controls; 6.15.0 add GPT-6 Astra; 6.15.1 fix Agent Platform model discovery (project scoping / stale workflow refs); 6.16.0 add Claude Opus 5.5; 6.17.0 scope workflow discovery cache by optional `cacheKey`; 6.17.1 fix release build version injection; 6.18.0 add GPT-6 Sol/Luna mappings.
- Repo: https://gitlab.com/vglafirov/gitlab-ai-provider

---

## Dependencies at latest same-major (NO upgrade)

| Package | Current | Note |
| --- | --- | --- |
| `@openrouter/ai-sdk-provider` | `2.10.0` | 2.x line ends at 2.10.0; `latest` = 3.1.0 is a **major** (out of scope). Repo: https://github.com/OpenRouterTeam/ai-sdk-provider |
| `ai-gateway-provider` | `3.2.0` | 3.x line ends at 3.2.0; `latest` = 4.0.1 is a **major** (out of scope). Repo: https://github.com/cloudflare/ai |
| `venice-ai-sdk-provider` | `2.1.1` | Already the highest published version (`latest` = 2.1.1). Repo: https://github.com/dpuyosa/venice-ai-sdk-provider |

---

## Where to pin the changes

- **`ai`** is a **catalog** entry in the **root `package.json`** (`"ai": "6.0.246"`). Editing the catalog propagates to every workspace package that references `catalog:`. (All three core packages `ai`, `@ai-sdk/provider`, `@ai-sdk/provider-utils` are pinned directly in `packages/opencode/package.json` — note `provider`/`provider-utils` are **not** in the catalog.)
- The `@ai-sdk/*` provider packages and the third-party providers are pinned directly in **`packages/opencode/package.json`**.
- After applying: `bun install`, then `bun run --cwd packages/opencode typecheck` to catch export/type changes, and re-run the AI SDK-related tests.

## Changelog URL patterns

- vercel/ai v6 line (most `@ai-sdk/*` + `ai`): `https://github.com/vercel/ai/blob/@ai-sdk/<name>@<target>/packages/<name>/CHANGELOG.md` (or the `release-v6.0` branch). The `main`-branch changelogs only cover the newest major.
- Releases feed: https://github.com/vercel/ai/releases
- npm pages: `https://www.npmjs.com/package/<pkg>`

## Suggested upgrade order

1. `@ai-sdk/provider-utils` → `4.0.54` (foundation; nearly every provider consumes it)
2. `@ai-sdk/provider` → `3.0.17`, then `ai` → `6.0.292` (core)
3. Behavioral providers: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/amazon-bedrock`, `@ai-sdk/azure`, `@ai-sdk/gateway`, `@ai-sdk/xai`
4. Remaining providers (mostly dependency propagation): `@ai-sdk/google-vertex`, `@ai-sdk/openai-compatible`, `@ai-sdk/alibaba`, `@ai-sdk/groq`, `@ai-sdk/mistral`, `@ai-sdk/perplexity`, `@ai-sdk/cohere`, `@ai-sdk/deepinfra`, `@ai-sdk/cerebras`, `@ai-sdk/togetherai`, `@ai-sdk/vercel`
5. Third-party: `gitlab-ai-provider` → `6.18.0`

---

## Method & uncertainty

- Version targets were read live from npm (`npm view <pkg> dist-tags --json`, `npm view <pkg> versions --json`) and cross-checked with the repo's read-only `bun run script/check-updates.ts`. The checker matched the registry for every cross-checked package.
- Change notes were extracted from the package `CHANGELOG.md` files filtered to the inclusive `(current, target]` range; entries consisting only of dependency bumps are marked as such.
- No files were modified, and no install/upgrade command was run.
