# _plan/ — Plan Index

`_plan/` holds approved implementation plans and verification write-ups, named `topic-YYYY-MM-DD.md` (date = plan creation date). Each non-finalized plan carries a normalized, dated status block directly under its header; the block is authoritative when it conflicts with older ad-hoc `Status:`/`Durum:` lines in the body. Bodies are preserved as historical provenance — status blocks annotate, never rewrite.

## Status Legend

| Status | Meaning |
| --- | --- |
| ✅ EXECUTED | Work landed; cited commit SHA(s) / PR # verified against the current tree |
| 🟡 PARTIAL | Some items landed; the remaining items are listed in the plan's status block |
| ⬜ PENDING | Planned, not started (no evidence it landed) |
| ⛔ SUPERSEDED | Replaced by a later plan/approach; superseding plan/commit cited |
| ❓ UNVERIFIED | Evidence inconclusive; resolution path stated in the plan |

## All Plans (chronological)

| Plan | Date | Topic | Status | Notes |
| --- | --- | --- | --- | --- |
| [plan-opencode-memory-reduction](./plan-opencode-memory-reduction-2026-08-02.md) | 2026-08-02 | Main-process memory footprint | ✅ EXECUTED | `dc1c307` lazy provider DB + lazy onnxruntime |
| [plan-standards-compliance-bug-fixes](./plan-standards-compliance-bug-fixes-2026-08-04.md) | 2026-08-04 | Skills/permission standards compliance | ✅ EXECUTED | `b796a61`, `3b81949`, `9ca7f1e` |
| [plan-memory-leak-fixes](./plan-memory-leak-fixes-2026-08-05.md) | 2026-08-05 | LSP diagnostic maps + prefetch queue | ✅ EXECUTED | `40ae66a`, `dc88d8c`, `2609257` |
| [max-listeners-fix](./max-listeners-fix-2026-08-10.md) | 2026-08-10 | AbortSignal listener accumulation | ✅ EXECUTED | `cce27b0` combineSignals |
| [diff-wasm-fix](./diff-wasm-fix-2026-08-11.md) | 2026-08-11 | diff-wasm async consumers | ✅ EXECUTED | `d83ad7c`, `aa27a80`, `547bf2d` |
| [fix-codebase-review-issues](./fix-codebase-review-issues-2026-08-11.md) | 2026-08-11 | 8 security/correctness review issues | ✅ EXECUTED | `aa27a80`, PR #138 |
| [review-fixes](./review-fixes-2026-08-11.md) | 2026-08-11 | 13 review fixes across 8 files | ✅ EXECUTED | `547bf2d` + `aa27a80` |
| [subagent-fixes](./subagent-fixes-2026-08-11.md) | 2026-08-11 | 9 subagent implementation issues | ✅ EXECUTED | `2388c2a`, PR #103 |
| [lsp-fixes](./lsp-fixes-2026-08-12.md) | 2026-08-12 | LSP LRU eviction + retry backoff | ✅ EXECUTED | `5f52117`, `40ae66a`, `d60f0b7` |
| [subagent-fixes](./subagent-fixes-2026-08-12.md) | 2026-08-12 | V2 subagent parity + dead code | ✅ EXECUTED | `649e9d9`; item 6 resolved not-applicable — the `subagent-data.ts:782` ternary is reachable and load-bearing, not dead (`cli/cmd/run/AGENTS.md` documents it) |
| [app-typecheck-fixes](./app-typecheck-fixes-2026-08-13.md) | 2026-08-13 | 12 app typecheck errors after SDK regen | ✅ EXECUTED | `4f1fe2f` |
| [fix-review-findings](./fix-review-findings-2026-08-13.md) | 2026-08-13 | 6 tool-layer review findings | ✅ EXECUTED | `eacd296`, `547bf2d`, PR #112 |
| [llm-request-timeout-fix](./llm-request-timeout-fix-2026-08-13.md) | 2026-08-13 | Bound hung provider LLM requests | ✅ EXECUTED | `7e9466e` |
| [nested-subagent-permission-hang](./nested-subagent-permission-hang-2026-08-13.md) | 2026-08-13 | Depth 2+ subagent permission ask hang | ✅ EXECUTED | `f888efc` |
| [sdk-regen-typecheck](./sdk-regen-typecheck-2026-08-13.md) | 2026-08-13 | opencode typecheck after SDK regen | ✅ EXECUTED | `a4e2e8d` |
| [chat-ordering](./chat-ordering-2026-08-14.md) | 2026-08-14 | TUI chat ordering + disappearance | 🟡 PARTIAL | Step 1 landed (`3ac0678`, plan doc `c072db6` → [step1 plan](./chat-ordering-step1-2026-09-23.md)); Step 2a obsolete (TUI 100-cap removed by V2 store rewrite); Step 2b deferred pending product decision Q1; §2.1 TUI Binary.search narrative superseded by V2-backed newest-first store (revised 2026-09-23; rework provenance `bdddf62`, `6da0dc0`) |
| [verify-chat-message-drop](./verify-chat-message-drop-2026-08-14.md) | 2026-08-14 | Proof tests A/B for message drop | ⬜ PENDING | Neither test file exists (re-verified 2026-09-23); Test A premise current; Test B partially superseded by the V2 newest-first store (core GlobalBus-drop hypothesis survives) |
| [sse-graceful-retry](./sse-graceful-retry-2026-08-28.md) | 2026-08-28 | SSE reconnect instead of fatal fault | ✅ EXECUTED | PR #119 → `1795d16` |
| [v1-v2-synthesis-phase-1-2](./v1-v2-synthesis-phase-1-2-2026-09-06.md) | 2026-09-06 | Brands + event system | ✅ EXECUTED | `cb7fbd9` + descendants |
| [v1-v2-synthesis-phase-3](./v1-v2-synthesis-phase-3-2026-09-06.md) | 2026-09-06 | HTTP API unification | ✅ EXECUTED | `cb7fbd9`..`d633008` (3e partial by design) |
| [v1-v2-synthesis-phase-4](./v1-v2-synthesis-phase-4-2026-09-07.md) | 2026-09-07 | TUI sync unification + read migration | ✅ EXECUTED | `9d9fe54` |
| [v1-v2-synthesis-phase-5](./v1-v2-synthesis-phase-5-2026-09-07.md) | 2026-09-07 | Message model + engine re-homing | 🟡 PARTIAL | All batches landed (`857b145`, `39313b8`); deferred 5f deletions remain (facade anchors re-verified 2026-09-23) |
| [filter-compacted-regression-lock](./filter-compacted-regression-lock-2026-09-15.md) | 2026-09-15 | Regression test + AGENTS.md correction | ⬜ PENDING | Tracked in `e54ba95`; PR #139 closed unmerged (risk mitigated); re-verified 2026-09-23 — AGENTS.md stale-anchor confirmed (`:651-652` now declarations; condition at `message-v2.ts:659`, break at `:662`) |
| [acp-terminal-backend-integration](./acp-terminal-backend-integration-2026-09-16.md) | 2026-09-16 | ACP terminal backend for Zed et al | ✅ EXECUTED | `56dd7dd` + 6 follow-ups; Zed smoke test outstanding |
| [fix-code-review-findings](./fix-code-review-findings-2026-09-22.md) | 2026-09-22 | Code review findings (finalized) | ✅ EXECUTED | Finalized; see plan header |
| [verify-arch-review](./verify-arch-review-2026-09-22.md) | 2026-09-22 | Architecture review verification | ✅ EXECUTED | Finalized; see plan header |
| [repo-hygiene](./repo-hygiene-2026-09-22.md) | 2026-09-22 | Repository hygiene | ✅ EXECUTED | Finalized; see plan header |
| [chat-ordering-step1](./chat-ordering-step1-2026-09-23.md) | 2026-09-23 | Step 1 execution plan: id-only message ordering (V1+V2) | ✅ EXECUTED | `3ac0678`; extracted from [chat-ordering](./chat-ordering-2026-08-14.md) |
| [check-updates-hardening](./check-updates-hardening-2026-09-23.md) | 2026-09-23 | Script hardening: catalog/apply/prerelease/boundary | ✅ EXECUTED | `c25068d` |
| [check-updates-hash-prerelease](./check-updates-hash-prerelease-2026-09-23.md) | 2026-09-23 | Hash-aware prerelease ordering (drizzle downgrade fix) | ✅ EXECUTED | `0cb59f1` |
| [dep-bump-tier01](./dep-bump-tier01-2026-09-23.md) | 2026-09-23 | Tier 0/Tier 1 targeted dependency bump (bump-only) | ✅ EXECUTED | `b5fc1f9` |
| [continue-dummy-sessionid](./continue-dummy-sessionid-2026-09-24.md) | 2026-09-24 | `opencode -c` fabricated "dummy" sessionID fix | ✅ EXECUTED | `bece62b` |
| [continue-dummy-sessionid-regression-test](./continue-dummy-sessionid-regression-test-2026-09-24.md) | 2026-09-24 | Regression guard for `opencode -c` dummy sessionID fix | ✅ EXECUTED | `5e2bf46` |
| [remove-unused-deps](./remove-unused-deps-2026-09-25.md) | 2026-09-25 | Unused-dependency removal across 6 manifests (7 batches) | ✅ EXECUTED | 7 manifests + bun.lock; zero source changes |

