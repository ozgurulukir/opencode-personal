# Codebase Exploration Report

> Generated: 2026-09-09<br>
> Project: `/home/aristo/Projects/opencode-personal`<br>
> Graph: 1,593 files | 90,403 edges | 56.75 edges/file<br>
> Index: moderate, refreshed 2026-09-08 22:20 UTC

## Executive Summary

- V1/V2 uyumluluk sınırında net bir drift var: CLI canlı olay akışı `subtask` part'ını üretirken CLI tarihçe dönüştürücüsü bunu kaybediyor; app tarafındaki canlı ve tarihçe yolları da `subtask` bilgisini kaybediyor.
- V2 hata şeması yalnızca `UnknownError` taşıyor. Abort hataları app adapter/event reducer tarafından `UnknownError`'a çevriliyor; web UI ise kesintiyi yalnızca `MessageAbortedError` adıyla tanıyor. Bu, aynı oturumun canlı/yüklenmiş görünümünde “interrupted” yerine normal hata gösterilmesine yol açabilir.
- App adapter, CLI adapter ve event reducer aynı V2→V1 sözleşmesini ayrı ayrı uyguluyor ve zaman damgası, dosya source bilgisi, part ID biçimi gibi alanlarda ayrışıyor. Bu sınırın tek bir ortak dönüştürücüyle veya karakterizasyon testleriyle sabitlenmesi gerekiyor.
- Dokümantasyonda `as any` sayısı çelişkili: `AGENTS.md` bir yerde 67, başka yerde 62 diyor. Güncel `rg -o 'as any'` sayımı 67 (opencode 29, ui 33, core 5).
- Typecheck ve hedefli testler temiz geçti. Bu nedenle bulgular şu an compile-break değil; daha çok veri kaybı ve UI davranışı tutarlılığı riski.

## Phase 1: Structural Skeleton

### 1a. Repository shape

Codebase-memory graph refreshed successfully. The graph contains:

| Metric | Value |
|---|---:|
| Nodes | 31,160 |
| Edges | 90,403 |
| Files | 1,593 |
| Edge density | 56.75/file |
| TypeScript files | 1,056 |
| Parse-partial files | 19 |
| Ignored-by-design files recorded | 544 |

Largest package node populations:

| Package | Nodes |
|---|---:|
| `opencode` | 5,038 |
| `app` | 2,251 |
| `ui` | 1,035 |
| `web` | 388 |
| `core` | 252 |
| `storybook` | 111 |

Main composition surfaces identified by the graph include `packages/app/src/app.tsx`, the TUI app at `packages/opencode/src/cli/cmd/tui/app.tsx`, the TUI session route, the V2 session service, and the HTTP API route tree.

### 1b. Architecture shape

The dominant flow is:

```text
V2 session events
        |
        +--> V2 projector / message updater --> SessionMessage storage
        |
        +--> app global-sync event reducer --> V1-compatible app store
        |
        +--> CLI v2-legacy adapter --> V1-compatible run reducer
        |
        +--> V2 history endpoint --> app/CLI history adapters --> V1 renderers
```

The same V2-to-V1 contract is therefore implemented in at least three places: `packages/app/src/context/global-sync/v2-adapter.ts`, `packages/app/src/context/global-sync/event-reducer.ts`, and `packages/opencode/src/cli/cmd/run/v2-legacy.ts`.

### 1c. Cycle scan

The graph reports 25 circular `CALLS` groups over 9,572 scanned call edges. Small cycles are common in recursive helpers, caches, queues, and plugin lifecycle code. Larger groups deserve review:

- 6-node storage/control-plane group involving `effect/instance-state`, `storage/db`, `control-plane/workspace`, and `project/instance-store`.
- 8-node TUI group involving the session/home routes, prompt, app, event context, and TUI thread.
- 9-node `packages/core/src/effect-zod.ts` traversal group, likely recursive schema traversal.

The call graph uses heuristic resolution, so these are risk signals, not proof of runtime import cycles. Direct source spot-checking showed that several reported edges are inferred from short names rather than exact module imports.

### Notable Finding

The graph’s package-boundary call counts (`app -> opencode`, `ui -> opencode`, etc.) are not reliable architectural violations by themselves: the graph contains short-name collision examples such as app code resolving to unrelated TUI or UI symbols. Boundary conclusions were therefore based on source paths and adapter behavior, not those heuristic call totals.

## Phase 2: Module Anatomy

### Shared and high-fan-in surfaces

Top graph hotspots:

| Symbol | Fan-in |
|---|---:|
| `packages/opencode/src/cli/cmd/tui/context/kv.store` | 210 |
| `packages/storybook/.storybook/mocks/app/context/language.t` | 171 |
| `packages/core/src/util/log.info` | 86 |
| `packages/core/src/util/log.error` | 61 |
| `packages/app/src/components/titlebar.path` | 59 |
| `packages/opencode/src/cli/cmd/run/tool` | 55 |
| `packages/core/src/effect-zod.zod` | 53 |
| `packages/app/src/context/sdk.url` | 50 |

