# GitNexus Engineering Plan

> Task: V1/V2 session compatibility driftini giderme ve live/reload davranışını eşitleme
> Evidence verified at commit `857b1456fb08b9a4a9ea531d20d5d6df881cbbde`; GitNexus index stale (21 commits behind; refresh attempted with `--index-only --pdg`, failed with `incremental-in-progress`). Source evidence is authoritative.
> Evidence provenance schema 2; global dirty digest `5e142bdd5af212853e555dae20432d1808bb3945d518cbf0bf2a6d37dd769dd1`; cited-path manifest 28 sorted entries; exact generated plan path excluded.

## 1. Objective

[verified] Aynı V2 session event/history girdisi app, CLI ve TUI tüketicilerinde aynı anlamı korumalı: `subtask`, reasoning kimliği/zamanı, file source metadata ve hata semantiği kaybolmamalı.

Acceptance criteria:

- [verified] App live event path ile history reload path aynı semantik V1 part/message çıktısını üretir.
- [verified] CLI live adapter ile history adapter `subtask`, file source ve reasoning alanlarında aynı sözleşmeyi uygular.
- [verified] Abort, V2’den V1’e çevrildiğinde `MessageAbortedError` olarak sınıflandırılır; normal hata olarak gösterilmez.
- [verified] Interleaved reasoning event’leri `reasoningID` ile doğru part’ı günceller.
- [verified] SDK yeniden üretimi sonrası `packages/sdk/js`, `packages/app` ve `packages/opencode` typecheck’leri geçer.

## 2. Current Behaviour

[verified] V2 canonical model `SessionMessage.User.subtask` alanını koruyor (`packages/opencode/src/v2/session-message-updater.ts:157-170`), ancak consumer adapter’ları farklı davranıyor.

[verified] App history conversion `sessionMessagesToV1()` text/file/agent part’larını üretirken `subtask`’ı atlıyor (`packages/app/src/context/global-sync/v2-adapter.ts:272-308`). App live `handlePrompted()` da yalnızca text/file/agent işliyor (`packages/app/src/context/global-sync/event-reducer.ts:318-352`).

[verified] CLI live `createV2EventAdapter()` `subtask` part’ı üretiyor (`packages/opencode/src/cli/cmd/run/v2-legacy.ts:555-612`), fakat CLI history `sessionMessagesToLegacy()` bunu üretmiyor (`:271-311`). Bu doğrudan live/reload driftidir.

[verified] App file adapter source bilgisini ve çözümlenmiş path’i koruyor (`packages/app/src/context/global-sync/v2-adapter.ts:125-149`); CLI file adapter source’u düşürüyor (`packages/opencode/src/cli/cmd/run/v2-legacy.ts:129-144`).

[verified] App reasoning helper `time.start` değerini `0` yapıyor (`packages/app/src/context/global-sync/v2-adapter.ts:169-183`) ve app event reducer reasoning güncellemelerinde `findLast()` kullanıyor (`packages/app/src/context/global-sync/event-reducer.ts:648-684`); V2 updater ve CLI adapter `reasoningID` ile çalışıyor.

[verified] V2 `Step.Failed` yalnızca `{ type: "unknown", message }` taşıyor (`packages/opencode/src/v2/session-event.ts:26-32,137-145`). Legacy schema hâlâ `MessageAbortedError` içeriyor (`packages/opencode/src/session/message.schema.ts:15-17,371-381`). App adapter’ları abort bilgisini `UnknownError` olarak yeniden kuruyor.

## 3. Relevant Architecture

[verified] Session event’leri `SessionEvent` → `projectors-next` → V2 `SessionMessage` read model akışına giriyor (`packages/opencode/src/session/projectors-next.ts:134-153`). App ve CLI V1 uyumluluk katmanları bu read modelin iki ayrı tüketicisi.

[verified] App history path `sync.tsx` ve layout prefetch tarafından çağrılıyor (`packages/app/src/context/sync.tsx:14-17,315-333`; `packages/app/src/pages/layout.tsx:83,748-765`). CLI history/live path `stream.transport.ts` ve `event-loop.ts` tarafından çağrılıyor (`packages/opencode/src/cli/cmd/run/stream.transport.ts:443,562-572`; `packages/opencode/src/cli/cmd/run/event-loop.ts:148-155`).

[inferred] Tam event state machine’lerini tek modülde birleştirmek yerine, SDK altında saf ortak dönüşüm primitive’leri paylaşmak daha düşük risklidir: app Solid store mutasyonlarına, CLI ise legacy reducer event’lerine özel kalabilir.

[verified] `@opencode-ai/sdk` hem app hem opencode tarafından kullanılıyor; SDK V2 source/export yapısı `packages/sdk/js/src/v2/index.ts` ve `packages/sdk/js/package.json` içindedir. Yeni saf uyumluluk modülü bu ortak sınırda tutulacaktır.

