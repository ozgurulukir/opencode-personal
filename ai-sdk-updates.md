# AI SDK Dependency Upgrade Report

Generated: 2026-07-29  
Scope: Minor and patch version upgrades only (no major version changes).

---

## Summary

| Package | Current | Latest Minor/Patch | Status |
|---------|---------|-------------------|--------|
| `ai` | 6.0.224 | **6.0.238** | ✅ 14 patch releases |
| `@ai-sdk/openai` | 3.0.84 | **3.0.90** | ✅ 6 patch releases |
| `@ai-sdk/anthropic` | 3.0.96 | **3.0.103** | ✅ 7 patch releases |
| `@ai-sdk/google` | 3.0.91 | **3.0.103** | ✅ 12 patch releases |
| `@ai-sdk/google-vertex` | 4.0.159 | **4.0.174** | ✅ 15 patch releases |
| `@ai-sdk/amazon-bedrock` | 4.0.133 | **4.0.144** | ✅ 11 patch releases |
| `@ai-sdk/azure` | 3.0.88 | **3.0.95** | ✅ 7 patch releases |
| `@ai-sdk/xai` | 3.0.106 | **3.0.113** | ✅ 7 patch releases |
| `@ai-sdk/mistral` | 3.0.48 | **3.0.53** | ✅ 5 patch releases |
| `@ai-sdk/openai-compatible` | 2.0.59 | **2.0.63** | ✅ 4 patch releases |
| `@ai-sdk/togetherai` | 2.0.64 | **2.0.69** | ✅ 5 patch releases |
| `@ai-sdk/gateway` | 3.0.148 | **3.0.160** | ✅ 12 patch releases |
| `@ai-sdk/provider-utils` | 4.0.38 | **4.0.41** | ✅ 3 patch releases |
| `@ai-sdk/cerebras` | 2.0.65 | **2.0.69** | ⚠️ Dependency bumps only |
| `@ai-sdk/cohere` | 3.0.47 | **3.0.50** | ⚠️ Dependency bumps only |
| `@ai-sdk/deepinfra` | 2.0.63 | **2.0.67** | ⚠️ Dependency bumps only |
| `@ai-sdk/perplexity` | 3.0.45 | **3.0.48** | ⚠️ Dependency bumps only |
| `@ai-sdk/vercel` | 2.0.61 | **2.0.65** | ⚠️ Dependency bumps only |
| `@ai-sdk/alibaba` | 1.0.37 | **1.0.41** | ⚠️ Dependency bumps only |
| `gitlab-ai-provider` | 6.10.1 | **6.12.1** | ✅ 2 minor + 1 patch |
| `@openrouter/ai-sdk-provider` | 2.10.0 | **2.10.0** | ⛔ Already latest (3.0.0 is major) |
| `@ai-sdk/provider` | 3.0.14 | **3.0.14** | ⛔ Already latest (4.0.4 is major) |
| `ai-gateway-provider` | 3.2.0 | **3.2.0** | ⛔ Already latest (4.0.0 is major) |
| `venice-ai-sdk-provider` | 2.1.1 | **2.1.1** | ⛔ Already latest |

---

## Detailed Findings

### `ai` — 6.0.224 → 6.0.238

**Changelog:** https://github.com/vercel/ai/blob/release-v6.0/packages/ai/CHANGELOG.md

**Key changes (14 patch releases):**
- Fixed chat `onFinish` handling when overlapping requests clear the active response before a resume stream finishes
- Fixed `onInputStart` not being called before `onInputAvailable` during non-streaming tool calls
- Fixed tools excluded by `activeTools` still being parsed/executed
- Fixed provider options being lost when combining consecutive tool messages
- Fixed MP4 audio detection during transcription by reading the ftyp box correctly
- Fixed tool parts being overwritten when tool call IDs repeat across steps
- Fixed unbounded media-type sniffing decode for ID3-prefixed input, preventing O(N) memory blowups
- Fixed synthesizing client tool errors for invalid provider-executed tool calls
- Fixed validated Node.js downloads reaching private/internal services via DNS rebinding by pinning resolved addresses
- Allowed validating assistant UI messages with empty parts so persisted errored responses remain loadable
- Prevented pending tool executions from enqueueing results after a model stream error closes the result stream
- Allowed UI message chunks to include fields added by newer server versions
- Propagated abort reasons when generation is cancelled during tool execution
- Returned response piping promises so callers can catch stream read/write errors
- Added support for overriding model call settings for individual `prepareStep` invocations
- Preserved provider metadata from empty text deltas in `streamText`

