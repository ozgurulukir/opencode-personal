# AI SDK Dependency Upgrade Report

**Scope:** Minor/patch upgrades only. Major versions are intentionally excluded (the AI SDK ecosystem has moved to `ai@7` / provider `4.x`/`5.x` — those are breaking and out of scope).

**Date:** 2026-08-07
**Source:** `package.json` (root catalog) + `packages/opencode/package.json`
**Changelog source:** [vercel/ai](https://github.com/vercel/ai) monorepo changelogs (fetched at the target git tag for each package).

> **Status: APPLIED** — All upgrades below have been applied to `package.json` + `bun.lock`, `bun install` run, `bun typecheck` passes, and all AI SDK-related tests pass (530 tests across 18 files). No codebase adaptation was required — the patch releases are backward-compatible.

---

## Summary

- **19 of 24** AI SDK dependencies have a same-major upgrade available.
- **5** are already at the latest same-major version (no upgrade).
- The single most impactful change across the whole set is **`@ai-sdk/provider-utils@4.0.42`** (`ee2bf30`), which is a transitive dependency of nearly every provider. Most provider bumps are just "bump provider-utils" — the real behavioral fixes are concentrated in a handful of packages (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/gateway`, `@ai-sdk/groq`, `@ai-sdk/xai`, `@ai-sdk/perplexity`, `@ai-sdk/amazon-bedrock`).

---

## Dependencies WITH an upgrade available

### `ai` — `6.0.238` → `6.0.246`

The core package. 8 patch releases. Notable behavioral fixes:

- **`6.0.245`** — Filter unresolved tool approval requests and tool parts without state when ignoring incomplete tool calls.
- **`6.0.244`** — Preserve preceding assistant messages when regenerating a response.
- **`6.0.243`** — Skip re-validating tool input for terminal output-available UI message parts.
- `6.0.239`–`6.0.246` — mostly transitive bumps of `@ai-sdk/gateway` and `@ai-sdk/provider-utils`.

Changelog: https://github.com/vercel/ai/blob/ai@6.0.246/packages/ai/CHANGELOG.md

### `@ai-sdk/provider-utils` — `4.0.41` → `4.0.42`

- **`4.0.42`** (`ee2bf30`) — fix: prevent Metro from parsing the Node 18 dynamic import fallback. This is the change that cascades into almost every provider bump below.

Changelog: https://github.com/vercel/ai/blob/@ai-sdk/provider-utils@4.0.42/packages/provider-utils/CHANGELOG.md

### `@ai-sdk/anthropic` — `3.0.103` → `3.0.107`

3 patch releases with real fixes:

- **`3.0.106`** (`b74e654`) — Reject spliced Anthropic generations while allowing duplicate message start events for the active message.
- **`3.0.105`** (`0a295e3`) — Preserve Anthropic prompt-cache matches by replaying complete code-execution transcripts in their original wire shape.
- `3.0.104` — bump provider-utils.

Changelog: https://github.com/vercel/ai/blob/@ai-sdk/anthropic@3.0.107/packages/anthropic/CHANGELOG.md

### `@ai-sdk/gateway` — `3.0.160` → `3.0.166`

6 patch releases. Notable:

- **`3.0.162`** (`b28367e`) — feat: add `has` provider option for model capability filtering, supporting `'implicit-caching'` and `'vision'` (image input).
- **`3.0.164`** (`f615718`) — Export `GatewayEmbeddingModelId` and `GatewayImageModelId` from the package entry point.
- `3.0.161`/`3.0.163`/`3.0.165` — backported gateway model settings file updates.

Changelog: https://github.com/vercel/ai/blob/@ai-sdk/gateway@3.0.166/packages/gateway/CHANGELOG.md

### `@ai-sdk/groq` — `3.0.54` → `3.0.56`

- **`3.0.55`** (`ae2812a`) — fix: map word timestamps to transcription segments when segment timestamps are unavailable.
- **`3.0.55`** (`cc3269f`) — Support plain-text responses from Groq transcription models when `responseFormat` is set to `text`.

Changelog: https://github.com/vercel/ai/blob/@ai-sdk/groq@3.0.56/packages/groq/CHANGELOG.md

### `@ai-sdk/xai` — `3.0.113` → `3.0.115`

- **`3.0.114`** (`5d0c5f4`) — fix: video generation no longer hangs while polling status.

Changelog: https://github.com/vercel/ai/blob/@ai-sdk/xai@3.0.115/packages/xai/CHANGELOG.md

### `@ai-sdk/perplexity` — `3.0.48` → `3.0.50`

- **`3.0.49`** (`cbd0fe3`) — feat: add embedding model support.

Changelog: https://github.com/vercel/ai/blob/@ai-sdk/perplexity@3.0.50/packages/perplexity/CHANGELOG.md

### `@ai-sdk/amazon-bedrock` — `4.0.144` → `4.0.148`

- **`4.0.145`** (`6077642`) — fix: warn when unsupported strict tools are omitted and align structured output fallback routing.
- `4.0.146`/`4.0.147` — bump `@ai-sdk/anthropic` (inherits the prompt-cache + spliced-generation fixes).

Changelog: https://github.com/vercel/ai/blob/@ai-sdk/amazon-bedrock@4.0.148/packages/amazon-bedrock/CHANGELOG.md

### `@ai-sdk/google-vertex` — `4.0.174` → `4.0.177`

- `4.0.175`/`4.0.176` — bump `@ai-sdk/anthropic` (inherits prompt-cache + spliced-generation fixes).
- `4.0.177` — bump provider-utils.

Changelog: https://github.com/vercel/ai/blob/@ai-sdk/google-vertex@4.0.177/packages/google-vertex/CHANGELOG.md

### Transitive-only bumps (no own behavioral change — just `@ai-sdk/provider-utils@4.0.42` and/or `@ai-sdk/openai-compatible@2.0.64`)

| Package | Current | Target |
| --- | --- | --- |
| `@ai-sdk/openai` | `3.0.90` | `3.0.91` |
| `@ai-sdk/azure` | `3.0.95` | `3.0.96` |
| `@ai-sdk/google` | `3.0.103` | `3.0.104` |
| `@ai-sdk/mistral` | `3.0.53` | `3.0.54` |
| `@ai-sdk/cohere` | `3.0.50` | `3.0.51` |
| `@ai-sdk/openai-compatible` | `2.0.63` | `2.0.64` |
| `@ai-sdk/cerebras` | `2.0.69` | `2.0.70` |
| `@ai-sdk/deepinfra` | `2.0.67` | `2.0.68` |
| `@ai-sdk/togetherai` | `2.0.69` | `2.0.70` |
| `@ai-sdk/alibaba` | `1.0.41` | `1.0.42` |
| `@ai-sdk/vercel` | `2.0.65` | `2.0.66` |

These are safe, low-risk bumps. Their changelogs only list `Updated dependencies` entries. Changelog URLs follow the pattern:
`https://github.com/vercel/ai/blob/@ai-sdk/<name>@<target>/packages/<name>/CHANGELOG.md`

---

## Dependencies at latest same-major (NO upgrade)

| Package | Current | Note |
| --- | --- | --- |
| `@ai-sdk/provider` | `3.0.14` | Latest 3.x. Next is `4.0.6` (major). |
| `@openrouter/ai-sdk-provider` | `2.10.0` | Latest 2.x. Next is `3.0.0` (major). |
| `ai-gateway-provider` | `3.2.0` | Latest 3.x. Next is `4.0.0` (major). |
| `gitlab-ai-provider` | `6.12.1` | Latest 6.x. No newer version. |
| `venice-ai-sdk-provider` | `2.1.1` | Latest 2.x. No newer version. |

---

## Notes / caveats

- **`ai` is pinned via `catalog:`** in the root `package.json` (`"ai": "6.0.238"`). Upgrading it means editing the catalog entry, which propagates to all workspace packages that reference `catalog:`.
- The `@ai-sdk/*` provider packages are **not** in the catalog — they're pinned directly in `packages/opencode/package.json`. Bump them there.
- **`@ai-sdk/provider-utils@4.0.42`** is the highest-leverage single bump: it's a transitive dep of nearly every provider, and its `ee2bf30` fix (Metro/Node 18 dynamic import) is the reason most providers have a new patch.
- The `@ai-sdk/anthropic` fixes (`0a295e3` prompt-cache replay, `b74e654` spliced-generation rejection) are the most behaviorally significant provider changes — they affect streaming correctness and prompt-cache hit rates. They also propagate to `@ai-sdk/amazon-bedrock` and `@ai-sdk/google-vertex`.
- **No major-version upgrades are included** per the constraint. The ecosystem's next major (`ai@7`, providers `4.x`/`5.x`) is a breaking change and would need separate evaluation.
- After applying, run `bun run --cwd packages/opencode typecheck` to catch any breaking changes (some packages silently remove/rename exports in minor versions).

## Suggested upgrade order

1. `@ai-sdk/provider-utils` → `4.0.42` (foundation)
2. `@ai-sdk/anthropic` → `3.0.107` (behavioral fixes)
3. `ai` → `6.0.246` (core fixes)
4. `@ai-sdk/gateway`, `@ai-sdk/groq`, `@ai-sdk/xai`, `@ai-sdk/perplexity`, `@ai-sdk/amazon-bedrock` (own behavioral changes)
5. All remaining transitive-only bumps