## 4. GitNexus Findings

[graph] GitNexus runner `1.6.10`; index commit’i `9822bd0`, mevcut HEAD `857b145`. Index 21 commit geride ve `context/impact` yeni V2 adapter sembollerini çözümleyemedi; bu nedenle graph blast-radius sonuçları plan için yük taşıyan kanıt olarak kullanılmıyor.

[graph] Stale index cycle check 7 elementary cycle / 4 component raporladı. Bu sonuç yalnızca yapısal takip sinyalidir; refresh başarısız olduğu için cycle temizliği bu plana alınmadı.

[verified] Source-derived direct consumers:

- `sessionMessagesToV1`: app sync history ve layout prefetch.
- `applyDirectoryEvent`: app global sync event stream.
- `sessionMessagesToLegacy`: CLI stream transport history.
- `createV2EventAdapter`: CLI stream transport ve event loop.

[verified] Existing targeted tests: `packages/app/src/context/global-sync/v2-adapter.test.ts`, `event-reducer.test.ts`; `packages/opencode/test/cli/cmd/run/v2-legacy.test.ts`; `packages/opencode/test/v2/session-message-updater.test.ts`.

## 5. Statement-Level PDG Findings

[assumed] PDG slice available değil. `gitnexus analyze --index-only --pdg` denemesi indeksin incremental durumuyla başarısız oldu; source-level control/data observations below are not PDG edges.

[verified] `sessionMessagesToV1()` message-type branches içinde `parentID`, `context` ve `part` state’ini mutasyona uğratıyor (`packages/app/src/context/global-sync/v2-adapter.ts:279-416`). New subtask handling must preserve the existing ordering and parent assignment.

[verified] `handleReasoningDelta/Ended()` latest reasoning part’ı seçiyor (`packages/app/src/context/global-sync/event-reducer.ts:665-684`). This is unsafe for interleaved IDs; the replacement must key by `reasoningID` or a deterministic part ID.

[verified] `SessionProcessor` abort sırasında önce `aborted = true` yapıyor (`packages/opencode/src/session/processor.ts:135-142,731-739`), fakat failure event payload’ını her durumda `type: "unknown"` üretiyor (`:688-705`). The schema and emission branch must be changed together.

## 6. Proposed Changes

### 6.1 Characterization and parity fixtures first

[verified] Expand existing adapter/reducer tests before extracting or moving code, honoring the repository’s characterization-test rule.

- Add current-behavior cases for app history/live prompt, CLI history/live prompt, abort mapping, file source, reasoning IDs/timestamps, and completed tool attachments.
- Add a parity helper in tests that compares semantic fields while ignoring consumer-specific event wrapper IDs.
- Preserve a test documenting current CLI live `subtask` emission versus history omission, then update that expectation after the fix.

### 6.2 Add a shared pure compatibility module

[inferred] Create `packages/sdk/js/src/v2/legacy.ts` as a browser/runtime-neutral module containing shared V2→legacy primitives:

- `toLegacyModel()` and a typed `toLegacyError()`;
- prompt part conversion including `subtask` and file `source`;
- reasoning conversion accepting explicit `reasoningID` and timestamp;
- tool-state conversion including V2 completed attachments where the legacy schema supports them;
- history conversion returning ordered `{ info, parts }` entries.

[assumed] The module accepts a `resolveFilePath(uri)` callback so app-specific browser/path handling is not pulled into SDK code. Add `./v2/legacy` to `packages/sdk/js/package.json` exports and re-export it from `packages/sdk/js/src/v2/index.ts`.

[inferred] Keep Solid store updates in `event-reducer.ts` and CLI stateful event translation in `v2-legacy.ts`; both call the shared pure primitives. Do not merge those state machines.

### 6.3 Preserve abort semantics in V2

[verified] Extend `packages/opencode/src/v2/session-event.ts` with an explicit tagged abort error (for example `type: "aborted"`) and use the union for `Step.Failed` and V2 assistant error data.

[verified] Update `packages/opencode/src/session/processor.ts` to emit the tagged abort error when the existing `aborted` state is true; retain `type: "unknown"` for non-abort failures.

[verified] Update `packages/opencode/src/v2/session-message.ts` and regenerate the SDK via `./packages/sdk/js/script/build.ts`. The generated V2 types must expose the new union.

[inferred] `toLegacyError()` maps the new tag to `MessageAbortedError` and unknown errors to the existing V1 `UnknownError`. For old persisted unknown records, keep a temporary message-text fallback for abort wording and mark it for later removal.