---

### `@ai-sdk/openai` — 3.0.84 → 3.0.90

**Changelog:** https://github.com/vercel/ai/blob/main/packages/openai/CHANGELOG.md

**Key changes (6 patch releases):**
- Updated `@ai-sdk/provider-utils` to `4.0.39` → `4.0.41`
- Preserved stored tool search output item IDs from provider metadata
- Applied reasoning, service tier, and image defaults to recognizable future OpenAI model family versions
- Added blocked domain filters to the OpenAI and Azure Responses API web search tools

---

### `@ai-sdk/anthropic` — 3.0.96 → 3.0.103

**Changelog:** https://github.com/vercel/ai/releases

**Key changes (7 patch releases):**
- Updated `@ai-sdk/provider-utils` to `4.0.39` → `4.0.41`
- Preserved web search citations when replaying assistant messages
- Sanitized unsupported JSON Schema constraints in native Anthropic structured output
- Warned when parallel tool use is requested with JSON tool structured output
- Warned when an unknown model uses the default 4096 max output token limit
- Used current-generation capability defaults for unrecognized Claude model IDs, while retaining conservative defaults for legacy Claude and non-Claude models
- **New:** Support fallbacks `'default'` mode for safety classifier refusals (adds `server-side-fallback-2026-07-01` beta)
- **New:** Support mid-conversation tool changes via `toolChanges` system message provider option (adds `mid-conversation-tool-changes-2026-07-01` beta)
- **New:** Added `claude-opus-5` model ID with frontier-tier capabilities (128k output tokens, structured output, adaptive thinking, xhigh effort, sampling parameter rejection)
- Reported thinking tokens as reasoning token usage

---

### `@ai-sdk/google` — 3.0.91 → 3.0.103

**Changelog:** https://github.com/vercel/ai/releases

**Key changes (12 patch releases):**
- Updated `@ai-sdk/provider-utils` to `4.0.39` → `4.0.41`
- `google.interactions` agent requests now support additional tools, including `file_search`
- Forwarded Vertex-only `imageConfig` options (`personGeneration`, `prominentPeople`, `imageOutputOptions`)
- Associated multiple code execution results with their corresponding tool call
- Surfaced Gemini `responseId` as `response-metadata` in streams and `response.id` in generate responses
- **New models:** `gemini-3.6-flash` and `gemini-3.5-flash-lite`
- Avoided missing thought-signature warnings and skip-validator injection for valid unsigned Gemini 3 parallel function calls in the same model response
- Default unknown Gemini model IDs to the newest supported capabilities
- Omitted unsupported function call IDs
- Forwarded `topK` through Google Interactions requests; warned when unsupported frequency or presence penalties are provided

---

### `@ai-sdk/google-vertex` — 4.0.159 → 4.0.174

**Changelog:** https://github.com/vercel/ai/releases/tag/%40ai-sdk%2Fgoogle-vertex%404.0.174

**Key changes (15 patch releases):**
- Support video (not just image) reference inputs in `inputReferences` for reference-to-video generation
- Added `gemini-3.6-flash` and `gemini-3.5-flash-lite` models
- Default unknown Gemini model IDs to the newest supported capabilities
- Allow `google.interactions` agent requests to include supported tools, including `file_search`
- Anthropic: support fallbacks `default` mode; support mid-conversation tool changes; added `claude-opus-5` model id
- Fixed Google tool result conversion to send file data as inline data instead of JSON text on the legacy tool-result path
- Forwarded Vertex-only `imageConfig` options (`personGeneration`, `prominentPeople`, `imageOutputOptions`)
- Associated multiple code execution results with their tool call
- Surfaced Gemini `responseId` as `response-metadata` (stream) and `response.id` (generate)
- Avoided missing thought-signature warnings and skip-validator injection for valid unsigned Gemini 3 parallel function calls
- Omitted unsupported function call IDs
- Preserved web search citations when replaying assistant messages
- Warned when parallel tool use is requested with JSON tool structured output
- Used current-generation capability defaults for unrecognized Claude model IDs
- Reported thinking tokens as reasoning token usage
- Preserved structured error data from chat completion SSE streams
- Called `onInputStart` before `onInputAvailable` during non-streaming tool calls
- Prevented validated downloads on Node.js from reaching private/internal services through DNS aliases or DNS rebinding

