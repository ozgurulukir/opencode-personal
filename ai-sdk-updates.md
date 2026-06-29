# AI SDK Dependency Upgrade Report

Generated from `package.json` and `packages/opencode/package.json`.
**Scope:** minor/patch upgrades only — no major version changes.
**Source of truth:** npm registry `ai-v6` dist-tag (same major version line).

---

## Summary Table

| Package                       | Current | Latest      | Changelog                                                                                                                                                           |
| ----------------------------- | ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai`                          | 6.0.168 | **6.0.208** | [vercel/ai CHANGELOG](https://github.com/vercel/ai/blob/main/packages/ai/CHANGELOG.md)                                                                              |
| `@ai-sdk/provider`            | 3.0.8   | **3.0.10**  | [vercel/ai provider CHANGELOG](https://github.com/vercel/ai/blob/main/packages/provider/CHANGELOG.md)                                                               |
| `@ai-sdk/provider-utils`      | 4.0.23  | **4.0.29**  | [vercel/ai provider-utils CHANGELOG](https://github.com/vercel/ai/blob/main/packages/provider-utils/CHANGELOG.md)                                                   |
| `@ai-sdk/openai`              | 3.0.53  | **3.0.73**  | [vercel/ai openai CHANGELOG](https://github.com/vercel/ai/blob/main/packages/openai/CHANGELOG.md)                                                                   |
| `@ai-sdk/anthropic`           | 3.0.71  | **3.0.89**  | [vercel/ai anthropic CHANGELOG](https://github.com/vercel/ai/blob/main/packages/anthropic/CHANGELOG.md)                                                             |
| `@ai-sdk/google`              | 3.0.63  | **3.0.86**  | [vercel/ai google CHANGELOG](https://github.com/vercel/ai/blob/main/packages/google/CHANGELOG.md)                                                                   |
| `@ai-sdk/google-vertex`       | 4.0.112 | **4.0.152** | [vercel/ai google-vertex CHANGELOG](https://github.com/vercel/ai/blob/main/packages/google-vertex/CHANGELOG.md)                                                     |
| `@ai-sdk/azure`               | 3.0.49  | **3.0.80**  | [vercel/ai azure CHANGELOG](https://github.com/vercel/ai/blob/main/packages/azure/CHANGELOG.md)                                                                     |
| `@ai-sdk/xai`                 | 3.0.82  | **3.0.100** | [vercel/ai xai CHANGELOG](https://github.com/vercel/ai/blob/main/packages/xai/CHANGELOG.md)                                                                         |
| `@ai-sdk/gateway`             | 3.0.104 | **3.0.139** | [vercel/ai gateway CHANGELOG](https://github.com/vercel/ai/blob/main/packages/gateway/CHANGELOG.md)                                                                 |
| `@ai-sdk/groq`                | 3.0.31  | **3.0.45**  | [vercel/ai groq CHANGELOG](https://github.com/vercel/ai/blob/main/packages/groq/CHANGELOG.md)                                                                       |
| `@ai-sdk/mistral`             | 3.0.27  | **3.0.43**  | [vercel/ai mistral CHANGELOG](https://github.com/vercel/ai/blob/main/packages/mistral/CHANGELOG.md)                                                                 |
| `@ai-sdk/cerebras`            | 2.0.41  | **2.0.60**  | [vercel/ai cerebras CHANGELOG](https://github.com/vercel/ai/blob/main/packages/cerebras/CHANGELOG.md)                                                               |
| `@ai-sdk/cohere`              | 3.0.27  | **3.0.42**  | [vercel/ai cohere CHANGELOG](https://github.com/vercel/ai/blob/main/packages/cohere/CHANGELOG.md)                                                                   |
| `@ai-sdk/togetherai`          | 2.0.41  | **2.0.59**  | [vercel/ai togetherai CHANGELOG](https://github.com/vercel/ai/blob/main/packages/togetherai/CHANGELOG.md)                                                           |
| `@ai-sdk/perplexity`          | 3.0.26  | **3.0.39**  | [vercel/ai perplexity CHANGELOG](https://github.com/vercel/ai/blob/main/packages/perplexity/CHANGELOG.md)                                                           |
| `@ai-sdk/deepinfra`           | 2.0.41  | **2.0.58**  | [vercel/ai deepinfra CHANGELOG](https://github.com/vercel/ai/blob/main/packages/deepinfra/CHANGELOG.md)                                                             |
| `@ai-sdk/alibaba`             | 1.0.17  | **1.0.32**  | [vercel/ai alibaba CHANGELOG](https://github.com/vercel/ai/blob/main/packages/alibaba/CHANGELOG.md)                                                                 |
| `@ai-sdk/vercel`              | 2.0.39  | **2.0.56**  | [vercel/ai vercel CHANGELOG](https://github.com/vercel/ai/blob/main/packages/vercel/CHANGELOG.md)                                                                   |
| `@ai-sdk/openai-compatible`   | 2.0.41  | **2.0.54**  | [vercel/ai openai-compatible CHANGELOG](https://github.com/vercel/ai/blob/main/packages/openai-compatible/CHANGELOG.md)                                             |
| `@openrouter/ai-sdk-provider` | 2.8.1   | **2.10.0**  | [CHANGELOG.md](https://github.com/OpenRouterTeam/ai-sdk-provider/blob/master/CHANGELOG.md) / [Releases](https://github.com/OpenRouterTeam/ai-sdk-provider/releases) |
| `ai-gateway-provider`         | 3.1.2   | **3.1.3**   | [cloudflare/ai CHANGELOG](https://github.com/cloudflare/ai/blob/main/packages/ai-gateway-provider/CHANGELOG.md)                                                     |
| `gitlab-ai-provider`          | 6.6.0   | **6.9.3**   | [CHANGELOG.md](https://gitlab.com/vglafirov/gitlab-ai-provider/-/blob/main/CHANGELOG.md)                                                                            |
| `venice-ai-sdk-provider`      | 2.0.1   | **2.1.1**   | [Commit history](https://github.com/dpuyosa/venice-ai-sdk-provider/commits/v6)                                                                                      |
| `@modelcontextprotocol/sdk`   | 1.27.1  | **1.29.0**  | [typescript-sdk releases](https://github.com/modelcontextprotocol/typescript-sdk/releases)                                                                          |

> **Note on `ai` package:** npm's `latest` dist-tag now points to 7.0.4. Version 6.0.208 is the latest in the 6.x line. Use `ai@6` or `ai@^6.0.0` to stay on 6.x.

---

## Notable Changes by Package

### `ai` — 6.0.168 → 6.0.208 (+40 patch versions)

- 🔒 **Security — SSRF guard hardened** (`375fdd7`): `downloadBlob`/`download` now validate after redirects (manual redirect follow + re-validation per hop), strip trailing dots on hostnames, decode IPv6-embedded private addresses; fail-closed on opaque redirects in browsers.
- 🔒 **Security — tool approval replay hardened** (`bae5e2b`): `generateText`/`streamText` re-validate HMAC signature, tool-call input schema, and approval policy before executing replayed approvals; prevents forged assistant messages from executing arbitrary tools.
- 🔒 **Security — prototype pollution guard** (`3295831`): stream part IDs hardened against `__proto__`/`constructor` pollution.
- 🔒 **Security — SSRF redirect bypass** (`531251e`): `validateDownloadUrl` now blocks redirect targets before following.
- 🐛 **Fix — error redaction in UI streams** (`f18b08f`): `toUIMessageStream`/`createUIMessageStream` default `onError` now returns `'An error occurred.'` instead of serializing raw server exceptions.
- 🐛 **Fix — `stepMs` timeout now works in `streamText`** (`eeefc3f`): step timer survives until stream finishes.
- ✨ **Feat — experimental Realtime API** (`ce769dd`): `openai.experimental_realtime()`, `google.experimental_realtime()`, `xai.experimental_realtime()` for voice conversations.
- ✨ **Feat — `generateAudio` first-class** (`0416e3e`).
- ✨ **Feat — automatic tool approval** (`fc92055`).

### `@ai-sdk/provider` — 3.0.8 → 3.0.10

- `3.0.10`: Dependency alignment release (bumped `@ai-sdk/provider-utils`); no user-facing changes.

### `@ai-sdk/provider-utils` — 4.0.23 → 4.0.29 (+6 patch versions)

- 🔒 **Security — SSRF fix** (`ad4cfc2`, v4.0.19): `downloadBlob`/`download` now reject private/internal IPs, localhost, and non-HTTP protocols _before_ fetching.
- 🐛 **Fix — unicode escape bypass in `secureJsonParse`** (`824b295`, v4.0.18).
- 🐛 **Fix — Bedrock filename extension stripping** (`08336f1`, v4.0.17).
- ✨ **Feat — 2 GiB download size limit** (`4024a3a`, v4.0.15): `download()`/`downloadBlob()` enforce default `maxBytes`.
- ✨ **Feat — `spawnCommand` for detached sandbox execution** (`6c93e36`).

### `@ai-sdk/openai` — 3.0.53 → 3.0.73 (+20 patch versions)

- ✨ **Feat — GPT-5.4 / GPT-5.4-mini / GPT-5.4-nano model support** (`7afaece`).
- ✨ **Feat — GPT-5.5 chat model IDs** (`d6c79e3`).
- ✨ **Feat — `gpt-5.3-codex` model** (`0c9395b`).
- ✨ **Feat — tool_search tool, native skills, hosted shell, web search `queries` forwarding** (multiple versions).
- 🔒 **Security — streaming tool call finalization** (`45b3d76`): tool call args no longer finalized on parsable partial JSON.
- 🐛 **Fix — `image-url` tool result content in Responses API** (`61bcdb5`).
- 🐛 **Fix — reasoning items skipped when using `previousResponseId`** (`17b5597`).

### `@ai-sdk/anthropic` — 3.0.71 → 3.0.89 (+18 patch versions)

- ✨ **Feat — `advisor` tool** (`8018480`, v3.0.81).
- ✨ **Feat — `web_fetch_20260209` and `web_search_20260209` tool variants** (`56c67d5`).
- ✨ **Feat — eager input streaming for fine-grained tool streaming** (`3fb4e70`).
- ✨ **Feat — `claude-opus-4-8` support** (`e02f041`).
- ✨ **Feat — `claude-fable-5` and `fallbacks` API parameter** (`6b4d325`).
- ✨ **Feat — `code_execution` tool** (`2164cdf`).
- ✨ **Feat — Claude Sonnet 4.6, Opus 4.6 fast mode** (v3.0.45, v3.0.39).
- 🐛 **Fix — encrypted code execution results in multi-turn with web_fetch/web_search** (`7531e72`).
- 🐛 **Fix — compaction_delta streaming null content** (`b094c07`).

### `@ai-sdk/google` — 3.0.63 → 3.0.86 (+23 patches)

- ⭐ **3.0.80 — Critical bug fix:** auto-injects `skip_thought_signature_validator` for Gemini 3 tool-call replays. Without this, Gemini 3 returns HTTP 400 _"Function call is missing a thought_signature"_ when messages are serialized/persisted (e.g. DB-backed `useChat` routes).
- **3.0.75** — Updated Interactions API implementation for upstream breaking changes (May 26 cutover).
- **3.0.70** — Fixed lack of image consistency when using Interactions API in stateless mode.

### `@ai-sdk/google-vertex` — 4.0.112 → 4.0.152 (+40 patches)

- **4.0.140** — Added support for `claude-opus-4-8` via updated `@ai-sdk/anthropic@3.0.81`.
- **4.0.152** — Dependency bump to `provider-utils@4.0.33`, `anthropic@3.0.89`, `google@3.0.86`, `openai-compatible@2.0.54`.

### `@ai-sdk/azure` — 3.0.49 → 3.0.80 (+31 patches)

- Range is primarily dependency-only bumps (`@ai-sdk/openai`, `@ai-sdk/provider-utils`).
- **3.0.80** — Updated to `provider-utils@4.0.33`, `deepseek@2.0.42`, `openai@3.0.77`.

### `@ai-sdk/xai` — 3.0.82 → 3.0.100 (+18 patches)

- ⭐ **3.0.85** — Fixed `additionalProperties` flag emission; **added support for non-image file parts** (PDF, text, CSV) in the Responses API via `input_file` + `file_url` — previously threw `UnsupportedFunctionalityError` for non-image documents.
- **3.0.100** — Dependency bump to `provider-utils@4.0.33`, `openai-compatible@2.0.54`.

### `@ai-sdk/gateway` — 3.0.104 → 3.0.139 (+35 patches)

- ⭐ **3.0.120** — Added `serviceTier: 'flex' | 'priority'` to `GatewayProviderOptions`.
- **3.0.139** — Dependency bump to `provider-utils@4.0.33`.

### `@ai-sdk/groq` — 3.0.31 → 3.0.45

- **3.0.45**: Dependency bump (`@ai-sdk/provider@3.0.12`, `@ai-sdk/provider-utils@4.0.33`).
- Last provider-specific changes in 3.0.25 range: `strict` mode tools fix, `strictJsonSchema` support, `reasoning-end` event fix in streaming.

### `@ai-sdk/mistral` — 3.0.27 → 3.0.43

- **3.0.43**: Dependency bump (`provider-utils@4.0.33`).
- Last provider-specific change: `3.0.4` — updated `reference_ids` type to union of `number` and `string`.

### `@ai-sdk/cerebras` — 2.0.41 → 2.0.60

- **2.0.60**: Dependency bump.
- Last provider-specific change: `2.0.34` — removed deprecated model IDs (`llama-3.3-70b`, `qwen-3-32b`).

### `@ai-sdk/cohere` — 3.0.27 → 3.0.42

- **3.0.42**: Dependency bump.
- Last provider-specific change: `3.0.16` — added `outputDimension` option for Cohere embedding models (256/512/1024/1536).

### `@ai-sdk/togetherai` — 2.0.41 → 2.0.59

- **2.0.59**: Dependency bump (`provider-utils@4.0.33`, `openai-compatible@2.0.54`).
- Last provider-specific change: `2.0.34` — use `TOGETHER_API_KEY` as default env var (`TOGETHER_AI_API_KEY` still supported but deprecated).

### `@ai-sdk/perplexity` — 3.0.26 → 3.0.39

- **3.0.39**: Dependency bump.
- **3.0.0**: `Provider-V3`, `LanguageModelV3`, extended token usage, raw finish reason, PDF support, reasoning tokens.

### `@ai-sdk/deepinfra` — 2.0.41 → 2.0.58

- **2.0.58**: Dependency bump.
- **2.0.29/2.0.30**: Fixed token usage calculation for Gemini/Gemma models.
- **2.0.33**: Added `supportsStructuredOutputs` to provider settings.

### `@ai-sdk/alibaba` — 1.0.17 → 1.0.32

- **1.0.32**: Dependency bump.
- ⭐ **Security fix (transitive from openai-compatible 2.0.33)**: streaming tool call arguments no longer execute on parsable-but-incomplete JSON — critical if using tool calls.

### `@ai-sdk/vercel` — 2.0.39 → 2.0.56

- **2.0.56**: Dependency bump.
- Mostly dependency-alignment; no provider-specific behavioral changes in the 2.x patch range.

### `@ai-sdk/openai-compatible` — 2.0.41 → 2.0.54

- ⭐ **2.0.33** — Fixed base64 string decoding (`fix(openai-compat): decode base64 string data`).
- ⭐ **2.0.20** — Fixed `reasoning_content` inclusion in multi-turn tool call messages.
- **2.0.16** — Accept non-OpenAI provider options.
- **2.0.15** — Consistent camelCase `openaiCompatible` key for providerOptions (kebab-case deprecated).
- **2.0.5** — Changed response schemas from `z.object` to `z.looseObject` for non-standard API compatibility.

### `@openrouter/ai-sdk-provider` — 2.8.1 → 2.10.0

- **2.9.0** — Added `structuredOutputs.strict` opt-out; fixed image URL regex to accept query strings/fragments; fixed duplicate `tool-call` events on trailing-whitespace deltas.
- **2.9.1** — Fixed sending `null` content for tool-only assistant messages.

### `ai-gateway-provider` — 3.1.2 → 3.1.3

- **3.1.3** — Updated dependencies; replaced `tsup` with `tsdown` as build tool.

### `gitlab-ai-provider` — 6.6.0 → 6.9.3

- **6.7.0** — Added GPT-5.5 model mapping.
- **6.7.1** — Fixed Anthropic cache token counting (now includes cache tokens in input total).
- **6.8.0** — Added Claude Opus 4.8 model mapping.
- **6.9.0** — Added Claude Fable 5 model mapping.
- **6.9.3** — Fixed concurrent auth failures caused by token races.

### `venice-ai-sdk-provider` — 2.0.1 → 2.1.1

- **2.0.2** — Added reasoning-enabled field and expanded effort values.
- **2.1.0** — Added metadata extractor and prediction tokens; added reasoning summary, cache retention, and parallel tools support; migrated from Prettier to Biome.
- **2.1.1** — Fixed default `veniceParameters` via schema parse.

### `@modelcontextprotocol/sdk` — 1.27.1 → 1.29.0

- **v1.28.0** — Uses `scopes_supported` from resource metadata by default; defaults to `client_secret_basic`; fixed SSE reconnection timeout cleanup; relaxed loopback port rules per RFC 8252.
- **v1.29.0** — Disallowed null (infinite) requested TTL; added missing `size` field to `ResourceSchema`; added typings exports; fixed `windowsHide` on Windows.

---

## Cross-Package Dependency Shifts

All `@ai-sdk/*` providers share internal dependencies that have also moved:

| Shared Dep                  | Current | Latest | Notes                             |
| --------------------------- | ------- | ------ | --------------------------------- |
| `@ai-sdk/provider`          | 3.0.8   | 3.0.10 | Minimal user-facing changes       |
| `@ai-sdk/provider-utils`    | 4.0.23  | 4.0.29 | SSRF fix, download limits         |
| `@ai-sdk/openai-compatible` | 2.0.41  | 2.0.54 | Base64 fix, reasoning_content fix |

> **Recommendation:** Upgrade all `@ai-sdk/*` packages **together** to avoid version conflicts, since they share `@ai-sdk/provider` and `@ai-sdk/provider-utils` as peer/transitive dependencies.

---

## Critical Fixes to Prioritize

| Package                     | Fix                                  | Impact                                             |
| --------------------------- | ------------------------------------ | -------------------------------------------------- |
| `@ai-sdk/provider-utils`    | SSRF guard (v4.0.19)                 | Security — blocks private/internal IP fetches      |
| `@ai-sdk/google`            | Gemini 3 thought_signature (v3.0.80) | Bug — prevents HTTP 400 on persisted chat messages |
| `@ai-sdk/openai-compatible` | Base64 string decoding (v2.0.33)     | Bug — fixes broken binary data handling            |
| `@ai-sdk/openai`            | Streaming tool call finalization     | Security — prevents partial JSON execution         |
| `ai`                        | Tool approval replay hardening       | Security — prevents forged tool execution          |
