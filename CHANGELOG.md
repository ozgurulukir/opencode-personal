# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- Characterization tests for `runLoop` control-flow contract (4 scenarios: single text reply, tool-call continuation, infinite-reprompt guard, non-empty assistant entrypoint).
- Regression guard in `test/_hygiene/mock-restore.guard.test.ts` that fails if any future test file adds `mock.module()` without a matching `afterAll(() => mock.restore())`.

### Changed

- Decomposed `session/prompt.ts` from 2146 lines to 374 lines (-83%) by extracting 11 functions into `session/loop/` (deps-object pattern) and 4 pure modules into `session/prompt/` (pure-sibling pattern). All `Effect.fn` span names preserved verbatim.
- Rewrote `v2/AGENTS.md` to describe the actual V2 design (read projection + V1-delegating write facade, by design — not a migration in progress). Removed all `TODO(v2-native)` markers and centralized brand-mismatch casts into `v2ModelToV1Session` / `v2ModelToV1Prompt` helpers.
- Repaired 16 provably-false claims in root `AGENTS.md` (verified against the current tree): corrected counts for `as any` casts, removed references to deleted packages and non-existent types, fixed line-number cross-references, and added a Documentation Integrity rule.

### Removed

- Deleted the frozen/stale v1 SDK generation (`src/gen/`, `client.ts`, `server.ts`), eliminating -7079 lines and the risk of the two generated clients silently drifting. The root `@opencode-ai/sdk` export now promotes v2 exclusively.

### Fixed

- Eliminated `mock.module()` state leakage across 7 test files by adding `afterAll(() => mock.restore())` to all users. Fixes the documented order-dependent failures where tests passed in isolation but failed when run as a suite.