## Series: v1-v2-synthesis

| Phase | Plan | Status |
| --- | --- | --- |
| 1+2 — Brands + Event System | [phase-1-2](./v1-v2-synthesis-phase-1-2-2026-09-06.md) | ✅ EXECUTED |
| 3 — HTTP API Unification | [phase-3](./v1-v2-synthesis-phase-3-2026-09-06.md) | ✅ EXECUTED (3e partial by design) |
| 4 — TUI Sync + Read Migration | [phase-4](./v1-v2-synthesis-phase-4-2026-09-07.md) | ✅ EXECUTED |
| 5 — Message Model + V1 Deletion | [phase-5](./v1-v2-synthesis-phase-5-2026-09-07.md) | 🟡 PARTIAL (deferred 5f deletions) |

Order: 1+2 → 3 → 4 → 5. Phase 5 supersedes the temporary event-bridge and ACP decisions noted in earlier phases.

## At a Glance

### Active / Pending

- [chat-ordering](./chat-ordering-2026-08-14.md) — Step 1 landed (`3ac0678`); Step 2b deferred pending product decision Q1 (Step 2a obsolete — TUI cap removed by V2 store rewrite)
- [v1-v2-synthesis-phase-5](./v1-v2-synthesis-phase-5-2026-09-07.md) — deferred 5f deletions (V1 compatibility facade; anchors re-verified 2026-09-23)
- [filter-compacted-regression-lock](./filter-compacted-regression-lock-2026-09-15.md) — regression test + AGENTS.md correction (re-verified 2026-09-23, still absent)
- [verify-chat-message-drop](./verify-chat-message-drop-2026-08-14.md) — both proof tests (re-verified 2026-09-23; Test B fixture needs V2-store re-scope)
- ACP: real Zed smoke test (external verification only)

### Executed (for reference)

- [chat-ordering-step1](./chat-ordering-step1-2026-09-23.md) — executed Step 1 execution plan (id-only ordering, V1+V2; landed in `3ac0678`)

The 26 executed non-finalized plans (29 ✅ rows in the table including the 3 finalized, 2 🟡 PARTIAL, 2 ⬜ PENDING) — see the table above; each plan file cites its own landing commits and current `file:line` anchors.

### Superseded / Unverified

- None. No plan was found to be superseded, and no plan required an ❓ UNVERIFIED verdict after git evidence checks.

## Conventions / Maintenance

- The status legend above is normalized on review; status blocks in plan files use the same vocabulary.
- When a plan's status changes, update its status block **in place** (keep the date and evidence current) — do not rewrite the plan body.
- Keep this index table in sync with the plan files: new plan → add a row; status change → update the row's Status + Notes.
- Turkish-language plans keep their original language; status blocks are written in English for grep-ability.
