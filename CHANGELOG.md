# Changelog

## [Unreleased]

### Added

- Add `debug skill validate` CLI subcommand, `Skill.allIncludingInvalid()` registry, and `skill.warning` bus events for frontmatter validation ([`b796a61a`](https://github.com/ozgurulukir/opencode-personal/commit/b796a61a))
- Add runLoop characterization tests (4 scenarios) locking agent loop control-flow contract ([`6b4b550f`](https://github.com/ozgurulukir/opencode-personal/commit/6b4b550f))
- Add `afterAll(() => mock.restore())` regression guard across 7 test files to eliminate mock.module leakage ([`596f52a8`](https://github.com/ozgurulukir/opencode-personal/commit/596f52a8))

### Changed

- Consolidate SDK to single v2 generation and delete v1, removing 7,129 lines of frozen client code ([`83304e13`](https://github.com/ozgurulukir/opencode-personal/commit/83304e13))
- Decompose `prompt.ts` from 2,146 to 374 lines by extracting 11 functions into `session/loop/` and 4 pure modules into `session/prompt/` ([`c3355e18`](https://github.com/ozgurulukir/opencode-personal/commit/c3355e18))
- Document V2 session delegation architecture honestly, removing 6 `TODO(v2-native)` markers and centralizing brand-mismatch casts ([`6b91811a`](https://github.com/ozgurulukir/opencode-personal/commit/6b91811a))
- Repair 16 provably-false claims in root `AGENTS.md` against the current tree ([`cbd09fe5`](https://github.com/ozgurulukir/opencode-personal/commit/cbd09fe5))
- Upgrade AI SDK dependencies to latest patch versions (`ai` 6.0.238 → 6.0.246, all `@ai-sdk/*` providers) ([`c51d49e7`](https://github.com/ozgurulukir/opencode-personal/commit/c51d49e7))
- Harmonize and simplify provider/agent/tool prompts, normalizing delta prompts to second-person imperatives and dropping core.txt duplication ([`15c67db3`](https://github.com/ozgurulukir/opencode-personal/commit/15c67db3))
- Replace `findLastIndex` with backward loops in `session-message-updater.ts` fast paths to reduce closure allocation ([`f58a1b64`](https://github.com/ozgurulukir/opencode-personal/commit/f58a1b64))
- Reduce runtime memory footprint via LSP LRU eviction, lazy `models-snapshot` transformation, and dynamic ONNX/WASM imports ([`dc1c307d`](https://github.com/ozgurulukir/opencode-personal/commit/dc1c307d))
- Optimize `trimSessions` array methods to reduce GC pressure on hot path ([`c5ae903b`](https://github.com/ozgurulukir/opencode-personal/commit/c5ae903b))
- Replace chained `.map().filter()` with single loops in `message-part.tsx` reactive hooks ([`8214722b`](https://github.com/ozgurulukir/opencode-personal/commit/8214722b))
- Replace chained `.filter().filter().reduce()` with single loop in `textPartValue` prompt extraction ([`06a25d42`](https://github.com/ozgurulukir/opencode-personal/commit/06a25d42))

### Fixed

- Retry on malformed tool-call stream data by classifying `InvalidResponseDataError` as retryable and buffering deltas until `function.name` is known ([`27b6eee7`](https://github.com/ozgurulukir/opencode-personal/commit/27b6eee7))
- Handle non-existent paths in grep tool with clear early errors and preserve matches on per-file stat failure ([`7e402d42`](https://github.com/ozgurulukir/opencode-personal/commit/7e402d42))
- Resolve undefined `input` in `DialogSelectServer` aria-label ([`6cc421f7`](https://github.com/ozgurulukir/opencode-personal/commit/6cc421f7))
- Prevent double auto-compaction from `filterCompacted` reorder by using `MessageV2.latest()` instead of array position ([`97723f42`](https://github.com/ozgurulukir/opencode-personal/commit/97723f42))
- Fix plugin-lifecycle and websocket test flakiness ([`56c1f895`](https://github.com/ozgurulukir/opencode-personal/commit/56c1f895))

### Security

- Prevent sensitive data leak via `console.error` in TUI plugin runtime error handlers ([`9a73cf92`](https://github.com/ozgurulukir/opencode-personal/commit/9a73cf92))