[verified] Update direct TUI V2 rendering at `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1381-1385` to prefer the explicit V2 tag, with the old wording fallback. The web/UI legacy path should receive the correct V1 error and continue using its existing `MessageAbortedError` divider logic.

### 6.4 Align app and CLI adapters

[verified] Replace duplicate history mapping in `v2-adapter.ts` and `v2-legacy.ts` with thin wrappers around the shared module. App wrapper flattens ordered entries into its `{ session, part }` store shape; CLI wrapper keeps its `SessionMessageWithParts` shape.

[verified] Add `subtask` to app live/history outputs and CLI history output. The UI currently has no dedicated `subtask` mapping, so preserving the part is the safe compatibility behavior; visual rendering is deferred.

[verified] Use V2 `AssistantReasoning.id` / event `reasoningID` as the stable identity and update app reducer deltas by that identity, not `findLast()`.

[inferred] Make file source mapping and completed tool attachment handling identical in both adapters. Keep each consumer’s existing outer event IDs unless parity tests show that a shared ID format can be adopted without breaking delta routing.

### 6.5 Correct documentation and guardrails

[verified] Correct the stale duplicate `as any` count in `AGENTS.md:221` to match the verified current count (67 total; current directory count 29/33/5), or remove the duplicate historical count. Do not change unrelated working-tree files.

## 7. Implementation Sequence

1. Add characterization fixtures to the existing app, CLI, and V2 updater tests. Do not split production files yet; record the current live/reload differences explicitly.
2. Add the tagged V2 abort error, update processor emission and V2 message schema, regenerate the SDK once. Re-run SDK/app/opencode typechecks and adapt generated type errors.
3. Add `packages/sdk/js/src/v2/legacy.ts` plus package exports. Move only pure constructors/converters first; keep behavior unchanged except where the new tests define the intended contract.
4. Switch app history conversion and CLI history conversion to the shared module. Add subtask/source/reasoning/attachment regression expectations.
5. Update app live reducer and CLI live adapter to use the same prompt/error/reasoning primitives. Add interleaved reasoning and live-vs-reload parity tests.
6. Update TUI abort classification and verify web/UI legacy rendering receives `MessageAbortedError`; keep backward fallback for old persisted unknown errors.
7. Fix `AGENTS.md`, regenerate generated artifacts only once at the tip, then run package-wide validation. If a future refactor is desired for the large reducer/adapter files, create a separate plan after these characterization tests are stable.

## 8. Test Strategy

| Test location | Scenarios |
|---|---|
| `packages/app/src/context/global-sync/v2-adapter.test.ts` | user with subtask; file source; reasoning ID + non-zero time; assistant abort/unknown mapping; completed tool attachments; history output |
| `packages/app/src/context/global-sync/event-reducer.test.ts` | prompted subtask; step.failed aborted vs unknown; reasoning A/B interleaving; live output compared with history output |
| `packages/opencode/test/cli/cmd/run/v2-legacy.test.ts` | live prompted subtask; history prompted subtask; file source; reasoning timestamps/IDs; abort session.error mapping |
| `packages/opencode/test/v2/session-message-updater.test.ts` | V2 User retains subtask; V2 Assistant retains tagged abort error |
| `packages/ui/src/components/session-turn.test.tsx` | `MessageAbortedError` renders interruption divider and is excluded from generic error; unknown error remains visible |

Verification commands (run from package directories):

- `cd packages/sdk/js && bun typecheck`
- `cd packages/app && bun typecheck && bun run test:unit`
- `cd packages/opencode && bun typecheck && bun test --timeout 30000`
- `cd packages/ui && bun typecheck && bun test src --conditions=browser`
- `git diff --check`

After SDK regeneration, clear stale app/sdk `*.tsbuildinfo` files before the clean typecheck if incremental diagnostics appear inconsistent.

## 9. Risk and Impact Analysis

- [high] V2 schema change affects generated SDK consumers in app and opencode. Regenerate once and typecheck all three consumers before merging.
- [high] Existing persisted sessions contain only `type: "unknown"`; the compatibility fallback is needed until old records age out or a migration policy is chosen.
- [medium] App event reducer has separate mutable state and ordering assumptions. Reasoning updates must remain session-scoped and event-ordered.
- [medium] Part IDs are local compatibility identifiers. Do not globally rename them in the same change unless parity tests cover delta routing and re-fetch merge behavior.
- [medium] V1 UI has no dedicated subtask component. Preserve the data but keep rendering deferred; unknown parts are currently non-renderable rather than fatal.
- [medium] Completed tool attachments are part of the V2 contract but consumer rendering coverage is limited; add mapping tests before enabling any new visual treatment.
- [low] `AGENTS.md` count correction is documentation-only and independent from runtime behavior.
- [assumed] Graph blast radius is incomplete until GitNexus can be refreshed; executor should re-run the refresh before changing shared SDK symbols.

