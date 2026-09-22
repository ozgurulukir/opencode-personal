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
| [subagent-fixes](./subagent-fixes-2026-08-12.md) | 2026-08-12 | V2 subagent parity + dead code | 🟡 PARTIAL | `649e9d9`; dead ternary at `subagent-data.ts:782` outstanding |
| [app-typecheck-fixes](./app-typecheck-fixes-2026-08-13.md) | 2026-08-13 | 12 app typecheck errors after SDK regen | ✅ EXECUTED | `4f1fe2f` |
| [fix-review-findings](./fix-review-findings-2026-08-13.md) | 2026-08-13 | 6 tool-layer review findings | ✅ EXECUTED | `eacd296`, `547bf2d`, PR #112 |
| [llm-request-timeout-fix](./llm-request-timeout-fix-2026-08-13.md) | 2026-08-13 | Bound hung provider LLM requests | ✅ EXECUTED | `7e9466e` |
| [nested-subagent-permission-hang](./nested-subagent-permission-hang-2026-08-13.md) | 2026-08-13 | Depth 2+ subagent permission ask hang | ✅ EXECUTED | `f888efc` |
| [sdk-regen-typecheck](./sdk-regen-typecheck-2026-08-13.md) | 2026-08-13 | opencode typecheck after SDK regen | ✅ EXECUTED | `a4e2e8d` |
| [chat-ordering](./chat-ordering-2026-08-14.md) | 2026-08-14 | TUI chat ordering + disappearance | 🟡 PARTIAL | TUI reworked (`bdddf62`); Step 1 id-only DB ordering NOT implemented |
| [verify-chat-message-drop](./verify-chat-message-drop-2026-08-14.md) | 2026-08-14 | Proof tests A/B for message drop | ⬜ PENDING | Neither test file exists |
| [sse-graceful-retry](./sse-graceful-retry-2026-08-28.md) | 2026-08-28 | SSE reconnect instead of fatal fault | ✅ EXECUTED | PR #119 → `1795d16` |
| [v1-v2-synthesis-phase-1-2](./v1-v2-synthesis-phase-1-2-2026-09-06.md) | 2026-09-06 | Brands + event system | ✅ EXECUTED | `cb7fbd9` + descendants |
| [v1-v2-synthesis-phase-3](./v1-v2-synthesis-phase-3-2026-09-06.md) | 2026-09-06 | HTTP API unification | ✅ EXECUTED | `cb7fbd9`..`d633008` (3e partial by design) |
| [v1-v2-synthesis-phase-4](./v1-v2-synthesis-phase-4-2026-09-07.md) | 2026-09-07 | TUI sync unification + read migration | ✅ EXECUTED | `9d9fe54` |
| [v1-v2-synthesis-phase-5](./v1-v2-synthesis-phase-5-2026-09-07.md) | 2026-09-07 | Message model + engine re-homing | 🟡 PARTIAL | All batches landed (`857b145`, `39313b8`); deferred 5f deletions remain |
| [filter-compacted-regression-lock](./filter-compacted-regression-lock-2026-09-15.md) | 2026-09-15 | Regression test + AGENTS.md correction | ⬜ PENDING | Tracked in `e54ba95`; PR #139 closed unmerged (risk mitigated) |
| [acp-terminal-backend-integration](./acp-terminal-backend-integration-2026-09-16.md) | 2026-09-16 | ACP terminal backend for Zed et al | ✅ EXECUTED | `56dd7dd` + 6 follow-ups; Zed smoke test outstanding |
| [fix-code-review-findings](./fix-code-review-findings-2026-09-22.md) | 2026-09-22 | Code review findings (finalized) | ✅ EXECUTED | Finalized; see plan header |
| [verify-arch-review](./verify-arch-review-2026-09-22.md) | 2026-09-22 | Architecture review verification | ✅ EXECUTED | Finalized; see plan header |
| [repo-hygiene](./repo-hygiene-2026-09-22.md) | 2026-09-22 | Repository hygiene | ✅ EXECUTED | Finalized; see plan header |

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

- [chat-ordering](./chat-ordering-2026-08-14.md) — core Step 1 (id-only DB ordering, V1+V2) still open
- [v1-v2-synthesis-phase-5](./v1-v2-synthesis-phase-5-2026-09-07.md) — deferred 5f deletions (V1 compatibility facade)
- [subagent-fixes-08-12](./subagent-fixes-2026-08-12.md) — one dead-code removal outstanding
- [filter-compacted-regression-lock](./filter-compacted-regression-lock-2026-09-15.md) — regression test + AGENTS.md correction
- [verify-chat-message-drop](./verify-chat-message-drop-2026-08-14.md) — both proof tests
- ACP: real Zed smoke test (external verification only)

### Executed (for reference)

The remaining 19 non-finalized plans (22 ✅ rows in the table including the 3 finalized) — see the table above; each plan file cites its own landing commits and current `file:line` anchors.

### Superseded / Unverified

- None. No plan was found to be superseded, and no plan required an ❓ UNVERIFIED verdict after git evidence checks.

## Conventions / Maintenance

- The status legend above is normalized on review; status blocks in plan files use the same vocabulary.
- When a plan's status changes, update its status block **in place** (keep the date and evidence current) — do not rewrite the plan body.
- Keep this index table in sync with the plan files: new plan → add a row; status change → update the row's Status + Notes.
- Turkish-language plans keep their original language; status blocks are written in English for grep-ability.