The V2 session files are relatively cohesive, but consumer adaptation is duplicated outside the V2 core. That duplication is the main module-anatomy risk found in this survey.

### V2 persistence versus consumer adapters

- `packages/opencode/src/v2/session-message-updater.ts:157-170` preserves `prompt.subtask` in the V2 user message.
- `packages/opencode/src/session/projectors-next.ts:134-153` persists prompted and step events.
- App and CLI then reconstruct older V1 message/part shapes independently.

This means data can be present in the canonical V2 record while being discarded at a consumer boundary.

## Phase 3: Pattern Discovery

### V2-to-V1 consistency matrix

| Behavior | App history (`v2-adapter`) | App live (`event-reducer`) | CLI history (`v2-legacy`) | CLI live (`createV2EventAdapter`) |
|---|---|---|---|---|
| File `source` mapping | Preserved | Uses shared app helper, preserved | Dropped | Dropped |
| `subtask` part | Dropped | Dropped | Dropped | Emitted |
| Reasoning start time | Hardcoded `0` | Shared helper, `0` | `message.time.created` | Event timestamp |
| Part ID format | Zero-padded (`0000`) | Shared app helper | Unpadded (`0`) | Unpadded/dynamic |
| Abort error name | Rebuilt as `UnknownError` | Rebuilt as `UnknownError` | Rebuilt as `UnknownError` | Emits `UnknownError` |

Evidence:

- App `reasoningPart()` hardcodes `time: { start: 0 }` at `packages/app/src/context/global-sync/v2-adapter.ts:169-183`.
- App history conversion omits `message.subtask` at `packages/app/src/context/global-sync/v2-adapter.ts:289-308`.
- App live prompt handling only types/loops over text, files, and agents at `packages/app/src/context/global-sync/event-reducer.ts:318-352`.
- CLI history conversion handles text/files/agents but not subtask at `packages/opencode/src/cli/cmd/run/v2-legacy.ts:276-311`.
- CLI live conversion explicitly emits a subtask part at `packages/opencode/src/cli/cmd/run/v2-legacy.ts:555-612`.
- CLI history reasoning uses the actual assistant timestamps at `packages/opencode/src/cli/cmd/run/v2-legacy.ts:224-248`; live reasoning uses event timestamps at `:661-688`.

### Notable Finding: live/reload drift

The most concrete drift is in the CLI path: a prompted event with a subtask produces a V1 `subtask` part live, but reloading the same V2 history drops it. The V2 canonical model retains the field, so this is consumer-side data loss rather than a persistence problem.

### Error-shape drift

`packages/opencode/src/v2/session-event.ts:26-32` defines `UnknownError` as `{ type: "unknown", message }`, while the legacy message schema still has `MessageAbortedError` at `packages/opencode/src/session/message.schema.ts:15-17` and includes it in the assistant error union at `:371-381`.

Both app adapters explicitly document that abort typing is lost and reconstruct `UnknownError` (`v2-adapter.ts:429-432`, `event-reducer.ts:487-490`). The web UI checks `error.name === "MessageAbortedError"` in `packages/ui/src/components/session-turn.tsx:150-158` and `packages/ui/src/components/message-part.tsx:1466-1469`. Consequently, the app/web path cannot classify the adapter-produced abort as an interruption. The TUI added a message-text heuristic at `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx:1381-1385`, so TUI and web behavior can differ for the same V2 error.

## Phase 4: Dead Code Detection

No deletion was performed. The graph contains ignored-by-design files and heuristic/import pseudo-nodes, so an orphan result without build metadata is not sufficient evidence of dead code in this monorepo.

The survey did identify stale/duplicate compatibility code rather than safely removable dead code:

- `packages/app/src/context/global-sync/v2-adapter.ts`
- `packages/app/src/context/global-sync/event-reducer.ts`
- `packages/opencode/src/cli/cmd/run/v2-legacy.ts`

These modules are actively referenced by their consumers; the risk is duplicated semantics, not unused exports.

## Phase 5: Domain Topology

The central domain is the session lifecycle:

```text
SessionPrompt / V2 session service
  -> SessionEvent definitions
  -> SyncEvent projectors
  -> SessionMessage updater + SQLite projection
  -> app global sync / CLI run adapter / TUI consumers
```

V2 user messages contain the prompt’s text, files, agents, and subtask (`packages/opencode/src/v2/session-message.ts:80-90`). V2 assistant tool states also support structured output and completed attachments (`packages/opencode/src/v2/session-message.ts:121-142`). The legacy adapters currently preserve only part of that vocabulary; for example, both app and CLI tool-state adapters join text content but do not map V2 completed attachments into legacy tool attachments.

Lifecycle events such as status, todo, diff, and permissions are registered as no-op V2 projectors in `packages/opencode/src/session/projectors-next.ts:196-207`, with comments explaining that their source services persist the state. This appears intentional and is distinct from the adapter data-loss findings.

## Phase 6: Runtime Behavior Approximation

### Live path

1. Session services emit `session.next.*` events.
2. `session-message-updater.ts` updates the in-memory/SQLite V2 representation.
3. App global sync applies the same events to a V1-shaped store.
4. CLI `createV2EventAdapter()` translates selected events into legacy reducer events.