## 10. Files Expected to Change

| File | Symbols | Reason |
|---|---|---|
| `packages/sdk/js/src/v2/legacy.ts` | new pure compatibility functions | Single semantic V2→V1 conversion authority |
| `packages/sdk/js/src/v2/index.ts` | exports | Public V2 compatibility entry point |
| `packages/sdk/js/package.json` | exports | Expose `@opencode-ai/sdk/v2/legacy` |
| `packages/opencode/src/v2/session-event.ts` | error schemas | Add explicit abort tag |
| `packages/opencode/src/v2/session-message.ts` | assistant/tool error fields | Consume new error union |
| `packages/opencode/src/session/processor.ts` | halt/error emission | Emit abort tag instead of always unknown |
| `packages/sdk/js/src/v2/gen/types.gen.ts` | generated event/message types | SDK regeneration output |
| `packages/app/src/context/global-sync/v2-adapter.ts` | history wrapper/primitives | Use shared mapping and preserve fields |
| `packages/app/src/context/global-sync/event-reducer.ts` | prompted/reasoning/error handlers | Live parity and ID-based updates |
| `packages/opencode/src/cli/cmd/run/v2-legacy.ts` | history/live adapter | Use shared mapping and preserve fields |
| `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` | abort classification | Read explicit V2 error tag |
| `packages/app/src/context/global-sync/v2-adapter.test.ts` | regression tests | App history contract |
| `packages/app/src/context/global-sync/event-reducer.test.ts` | regression tests | App live contract |
| `packages/opencode/test/cli/cmd/run/v2-legacy.test.ts` | regression tests | CLI live/reload contract |
| `packages/opencode/test/v2/session-message-updater.test.ts` | regression tests | Canonical V2 retention |
| `packages/ui/src/components/session-turn.test.tsx` | regression tests | Legacy abort rendering |
| `AGENTS.md` | stale count | Documentation consistency |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: "Align V2 session history/live compatibility across app, CLI, and TUI; preserve subtask, reasoning identity/time, file metadata, tool attachments, and abort error semantics."
  acceptance_criteria:
    - "App and CLI live/reload paths produce the same semantic legacy representation."
    - "Abort errors are explicitly tagged in V2 and map to MessageAbortedError in V1."
    - "Reasoning updates target reasoningID, including interleaved blocks."
    - "SDK, app, opencode, and UI checks pass."
  evidence_provenance:
    schema_version: 2
    head_commit: "857b1456fb08b9a4a9ea531d20d5d6df881cbbde"
    generated_plan_path: "docs/plans/2026-09-09-gitnexus-plan-v1-v2-consistency.md"
    global_dirty_digest:
      algorithm: "sha256"
      canonicalization: "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records"
      value: "5e142bdd5af212853e555dae20432d1808bb3945d518cbf0bf2a6d37dd769dd1"
    cited_path_manifest:
      - {path: "AGENTS.md", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:003af9c0c1032d18e45ce2ea75eed83c802d5268519f309b328c918fa37b90fe", index_digest: "sha256:003af9c0c1032d18e45ce2ea75eed83c802d5268519f309b328c918fa37b90fe", worktree_digest: "sha256:003af9c0c1032d18e45ce2ea75eed83c802d5268519f309b328c918fa37b90fe", untracked_digest: absent}
      - {path: "packages/app/package.json", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:bef7cbbce53eef25eb8092b5012d1946d7a330d268bdddaaeecad03e9f88b914", index_digest: "sha256:bef7cbbce53eef25eb8092b5012d1946d7a330d268bdddaaeecad03e9f88b914", worktree_digest: "sha256:bef7cbbce53eef25eb8092b5012d1946d7a330d268bdddaaeecad03e9f88b914", untracked_digest: absent}
      - {path: "packages/app/src/context/global-sync/event-reducer.test.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:0d75de9bd7d638cd183f8200dc0eb581e35ce89ad07f9cba33daa69d22ef2646", index_digest: "sha256:0d75de9bd7d638cd183f8200dc0eb581e35ce89ad07f9cba33daa69d22ef2646", worktree_digest: "sha256:0d75de9bd7d638cd183f8200dc0eb581e35ce89ad07f9cba33daa69d22ef2646", untracked_digest: absent}
      - {path: "packages/app/src/context/global-sync/event-reducer.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:a1134e1a649e13a675c85c41188ac70cda123d4ae7a2f0b1d66879dcd9084a16", index_digest: "sha256:a1134e1a649e13a675c85c41188ac70cda123d4ae7a2f0b1d66879dcd9084a16", worktree_digest: "sha256:a1134e1a649e13a675c85c41188ac70cda123d4ae7a2f0b1d66879dcd9084a16", untracked_digest: absent}
      - {path: "packages/app/src/context/global-sync/v2-adapter.test.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:4a6bc917f5adbe7e4b268fe329666e44d5e6af38ed3aab25b6e43aefd67667f3", index_digest: "sha256:4a6bc917f5adbe7e4b268fe329666e44d5e6af38ed3aab25b6e43aefd67667f3", worktree_digest: "sha256:4a6bc917f5adbe7e4b268fe329666e44d5e6af38ed3aab25b6e43aefd67667f3", untracked_digest: absent}
      - {path: "packages/app/src/context/global-sync/v2-adapter.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:3527272a6c6b179220634217516ecded461a81b58dc92acaa482efb59179ddff", index_digest: "sha256:3527272a6c6b179220634217516ecded461a81b58dc92acaa482efb59179ddff", worktree_digest: "sha256:3527272a6c6b179220634217516ecded461a81b58dc92acaa482efb59179ddff", untracked_digest: absent}
      - {path: "packages/app/src/context/sync.tsx", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:f161d244ca2af04271741892fa4608fc399d58c02b8150f04972ed7e00a1faf2", index_digest: "sha256:f161d244ca2af04271741892fa4608fc399d58c02b8150f04972ed7e00a1faf2", worktree_digest: "sha256:f161d244ca2af04271741892fa4608fc399d58c02b8150f04972ed7e00a1faf2", untracked_digest: absent}
      - {path: "packages/app/src/pages/layout.tsx", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:4f49b495c5d79f81392578ac99268ceee71236c9e7abe97f6efb1c04afc2f336", index_digest: "sha256:4f49b495c5d79f81392578ac99268ceee71236c9e7abe97f6efb1c04afc2f336", worktree_digest: "sha256:4f49b495c5d79f81392578ac99268ceee71236c9e7abe97f6efb1c04afc2f336", untracked_digest: absent}
      - {path: "packages/opencode/package.json", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:87b2f7e210d493e8120ef9bcbcad3bf93ecc868a604100319d5c490c85e47c99", index_digest: "sha256:87b2f7e210d493e8120ef9bcbcad3bf93ecc868a604100319d5c490c85e47c99", worktree_digest: "sha256:87b2f7e210d493e8120ef9bcbcad3bf93ecc868a604100319d5c490c85e47c99", untracked_digest: absent}
      - {path: "packages/opencode/src/cli/cmd/run/event-loop.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:84c12cf585a21db6e3081fd2ce419fccedbc98236777dd8c8422011b892d3dcb", index_digest: "sha256:84c12cf585a21db6e3081fd2ce419fccedbc98236777dd8c8422011b892d3dcb", worktree_digest: "sha256:84c12cf585a21db6e3081fd2ce419fccedbc98236777dd8c8422011b892d3dcb", untracked_digest: absent}
      - {path: "packages/opencode/src/cli/cmd/run/stream.transport.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:3b3f11f3421c6ce8edf6d803b2c8300ab70be3daadbeafa456a66901ebd9fce9", index_digest: "sha256:3b3f11f3421c6ce8edf6d803b2c8300ab70be3daadbeafa456a66901ebd9fce9", worktree_digest: "sha256:3b3f11f3421c6ce8edf6d803b2c8300ab70be3daadbeafa456a66901ebd9fce9", untracked_digest: absent}
      - {path: "packages/opencode/src/cli/cmd/run/v2-legacy.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:170349c4630b4531cdfa0f92958f6566e90352ebfc6df7d16b30d88e66f66fca", index_digest: "sha256:170349c4630b4531cdfa0f92958f6566e90352ebfc6df7d16b30d88e66f66fca", worktree_digest: "sha256:170349c4630b4531cdfa0f92958f6566e90352ebfc6df7d16b30d88e66f66fca", untracked_digest: absent}
      - {path: "packages/opencode/src/session/message.schema.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:ff3df4a3c495ef6b94d1cae1132e36564ef74945b96148b0be7f23cf8afbe595", index_digest: "sha256:ff3df4a3c495ef6b94d1cae1132e36564ef74945b96148b0be7f23cf8afbe595", worktree_digest: "sha256:ff3df4a3c495ef6b94d1cae1132e36564ef74945b96148b0be7f23cf8afbe595", untracked_digest: absent}
      - {path: "packages/opencode/src/session/processor.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:9d6367537c7832118c87140847485578e414bd821ade977568d509ab1d89ec5c", index_digest: "sha256:9d6367537c7832118c87140847485578e414bd821ade977568d509ab1d89ec5c", worktree_digest: "sha256:9d6367537c7832118c87140847485578e414bd821ade977568d509ab1d89ec5c", untracked_digest: absent}
      - {path: "packages/opencode/src/session/projectors-next.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:13cc64c9ed887e5334ceb4a398595898ccc2da85a82cc0b61e62b1a024173248", index_digest: "sha256:13cc64c9ed887e5334ceb4a398595898ccc2da85a82cc0b61e62b1a024173248", worktree_digest: "sha256:13cc64c9ed887e5334ceb4a398595898ccc2da85a82cc0b61e62b1a024173248", untracked_digest: absent}
      - {path: "packages/opencode/src/v2/session-event.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:856f984abdb735f37ca784d67240d7c5fa8ca4fb3dc190d28609d0f308d71ad5", index_digest: "sha256:856f984abdb735f37ca784d67240d7c5fa8ca4fb3dc190d28609d0f308d71ad5", worktree_digest: "sha256:856f984abdb735f37ca784d67240d7c5fa8ca4fb3dc190d28609d0f308d71ad5", untracked_digest: absent}
      - {path: "packages/opencode/src/v2/session-message-updater.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:cdfb95ed4fbb9b5ea3bdb7847c259ddacfb92e6d9394c52abab092750a1a372e", index_digest: "sha256:cdfb95ed4fbb9b5ea3bdb7847c259ddacfb92e6d9394c52abab092750a1a372e", worktree_digest: "sha256:cdfb95ed4fbb9b5ea3bdb7847c259ddacfb92e6d9394c52abab092750a1a372e", untracked_digest: absent}
      - {path: "packages/opencode/src/v2/session-message.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:9b2a36544877c1f2a3451e389cf89ad74fe11442f4f9d42bbbdde31ea26314d2", index_digest: "sha256:9b2a36544877c1f2a3451e389cf89ad74fe11442f4f9d42bbbdde31ea26314d2", worktree_digest: "sha256:9b2a36544877c1f2a3451e389cf89ad74fe11442f4f9d42bbbdde31ea26314d2", untracked_digest: absent}
      - {path: "packages/opencode/test/cli/cmd/run/v2-legacy.test.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:715f95d037d3c87225924e32c6ee923998a3c6de8be1169e3e13f7b1b1e32c63", index_digest: "sha256:715f95d037d3c87225924e32c6ee923998a3c6de8be1169e3e13f7b1b1e32c63", worktree_digest: "sha256:715f95d037d3c87225924e32c6ee923998a3c6de8be1169e3e13f7b1b1e32c63", untracked_digest: absent}
      - {path: "packages/sdk/js/package.json", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:bd3b106bf6c2e4dfe821704981828218346164e23ad6602969acc766439c64ae", index_digest: "sha256:bd3b106bf6c2e4dfe821704981828218346164e23ad6602969acc766439c64ae", worktree_digest: "sha256:bd3b106bf6c2e4dfe821704981828218346164e23ad6602969acc766439c64ae", untracked_digest: absent}
      - {path: "packages/sdk/js/script/build.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:c27ec1f8b46f351f837a290af40cd7383e03ad8e7c9a2faa9590f8121e36114b", index_digest: "sha256:c27ec1f8b46f351f837a290af40cd7383e03ad8e7c9a2faa9590f8121e36114b", worktree_digest: "sha256:c27ec1f8b46f351f837a290af40cd7383e03ad8e7c9a2faa9590f8121e36114b", untracked_digest: absent}
      - {path: "packages/sdk/js/src/v2/gen/types.gen.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:d6592fd978e87418fc99d58e1824168fcd6d951331435b6f7902f6ed22d766b9", index_digest: "sha256:d6592fd978e87418fc99d58e1824168fcd6d951331435b6f7902f6ed22d766b9", worktree_digest: "sha256:d6592fd978e87418fc99d58e1824168fcd6d951331435b6f7902f6ed22d766b9", untracked_digest: absent}
      - {path: "packages/sdk/js/src/v2/index.ts", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:22e691c85483a87a628f2c0da1d341efe21c2a3a0466985426449d1938757fa0", index_digest: "sha256:22e691c85483a87a628f2c0da1d341efe21c2a3a0466985426449d1938757fa0", worktree_digest: "sha256:22e691c85483a87a628f2c0da1d341efe21c2a3a0466985426449d1938757fa0", untracked_digest: absent}
      - {path: "packages/sdk/js/src/v2/legacy.ts", object_kind: {head: absent, index: absent, worktree: absent, untracked: absent}, state: absent, rename_from: null, rename_to: null, head_digest: absent, index_digest: absent, worktree_digest: absent, untracked_digest: absent}
      - {path: "packages/ui/package.json", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:9cb165bca645a1989aacc832fd494003f9a3e5f6843253dc1cd1889135a06351", index_digest: "sha256:9cb165bca645a1989aacc832fd494003f9a3e5f6843253dc1cd1889135a06351", worktree_digest: "sha256:9cb165bca645a1989aacc832fd494003f9a3e5f6843253dc1cd1889135a06351", untracked_digest: absent}
      - {path: "packages/ui/src/components/message-part.tsx", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:8e8094d80cf21e9595381a31523182461c0dfd58838fec6fc775dbfa59a14a18", index_digest: "sha256:8e8094d80cf21e9595381a31523182461c0dfd58838fec6fc775dbfa59a14a18", worktree_digest: "sha256:8e8094d80cf21e9595381a31523182461c0dfd58838fec6fc775dbfa59a14a18", untracked_digest: absent}
      - {path: "packages/ui/src/components/session-turn.tsx", object_kind: {head: regular, index: regular, worktree: regular, untracked: absent}, state: clean, rename_from: null, rename_to: null, head_digest: "sha256:7c4242c05bd32a450530a3cee98aaba4a64cb67d66fc1e40d9a45fd125ebcf15", index_digest: "sha256:7c4242c05bd32a450530a3cee98aaba4a64cb67d66fc1e40d9a45fd125ebcf15", worktree_digest: "sha256:7c4242c05bd32a450530a3cee98aaba4a64cb67d66fc1e40d9a45fd125ebcf15", untracked_digest: absent}
      - {path: "typegraph-exploration-report.md", object_kind: {head: absent, index: absent, worktree: absent, untracked: regular}, state: untracked, rename_from: null, rename_to: null, head_digest: absent, index_digest: absent, worktree_digest: absent, untracked_digest: "sha256:96d73a7a3e73c5fe98a3e3a31ab4aeabafbcc5b827d418573933f9abc1a25a26"}
  primary_symbols:
    - {symbol: "sessionMessagesToV1", file: "packages/app/src/context/global-sync/v2-adapter.ts:272-417", lines: "272-417", role: "app history adapter"}
    - {symbol: "applyDirectoryEvent", file: "packages/app/src/context/global-sync/event-reducer.ts:806-1005", lines: "318-352,475-492,648-684", role: "app live event reducer"}
    - {symbol: "sessionMessagesToLegacy", file: "packages/opencode/src/cli/cmd/run/v2-legacy.ts:271-394", lines: "271-394", role: "CLI history adapter"}
    - {symbol: "createV2EventAdapter", file: "packages/opencode/src/cli/cmd/run/v2-legacy.ts:537-745", lines: "537-745", role: "CLI live event adapter"}
    - {symbol: "SessionProcessor.halt", file: "packages/opencode/src/session/processor.ts:688-705", lines: "688-705", role: "abort/error event emission"}
  related_symbols:
    - {symbol: "SessionEvent.Step.Failed", relationship: "schema consumed by processor/projector/updater", relevance: "V2 error contract"}
    - {symbol: "SessionMessage.User", relationship: "canonical V2 message field", relevance: "retains subtask"}
    - {symbol: "SessionMessage.AssistantReasoning", relationship: "canonical reasoning identity", relevance: "reasoningID source"}
    - {symbol: "SessionMessageUpdater", relationship: "canonical V2 read-model updater", relevance: "reference behavior"}
    - {symbol: "SessionTurn", relationship: "legacy UI consumer", relevance: "abort divider/error split"}
    - {symbol: "stream.transport", relationship: "CLI adapter caller", relevance: "history/live integration"}
  execution_path:
    - "Prompt/session services emit session.next.* events."
    - "V2 updater/projector stores canonical SessionMessage data."
    - "App global sync and CLI run transport translate the same events separately."
    - "History endpoints feed separate V2→V1 converters."
    - "UI/renderers consume the reconstructed V1 shape."
  pdg_constraints:
    - description: "PDG unavailable; source shows reasoning updates currently select the last reasoning part."
      affected_statements: ["packages/app/src/context/global-sync/event-reducer.ts:665-684"]
      implementation_consequence: "Use reasoningID/deterministic ID lookup and add interleaving tests."
  architectural_patterns:
    - {pattern: "Generated SDK V2 contract", example_location: "packages/sdk/js/src/v2/index.ts", usage_guidance: "Keep shared pure compatibility code at the SDK boundary; regenerate after schema changes."}
    - {pattern: "Characterization tests before extraction", example_location: "AGENTS.md:195", usage_guidance: "Lock live/reload behavior before moving adapter code."}
    - {pattern: "Source-specific stateful reducers", example_location: "packages/app/src/context/global-sync/event-reducer.ts", usage_guidance: "Share pure mapping, not Solid/CLI state machines."}
  files_to_modify:
    - {file: "packages/sdk/js/src/v2/legacy.ts", symbols: ["new pure converters"], intended_change: "Centralize semantic V2→V1 conversion."}
    - {file: "packages/opencode/src/v2/session-event.ts", symbols: ["UnknownError", "Step.Failed"], intended_change: "Add explicit abort error tag."}
    - {file: "packages/opencode/src/session/processor.ts", symbols: ["halt"], intended_change: "Emit abort tag when processing is interrupted."}
    - {file: "packages/app/src/context/global-sync/event-reducer.ts", symbols: ["handlePrompted", "handleStepFailed", "handleReasoningDelta", "handleReasoningEnded"], intended_change: "Preserve subtask/error and target reasoning by ID."}
    - {file: "packages/opencode/src/cli/cmd/run/v2-legacy.ts", symbols: ["sessionMessagesToLegacy", "createV2EventAdapter"], intended_change: "Use shared mapping and align live/reload fields."}
  tests:
    - {file: "packages/app/src/context/global-sync/v2-adapter.test.ts", scenarios: ["subtask/source/reasoning/error/tool attachment mapping"]}
    - {file: "packages/app/src/context/global-sync/event-reducer.test.ts", scenarios: ["live prompt, abort, interleaved reasoning, parity"]}
    - {file: "packages/opencode/test/cli/cmd/run/v2-legacy.test.ts", scenarios: ["CLI live/reload parity and abort"]}
    - {file: "packages/opencode/test/v2/session-message-updater.test.ts", scenarios: ["canonical subtask and abort retention"]}
    - {file: "packages/ui/src/components/session-turn.test.tsx", scenarios: ["interruption divider versus generic error"]}
  verification_commands:
    - "cd packages/sdk/js && bun typecheck"
    - "cd packages/app && bun typecheck && bun run test:unit"
    - "cd packages/opencode && bun typecheck && bun test --timeout 30000"
    - "cd packages/ui && bun typecheck && bun test src --conditions=browser"
    - "git diff --check"
  risks:
    - "SDK regeneration changes app/opencode generated contracts."
    - "Old persisted unknown errors need a temporary abort fallback."
    - "Live event ordering and local part IDs must remain stable."
    - "GitNexus impact data is stale until refresh succeeds."
  assumptions:
    - "SDK is the correct shared boundary; verify generated build does not clean non-generated src/v2 files."
    - "Subtask data should be preserved even while UI rendering remains deferred."
    - "Consumer-specific event IDs remain unchanged unless parity tests justify normalization."
  open_questions:
    - "Should old persisted abort-like UnknownError records be migrated permanently or only handled by fallback?"
    - "Should the UI eventually render SubtaskPart, or remain a preserved-but-hidden compatibility part?"
  avoid:
    - "Do not refactor the large reducers before characterization tests pass."
    - "Do not run root tests; root test intentionally fails."
    - "Do not overwrite or clean pre-existing dirty worktree files."
    - "Do not make stale GitNexus blast-radius counts load-bearing."

## 12. Assumptions and Open Questions

### Assumptions

- [assumed] `packages/sdk/js/src/v2/legacy.ts` is acceptable as a shared pure module because both consumers already import V2 generated types; confirm the SDK build/export behavior before implementation.
- [assumed] Preserving `SubtaskPart` in the legacy store is preferable to dropping canonical data. Rendering can remain deferred because `PART_MAPPING` currently treats unknown parts as non-renderable.
- [assumed] Existing persisted abort-like `UnknownError` messages need a compatibility fallback; the exact retirement policy is not established.
- [assumed] CLI local part IDs are not a public persistence contract; keep them stable by default and only normalize with explicit regression evidence.

### Open Questions

- Decide whether to add a permanent V2 error migration for historical records or retain the fallback indefinitely.
- Decide whether `SubtaskPart` should get a first-class app/UI renderer in a separate feature plan.
- Retry GitNexus `--index-only --pdg` on a clean analyzer state before using graph impact numbers for implementation sequencing.

### Explicitly deferred

- Splitting `event-reducer.ts`, `v2-legacy.ts`, or other high-complexity files beyond the minimal shared pure module.
- Resolving all 7 stale-index import cycles.
- Broad tool attachment UI work.
- Refactoring unrelated complexity hotspots (`layout.tsx`, `prompt-input.tsx`, TUI prompt).

## 13. Definition of Done

- [ ] Characterization tests exist and pass before production extraction.
- [ ] One shared pure compatibility module is used by app and CLI history/live primitives.
- [ ] V2 abort errors are explicitly tagged and correctly mapped to legacy/UI semantics.
- [ ] `subtask`, file source, reasoning identity/time, and supported tool attachments survive both live and reload paths.
- [ ] Interleaved reasoning regression test passes.
- [ ] SDK regenerated once; SDK/app/opencode/UI typechecks pass.
- [ ] App, CLI, V2 updater, and UI regression suites pass.
- [ ] `AGENTS.md` no longer contains contradictory `as any` totals.