---

### `@ai-sdk/amazon-bedrock` — 4.0.133 → 4.0.144

**Changelog:** https://github.com/vercel/ai/blob/main/packages/amazon-bedrock/CHANGELOG.md

**Key changes (11 patch releases):**
- Translated `eager_input_streaming` into the fine-grained-tool-streaming beta for Anthropic models
- Avoided unreliable synthetic response tools when structured output is combined with tools on Bedrock Claude Opus 4.7 and 4.8
- **New:** Returned Bedrock Converse request bodies from language model generation and streaming calls
- Supported application inference profile ARNs
- Sanitized unsupported JSON Schema constraints in native Anthropic structured output; encoded slashes in ARN model IDs for Converse requests
- **New:** Passed through `s3://` image URLs to Amazon Bedrock Converse as S3 image sources instead of downloading them
- Sanitized invalid characters in replayed tool call names before sending conversation history
- Used current-generation capability defaults for unrecognized Claude model IDs while retaining conservative defaults for legacy Claude and non-Claude models
- Omitted tool `strict` and `output_config.format` for Claude models that Bedrock rejects
- Updated dependencies (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/provider-utils`)

---

### `@ai-sdk/azure` — 3.0.88 → 3.0.95

**Changelog:** https://github.com/vercel/ai/blob/main/packages/azure/CHANGELOG.md

**Key changes (7 patch releases):**
- Updated `@ai-sdk/provider-utils` to `4.0.39` → `4.0.41`
- Updated `@ai-sdk/openai` to `3.0.85` → `3.0.90`
- Updated `@ai-sdk/deepseek` to `2.0.48` → `2.0.51`
- **New:** Added blocked domain filters to the OpenAI and Azure Responses API web search tools
- **Bug fix:** Azure DeepSeek structured output no longer returns JSON in reasoning with empty text

---

### `@ai-sdk/xai` — 3.0.106 → 3.0.113

**Changelog:** https://github.com/vercel/ai/blob/@ai-sdk/xai@3.0.113/packages/xai/CHANGELOG.md

**Key changes (7 patch releases):**
- **New:** Support end-user identifiers for video generation and editing
- **Bug fix:** Handle empty HTTP 202 responses while polling videos
- **Bug fix:** Preserve images in Responses API tool results
- **Behavior change:** Warn when xAI Responses models ignore unsupported sampling settings
- Updated dependencies (`@ai-sdk/provider-utils`, `@ai-sdk/openai-compatible`)

---

### `@ai-sdk/mistral` — 3.0.48 → 3.0.53

**Changelog:** https://github.com/vercel/ai/releases/tag/%40ai-sdk%2Fmistral%403.0.53

**Key changes (5 patch releases):**
- Updated `@ai-sdk/provider-utils` to `4.0.39` → `4.0.41`
- **New:** Non-streaming Voxtral text-to-speech generation with saved voice IDs and one-off reference audio
- **Bug fix:** Preserve reasoning in multi-turn conversations

---

### `@ai-sdk/openai-compatible` — 2.0.59 → 2.0.63

**Changelog:** https://github.com/vercel/ai/blob/main/packages/openai-compatible/CHANGELOG.md

**Key changes (4 patch releases):**
- **Bug fix:** OpenAI-compatible chat SSE errors now preserve structured error fields instead of discarding them and exposing only the message string
  - Changed `chunk.value.error.message` → `chunk.value.error` in `openai-compatible-chat-language-model.ts`
  - Updated test to verify structured error objects (e.g., `{ code, message }`) are passed through correctly
- Updated `@ai-sdk/provider-utils` to `4.0.41`

---

### `@ai-sdk/togetherai` — 2.0.64 → 2.0.69

**Changelog:** https://github.com/vercel/ai/blob/main/packages/togetherai/CHANGELOG.md

**Key changes (5 patch releases):**
- **New:** Enabled `includeUsage` for TogetherAI so streaming responses report token usage
- Updated dependencies (`@ai-sdk/provider-utils` and `@ai-sdk/openai-compatible` patch bumps)

---

### `@ai-sdk/gateway` — 3.0.148 → 3.0.160

**Changelog:** https://github.com/vercel/ai/blob/main/packages/gateway/CHANGELOG.md

**Key changes (12 patch releases):**
- No detailed per-version changelog entries are published for `3.0.149`–`3.0.160` in the package's own `CHANGELOG.md`.
- The gateway package's documented changelog ends at `3.0.66`.
- Versions `3.0.67` through `3.0.160` appear to be automated dependency-sync releases in the `vercel/ai` monorepo.
- Note: version `3.0.113` is missing from the npm release history (skipped/yanked).

---

### `@ai-sdk/provider-utils` — 4.0.38 → 4.0.41

**Changelog:** https://github.com/vercel/ai/releases/tag/%40ai-sdk/provider-utils%404.0.41

**Key changes (3 patch releases):**
- **4.0.39:** Accept callable Standard Schema validators that do not provide JSON Schema conversion
- **4.0.40:** Fix tool input lifecycle ordering — `onInputStart` now fires before `onInputAvailable` for non-streaming tool calls
- **4.0.41:** Security fix — prevent DNS alias / DNS rebinding SSRF in validated downloads by validating and pinning resolved addresses before opening a socket

---

### `@ai-sdk/cerebras` — 2.0.65 → 2.0.69

**Changelog:** https://github.com/vercel/ai/releases/tag/%40ai-sdk%2Fcerebras%402.0.69

**Key changes (4 patch releases):**
- All four releases are automated dependency-bump patches in the Vercel AI SDK monorepo.
- No code changes were made to the `@ai-sdk/cerebras` package itself between 2.0.65 and 2.0.69.
- Updated `@ai-sdk/provider-utils` to `4.0.39` → `4.0.41`
- Updated `@ai-sdk/openai-compatible` to `2.0.60` → `2.0.63`

---

### `@ai-sdk/cohere` — 3.0.47 → 3.0.50

**Changelog:** https://github.com/vercel/ai/blob/main/packages/cohere/CHANGELOG.md

**Key changes (3 patch releases):**
- All three releases are dependency-bump releases only.
- No new features, bug fixes, or breaking changes were introduced in the Cohere provider itself.
- Updated `@ai-sdk/provider-utils` from `4.0.38` → `4.0.41`

---

### `@ai-sdk/deepinfra` — 2.0.63 → 2.0.67

**Changelog:** https://github.com/vercel/ai/blob/main/packages/deepinfra/CHANGELOG.md

**Key changes (4 patch releases):**
- All four releases are patch-level dependency bumps only.
- No deepinfra-specific code changes, bug fixes, or new features were introduced.
- Updated `@ai-sdk/provider-utils` to `4.0.39` → `4.0.41`
- Updated `@ai-sdk/openai-compatible` to `2.0.60` → `2.0.63`

---

### `@ai-sdk/perplexity` — 3.0.45 → 3.0.48

**Changelog:** https://github.com/vercel/ai/releases?q=perplexity

**Key changes (3 patch releases):**
- All three releases are dependency-only bumps (`@ai-sdk/provider-utils`).
- No new features or bug fixes were introduced in the `@ai-sdk/perplexity` package itself.
- Updated `@ai-sdk/provider-utils` from `4.0.38` → `4.0.41`
- The most recent functional fix in this line was **3.0.45** itself: *"Fix Perplexity prompt conversion for file parts with unsupported media types and top-level PDF media types."*

---

### `@ai-sdk/vercel` — 2.0.61 → 2.0.65

**Changelog:** https://github.com/vercel/ai/releases/tag/%40ai-sdk/vercel%402.0.65

**Key changes (4 patch releases):**
- All four releases are dependency-only bumps.
- `@ai-sdk/vercel` itself had no direct code changes.
- Updated `@ai-sdk/provider-utils` to `4.0.39` → `4.0.41`
- Updated `@ai-sdk/openai-compatible` to `2.0.60` → `2.0.63`
- Notable transitive fixes:
  - `provider-utils` 4.0.39: Fix Effect Standard Schema classes failing as message metadata validators
  - `openai-compatible` 2.0.61: Fix chat SSE errors losing structured error fields
  - `provider-utils` 4.0.40: Fix tool input lifecycle ordering
  - `provider-utils` 4.0.41: Security fix — prevent DNS alias / DNS rebinding SSRF

---

### `@ai-sdk/alibaba` — 1.0.37 → 1.0.41

**Changelog:** https://github.com/vercel/ai/blob/main/packages/alibaba/CHANGELOG.md

**Key changes (4 patch releases):**
- All four releases are dependency-only updates.
- No Alibaba-specific code changes or new features.
- Updated `@ai-sdk/provider-utils` to `4.0.39` → `4.0.41`
- Updated `@ai-sdk/openai-compatible` to `2.0.60` → `2.0.63`
- Notable changes already in 1.0.35–1.0.36 (before current version):
  - Added `wan2.7` text-to-video and reference-to-video model support
  - Security fix: prevent streaming tool calls from finalizing on parsable partial JSON

---

### `@ai-sdk/provider` — 3.0.14

**Changelog:** https://github.com/vercel/ai/blob/main/packages/provider/CHANGELOG.md

**Status:** Already on latest minor/patch version. No 3.x upgrades available. Next version is `4.0.4` (major).

---

### `@openrouter/ai-sdk-provider` — 2.10.0

**Changelog:** https://github.com/OpenRouterTeam/ai-sdk-provider/blob/main/CHANGELOG.md

**Status:** Already on latest minor/patch version (`2.10.0`). Next version is `3.0.0` (major).

**Note on 3.0.0 (major, excluded):**
- Switch to dedicated images API for image generation
- Support for Vercel AI SDK v7
- Various bug fixes from `2.9.0`/`2.9.1`

---

### `ai-gateway-provider` — 3.2.0

**Changelog:** https://github.com/cloudflare/ai/blob/main/packages/ai-gateway-provider/CHANGELOG.md

**Status:** Already on latest minor/patch version (`3.2.0`). Next version is `4.0.0` (major).

---

### `venice-ai-sdk-provider` — 2.1.1

**Changelog:** https://www.npmjs.com/package/venice-ai-sdk-provider

**Status:** Already on latest minor/patch version (`2.1.1`). No newer `2.x` releases published.

---

### `gitlab-ai-provider` — 6.10.1 → 6.12.1

**Changelog:** https://gitlab.com/vglafirov/gitlab-ai-provider/-/blob/main/CHANGELOG.md

**Key changes (2 minor + 1 patch releases):**
- **6.11.0:** Added GPT-5.6 model mappings (`duo-chat-gpt-5-6-sol`, `-terra`, `-luna`)
- **6.11.1:** Routed GPT-5.6 models through the Responses API; docs sync for the model mappings table
- **6.12.0:** Added Claude Opus 5 model mappings
- **6.12.1:** Performance: placed Anthropic cache breakpoints on the final two messages

---

## Recommendations

### High-value upgrades (new features or significant bug fixes)

1. **`@ai-sdk/anthropic`** — `claude-opus-5` model support, mid-conversation tool changes, fallbacks mode
2. **`@ai-sdk/google` / `@ai-sdk/google-vertex`** — `gemini-3.6-flash` and `gemini-3.5-flash-lite` models, improved tool-call reliability
3. **`@ai-sdk/amazon-bedrock`** — S3 image URL pass-through, Converse request body exposure, inference profile ARN support
4. **`@ai-sdk/mistral`** — Voxtral text-to-speech generation, reasoning preservation in multi-turn
5. **`gitlab-ai-provider`** — GPT-5.6 and Claude Opus 5 model mappings
6. **`ai`** — Multiple tool execution and streaming fixes, DNS rebinding security fix

### Safe but low-value upgrades (dependency bumps only)

These packages had no provider-specific code changes in the patch releases — only transitive dependency updates:

- `@ai-sdk/cerebras`
- `@ai-sdk/cohere`
- `@ai-sdk/deepinfra`
- `@ai-sdk/perplexity`
- `@ai-sdk/vercel`
- `@ai-sdk/alibaba`
- `@ai-sdk/gateway` (mostly automated dependency-sync releases)

### Already up-to-date

- `@openrouter/ai-sdk-provider` (2.10.0)
- `@ai-sdk/provider` (3.0.14)
- `ai-gateway-provider` (3.2.0)
- `venice-ai-sdk-provider` (2.1.1)