### Reload path

1. App/CLI read V2 messages from the session endpoint.
2. The corresponding history adapter rebuilds V1 message and part slices.
3. Renderers consume those V1-compatible shapes.

The reload path is where `subtask`, abort classification, reasoning timestamps, and some file/tool metadata can diverge from live behavior.

### Validation executed

| Check | Result |
|---|---|
| `bun typecheck` from `packages/opencode` | Pass |
| `bun typecheck` from `packages/app` | Pass |
| App V2/global-sync targeted tests | 45 pass, 0 fail |
| Opencode V2/CLI adapter targeted tests | 78 pass, 0 fail |
| `git diff --check` | Pass |

The tests validate current happy paths but do not cover the identified subtask, abort-name, or reasoning-time asymmetries.

## Phase 7: Risk Assessment

### Complexity hotspots

Graph-ranked functions above cognitive complexity 70 include:

| Function | Lines | Cognitive | Cyclomatic |
|---|---:|---:|---:|
| `packages/app/src/pages/layout.tsx:Layout` | 2,399 | 266 | 238 |
| `packages/opencode/src/provider/sdk/copilot/responses/convert-to-openai-responses-input.ts:convertToOpenAIResponsesInput` | 308 | 261 | 47 |
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:Prompt` | 1,784 | 212 | 154 |
| `packages/app/src/pages/session.tsx:Page` | 1,659 | 206 | 198 |
| `packages/app/src/components/prompt-input.tsx:PromptInput` | 1,519 | 206 | 144 |
| `packages/opencode/src/cli/cmd/tui/context/sync.tsx:init` | 605 | 170 | 81 |
| `packages/opencode/src/provider/transform.ts:variants` | 341 | 132 | 53 |
| `packages/opencode/src/cli/cmd/run/v2-legacy.ts:createV2EventAdapter` | 209 | 110 | 47 |

These are maintainability and change-risk hotspots, not confirmed defects. The V2 compatibility adapter is especially relevant because its complexity is concentrated exactly where the behavior drift occurs.

### Documentation consistency

`AGENTS.md:197` states 67 `as any` occurrences, while `AGENTS.md:221` states 62. Current count:

```text
packages/opencode/src  29
packages/ui/src        33
packages/core/src       5
total                  67
```

This is a documentation inconsistency worth correcting before relying on the count in future audits.

### Worktree scope

The repository was already dirty before this survey. Existing changes include deleted/moved `.claude/skills/gitnexus*` files, `.gitnexus/run.cjs`, generated `packages/diff-wasm/pkg/*` files, and `.nova/todos.txt`. They were not modified by this survey. The only new file created is this report.

## Appendix: Raw Data

<details>
<summary>Architecture graph counts</summary>

```text
nodes: 31160
edges: 90403
files: 1593
languages: TypeScript 1056, CSS 74, YAML 35, SQL 19, Python 8, TOML 6, JavaScript 2, Bash 1, Rust 1, HTML 1
call_edges_scanned: 9572
cycles_total: 25
ignored_files_stored: 544
parse_partial: 19
```
</details>

<details>
<summary>Cycle groups</summary>

```text
filesystem.normalizePath <-> filesystem.resolve
plugin.codex.refreshAccessToken <-> plugin.codex.fetch
effect.instance-state / storage.db / control-plane.workspace / project.instance-store (6 nodes)
tui.plugin.api.routeNavigate <-> tui.plugin.api.navigate
app.scoped-cache.prune <-> app.scoped-cache.get
run.tool / tool.display.frame / tool.display.toolInlineInfo
core.cross-spawn-spawner.killOne / send / kill
app.sync.seenFor <-> app.sync.evict
app.local.pickAgent / current / configured / list
tui.plugin.runtime.fail <-> runtime.error
tui.plugin.runtime.dispose <-> deactivatePluginEntry
server.mdns.publish <-> attempt
core.effect-zod recursive traversal (9 nodes)
app.layout.setHoverProject <-> reset
app.server-health.next <-> attempt
app.global-sync.queue.take / schedule / push / drain
reference.referencePath <-> reference.resolve
TUI session/home/prompt/app/event/thread group (8 nodes)
app.persist.migrateLegacy / migrateLegacyAsync / getItem
app.persist.evict / write / setItem
app.terminal.Terminal <-> run
app.prompt.set / load / pick
ui.file.applySelection <-> setSelectedLines
run.prompt-state.submitPrompt <-> onSubmit
mcp.watch <-> reconnect
```
</details>

<details>
<summary>Targeted test commands</summary>

```text
packages/app:
bun test src/context/global-sync/v2-adapter.test.ts src/context/global-sync/event-reducer.test.ts src/context/sync-optimistic.test.ts
45 pass, 0 fail

packages/opencode:
bun test test/cli/cmd/run/v2-legacy.test.ts test/cli/cmd/run/event-loop.test.ts test/v2/session-message-updater.test.ts test/v2/session.test.ts
78 pass, 0 fail
```
</details>
