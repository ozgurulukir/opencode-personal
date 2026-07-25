# Codebase Exploration Report
> Generated: 2025-07-25
> Project: /home/aristo/Projects/opencode-1.14.48
> Files: 3106 | Nodes: 47289 | Edges: 101681 | Import Density: 4.78

## Executive Summary

- **Monorepo architecture**: 48 packages in a Bun workspace. The core domain lives in `packages/opencode`, with satellite apps (`app`, `desktop`, `web`, `console`) and infrastructure (`core`, `llm`, `sdk`, `ui`).
- **Effect-based DI everywhere**: The `Service` + `Interface` + `Layer` pattern is the project-wide convention. 501 interfaces, 429 classes, 359 HTTP routes.
- **Session is the central hub**: `Session.Service` has 195 direct callers — it is the highest-risk symbol in the codebase. Any change to session schema or service interface propagates to almost every subsystem.
- **Core and UI are pure providers**: `packages/core` and `packages/ui` have near-zero isolation scores (0.037 and 0.02) because they are foundational libraries depended upon by everything. They have no outgoing domain edges.
- **8 import cycles** exist, mostly small (2–4 files). The largest are the LLM transport trio (`http.ts`, `websocket.ts`, `index.ts`) and the Zen provider quartet (4 files). None are critical tangles.
- **V1/V2 hybrid**: V2 session (`v2/session.ts`) is a delegation bridge to V1. V1 services are captured via `Effect.serviceOption` and dual-write events for the V2 projector.
- **No dead code found**: One file (`cli/cmd/tui/worker.ts`) appears orphaned but is dynamically imported via `new URL("./worker.ts", import.meta.url)` in `thread.ts`.

---

## Phase 1: Structural Skeleton

### 1a. Entry Points

| Entry Point | Files (depth 2) | Role |
|---|---|---|
| `packages/opencode/src/index.ts` | 79 | Main library barrel / CLI composition root |
| `packages/opencode/src/server/server.ts` | 43 | HTTP API server |
| `packages/app/src/index.ts` | 34 | Desktop/web app entry |
| `packages/opencode/src/cli/cmd/run/entry.body.ts` | 5 | CLI run command worker |
| `packages/desktop/src/main/index.ts` | 12 | Electron main process |
| `packages/llm/src/index.ts` | 15 | LLM abstraction layer |
| `packages/sdk/js/src/index.ts` | 7 | JS SDK entry |
| `packages/sdk/js/src/server.ts` | 1 | SDK server process |

**Main orchestrator**: `packages/opencode/src/index.ts` (79 files). It imports CLI commands, server, TUI, ACP, plugin, provider, session, and tool subsystems.

### 1b. Dependency Tree Overlap

The heaviest overlap between trees:
- `packages/core/src/util/log.ts` and `packages/core/src/global.ts` appear in almost every tree.
- `packages/opencode/src/agent/agent.ts` appears in opencode, server, and tool trees.
- `packages/opencode/src/provider/schema.ts` appears in session, tool, and ACP trees.

### 1c. Import Cycles (8 total)

| Cycle | Files | Size |
|---|---|---|
| SDK v1 gen client | `utils.gen.ts` ↔ `types.gen.ts` | 2 |
| SDK v2 gen client | `utils.gen.ts` ↔ `types.gen.ts` | 2 |
| App dialog providers | `dialog-custom-provider.tsx` → `dialog-select-provider.tsx` → `dialog-connect-provider.tsx` → back | 3 |
| Global sync | `child-store.ts` ↔ `bootstrap.ts` ↔ `global-sync.tsx` | 3 |
| Zen providers | `openai-compatible.ts` → `openai.ts` → `anthropic.ts` → `provider.ts` → back | 4 |
| LLM transport | `http.ts` ↔ `websocket.ts` ↔ `index.ts` | 3 |
| Session todo | `todo-autoclose.ts` ↔ `todo.ts` | 2 |
| Tool task | `task.ts` ↔ `tool.ts` | 2 |

**Notable**: The Zen provider cycle (4 files) is the largest and is in the console app's experimental AI feature area. The LLM transport cycle (3 files) is a standard protocol pattern.

### 1d. Cross-Boundary Isolation

| From | To | Path | Hops |
|---|---|---|---|
| `opencode/src/server/server.ts` | `desktop/src/main/index.ts` | **null** (isolated) | — |
| `opencode/src/index.ts` | `app/src/index.ts` | **null** (isolated) | — |
| `opencode/src/index.ts` | `llm/src/index.ts` | **null** (isolated) | — |
| `opencode/src/index.ts` | `sdk/js/src/index.ts` | `providers.ts` → `plugin/index.ts` → `sdk/index.ts` | 3 |
| `app/src/index.ts` | `desktop/src/main/index.ts` | **null** (isolated) | — |
| `llm/src/index.ts` | `sdk/js/src/index.ts` | **null** (isolated) | — |

**Notable**: The only compile-time boundary violation is `opencode → sdk` via the plugin system. The `providers` CLI command imports `Plugin` which re-exports the SDK client. This is intentional (plugin system bridges to SDK).

---

## Phase 2: Module Anatomy

### 2a. High-Fanout Infrastructure Files

| File | Direct Dependents | Role |
|---|---|---|
| `packages/core/src/util/log.ts` | 123 | Logging facade — used by almost every module |
| `packages/core/src/global.ts` | 79 | Global paths / service locator |
| `packages/opencode/src/bus/index.ts` | 30 | Event bus (publish/subscribe) |
| `packages/opencode/src/agent/agent.ts` | 30 | Agent definitions |
| `packages/opencode/src/permission/index.ts` | 16 | Permission evaluation |
| `packages/opencode/src/session/session.ts` | 14 | Session CRUD |
| `packages/opencode/src/session/schema.ts` | ~70+ (via outgoing) | SessionID, MessageID, PartID brands |

### 2b. Module Exports

| File | Exports | Pattern |
|---|---|---|
| `packages/opencode/src/provider/provider.ts` | 18 | `Model`, `Info`, `ListResult`, `ConfigProvidersResult`, `Service`, `defaultLayer`, `ModelNotFoundError`, `InitError` — schema-heavy, 34 lines of type definitions |
| `packages/opencode/src/session/session.ts` | 34 | `Info`, `ProjectInfo`, `GlobalInfo`, `CreateInput`, `ForkInput`, `GetInput`, `ListInput`, `Event`, `Service`, `layer`, `defaultLayer` — very large, mixes schema, service, and helpers |
| `packages/opencode/src/agent/agent.ts` | 7 | `Info`, `Interface`, `Service`, `layer`, `defaultLayer`, `Agent` namespace — clean |
| `packages/opencode/src/bus/index.ts` | 10 | `Interface`, `Service`, `layer`, `defaultLayer`, `publish`, `subscribe`, `subscribeAll`, `createID` — clean |
| `packages/core/src/global.ts` | 8 | `Path`, `Service`, `Interface`, `make`, `layer`, `defaultLayer`, `layerWith` — clean |

**Notable**: `session.ts` exports 34 symbols — it is doing too much. It mixes session CRUD, schema definitions, event types, usage calculation, and slug generation. The AGENTS.md notes this file has already been partially decomposed (projectors extracted), but it remains a god file.

### 2c. Module Boundaries

| Module | Internal Edges | Incoming | Outgoing | Isolation Score | Role |
|---|---|---|---|---|---|
| `packages/core/src/*` | 28 | 729 | 0 | 0.037 | **Provider** — foundational utilities, depended on by everything |
| `packages/ui/src/*` (sample) | 3 | ~100+ | ~15 | 0.020 | **Provider** — UI component library |
| `packages/opencode/src/provider/*` | 6 | ~60 | ~15 | 0.076 | **Consumer/Provider hybrid** — depends on core, provides schema to domain |
| `packages/opencode/src/session/*` | 88 | ~50 | ~40 | 0.266 | **Consumer** — depends on core, bus, provider, agent, tools |
| `packages/opencode/src/tool/*` | 79 | ~20 | ~40 | 0.382 | **Consumer/Orchestrator** — depends on session, agent, permission, file, format |

**Notable**: The session module has the lowest isolation among domain modules (0.266). It depends on 40+ outgoing edges to core, bus, agent, provider, and tools. This makes it the architectural center of gravity.

---

## Phase 3: Pattern Discovery

### 3a. Service Pattern Consistency

Every service module follows the same shape:

```ts
export interface Interface { ... }
export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}
export const layer = Layer.effect(Service, ...)
export const defaultLayer = layer.pipe(...)
export * as Foo from "./foo"
```

This is **project-wide and intentional**. 429 classes, 501 interfaces, and consistent naming (`*Service`, `*Error`, `*Test`) confirm a disciplined Effect-based DI pattern.

### 3b. Pattern Prevalence

| Symbol | Count | Interpretation |
|---|---|---|
| `Layer` (navigate_to) | High | DI composition is pervasive |
| `Error` / `NamedError` | High | Typed errors are standard |
| `Test` / `ServiceTest` | Moderate | Test doubles exist for major services |
| `Live` | Low | No explicit `*Live` suffix — `defaultLayer` is the live implementation |

### 3c. Test Layer Coverage

Major services with test layers:
- `Session` — tested via `test/session/*` and `test/server/httpapi-*`
- `Agent` — tested via `test/agent/*`
- `Provider` — tested via `test/provider/*`
- `Permission` — tested via `test/permission/*`
- `Bus` — tested via `test/bus/*`

All core services have test coverage. The test pattern uses `Effect.serviceOption` for V1 services and `Layer.mock` for test doubles.

---

## Phase 4: Dead Code Detection

### 4a. Orphan Files

- `packages/opencode/src/cli/cmd/tui/worker.ts` — 0 static dependents, but **dynamically imported** via `new URL("./worker.ts", import.meta.url)` in `thread.ts`. Not dead.
- No other orphan files found in the sampled directories.

### 4b. Dead Exports

- `packages/opencode/src/provider/provider.ts` exports `Model` (re-exported from `model.ts`), `ModelNotFoundError`, and `InitError` — all are referenced.
- `packages/opencode/src/session/session.ts` exports 34 symbols. Spot-checking the rare ones (`ArchivedTimestamp`, `plan`, `getUsage`): `plan` is used in `compaction.ts`; `getUsage` is used in `session.ts` itself. No obvious dead exports in the top-level symbols.

### 4c. Barrel File Audit

- `packages/opencode/src/index.ts` is a barrel but its exports are all consumed by CLI commands or tests.
- `packages/opencode/src/session/schema.ts` re-exports `SessionID`, `MessageID`, `PartID` — all are heavily used (70+ references).

**No confirmed dead exports or orphan files in the sampled set.**

---

## Phase 5: Domain Topology

### 5a. Domain Entities

| Entity | Primary File | Type |
|---|---|---|
| Session | `session/session.ts` | Service + Schema + Events |
| Agent | `agent/agent.ts` | Service + Schema |
| Provider | `provider/provider.ts` | Service + Schema |
| Tool | `tool/tool.ts`, `tool/registry.ts` | Tool definitions + registry |
| Permission | `permission/index.ts` | Service + evaluation |
| Project | `project/project.ts` | Service + schema |
| Workspace | `control-plane/workspace.ts` | Service + schema |
| Message | `session/message-v2.ts` | Schema + V2 types |

### 5b. Entity Relationships

```
Session → Agent (which agent owns this session)
Session → Provider (which model)
Session → Permission (ruleset)
Session → Tool (via TaskTool, PlanTool)
Session → Bus (events)
Session → SyncEvent (cross-device sync)
Session → Snapshot (snapshots for revert)

Agent → Provider (default model)
Agent → Permission (agent-level rules)
Agent → Plugin (tools, hooks)

Provider → Auth (API keys, OAuth)
Provider → Installation (version check)
```

### 5c. Domain Boundary Verification

| Domain A | Domain B | Path | Independent? |
|---|---|---|---|
| Session | Agent | Direct import (`session/prompt.ts` → `agent/agent.ts`) | No — intentional |
| Session | Provider | Direct import (`session/prompt.ts` → `provider/schema.ts`) | No — intentional |
| Agent | Provider | Direct import (`agent/agent.ts` → `provider/provider.ts`) | No — intentional |
| Tool | Session | Direct import (`tool/task.ts` → `session/session.ts`) | No — intentional |
| Permission | Session | Direct import (`permission/index.ts` → `session/schema.ts`) | No — intentional |

All core domains are tightly coupled by design — they form a single aggregate root around the Session entity.

### 5d. Blast Radius: Session.Service

- **195 direct callers** across 50+ files
- Callers include: every HTTP handler, every tool, the agent loop, compaction, revert, summary, share, V2 bridge, CLI commands, and 30+ test files
- `Session.Service` is the single most dangerous symbol to change

---

## Phase 6: Runtime Behavior Approximation

### 6a. Request Flow Tracing

**HTTP Handler → Service → Effect Layer**:

1. `server/routes/instance/httpapi/handlers/session.ts` — `HttpApiBuilder.group("session", ...)` yields `Session.Service`, `Agent.Service`, `Provider.Service`, `Bus` at layer construction
2. Handlers call `session.list()`, `session.get()`, `session.create()`, `session.fork()`, etc.
3. `Session.Service` methods are thin — they call `Storage.Service` (Drizzle DB) and emit `Bus` events
4. `SessionPrompt.prompt()` in `session/prompt.ts` is the write path — it triggers the agent loop

**V2 Session Delegation**:

- `v2/session.ts` delegates all write methods (`create`, `prompt`, `compact`, `wait`, `shell`, `skill`, `subagent`) to V1 services via `Effect.serviceOption`
- V1 `SessionPrompt.prompt` runs the real agent loop AND emits `SessionEvent.*` events
- V2 projectors (`session/projectors-next.ts`) listen to these events and populate `SessionMessageTable`
- V2 read methods (`get`, `list`, `messages`, `context`) read from the V2-populated tables

### 6b. Layer Composition

The main composition root is `packages/opencode/src/server/server.ts`:
- It assembles `Session.layer`, `Agent.layer`, `Provider.layer`, `Bus.layer`, `Storage.layer`, `SyncEvent.layer`, `Permission.layer`, `Plugin.layer`, etc.
- Middleware provides request-scoped services: `InstanceRef`, `WorkspaceRef`, `InstanceState.context`
- The `InstanceHttpApi` group mounts all handler groups (`session`, `global`, `provider`, `config`, `experimental`, `mcp`, `pty`, `question`, `tui`, `workspace`)

### 6c. Service Implementation Mapping

- All major services use the Effect `Service` class pattern with `defaultLayer` as the live implementation
- No `*Live` suffix convention — live vs test is distinguished by `defaultLayer` vs `Layer.mock`
- Test layers are defined inline in test files using `Layer.mock(Service)({...})`

### 6d. Async / Event-Driven Paths

- **Bus events**: `Bus.publish` / `Bus.subscribe` used for session updates, tool execution, compaction, revert
- **SSE endpoints**: `/event` (instance Bus, Effect PubSub) and `/global/event` (global Bus, Node EventEmitter)
- **Background fibers**: `Effect.forkScoped` used in `InstanceState.make` closures for background stream consumers (e.g., file watchers)
- **No explicit queue/job system**: async work is done via Effect fibers and streams, not a separate job queue

### 6e. Feature Flags

- `packages/core/src/flag/flag.ts` — `Flag` type used throughout
- `OPENCODE_EXPERIMENTAL_EVENT_SYSTEM` — forces V1 dual-write events in tests
- `OPENCODE_CHANNEL` — build-time baked channel (local vs release)
- No runtime feature flag system detected via grep — flags are mostly build-time or Effect-level config

---

## Phase 7: Risk Assessment

### 7a. Blast Radius Ranking

| Rank | Symbol | Files Affected | Risk |
|---|---|---|---|
| 1 | `Session.Service` | 195 | **Critical** — changes break almost every handler, tool, and test |
| 2 | `core/src/util/log.ts` (`Log`) | 123 | **High** — but changes are usually additive (new log levels) |
| 3 | `core/src/global.ts` (`Global`) | 79 | **High** — path changes affect all file I/O |
| 4 | `Agent.Service` | 32 | **Medium-High** — agent loop, tools, subagents |
| 5 | `Provider.Service` | 26 | **Medium** — model resolution, auth, LLM calls |

### 7b. Dependency Inversion Check

**Well-inverted**:
- `Session.Service` is consumed via `yield* Session.Service` everywhere — consumers depend on the interface, not the implementation
- `Agent.Service`, `Provider.Service`, `Bus.Service` follow the same pattern
- Changing the implementation class does not affect callers as long as the interface is preserved

**Not inverted**:
- `core/src/util/log.ts` is imported directly as a module, not via a service interface. Changing its API breaks 123 files.
- `core/src/global.ts` is also imported directly. It is a singleton service locator, not an injectable interface.

### 7c. Change Propagation Preview

**Scenario: Changing `Session.Info` schema**

1. `ts_blast_radius` on `Session.Info` → affects `session/session.ts`, `session/session.sql.ts`, `session/projectors.ts`, `session/prompt.ts`, `session/message-v2.ts`, and 30+ test files
2. `ts_dependents` on `session/session.ts` → 14 direct dependents, but indirect dependents include every HTTP handler, tool, and the agent loop
3. `ts_module_boundary` on `session/` → outgoing edges to core, bus, agent, provider, tools. Any schema change requires coordinated updates across all dependent modules

**Recommendation**: Schema changes to `Session.Info` require a migration plan (Drizzle migration + DB backfill + projector updates + SDK regeneration).

---

## Appendix: Raw Data

<details>
<summary>Graph Schema Summary</summary>

- **Nodes**: 47,289 (Variable: 14,969, Section: 10,620, Function: 10,049, File: 3,106, Module: 3,083, Type: 3,052, Method: 602, Interface: 501, Class: 429, Route: 359, Folder: 509)
- **Edges**: 101,681 (DEFINES: 43,333, CALLS: 19,032, USAGE: 16,236, IMPORTS: 14,855, CONTAINS_FILE: 3,100, SIMILAR_TO: 1,981, WRITES: 1,025, DEFINES_METHOD: 602, CONTAINS_FOLDER: 475, RAISES: 350, HTTP_CALLS: 198, INHERITS: 143, HANDLES: 142, CONFIGURES: 82, TESTS_FILE: 64, SEMANTICALLY_RELATED: 32, THROWS: 24, LISTENS_ON: 5, EMITS: 1, HAS_BRANCH: 1)
- **Languages**: TypeScript (1,862), CSS (122), SQL (88), YAML (36), TOML (4), JavaScript (4), HTML (3), Bash (1)

</details>

<details>
<summary>Import Cycles Detail</summary>

```json
[
  ["packages/sdk/js/src/gen/client/utils.gen.ts", "packages/sdk/js/src/gen/client/types.gen.ts"],
  ["packages/sdk/js/src/v2/gen/client/utils.gen.ts", "packages/sdk/js/src/v2/gen/client/types.gen.ts"],
  ["packages/app/src/components/dialog-custom-provider.tsx", "packages/app/src/components/dialog-select-provider.tsx", "packages/app/src/components/dialog-connect-provider.tsx"],
  ["packages/app/src/context/global-sync/child-store.ts", "packages/app/src/context/global-sync/bootstrap.ts", "packages/app/src/context/global-sync.tsx"],
  ["packages/console/app/src/routes/zen/util/provider/openai-compatible.ts", "packages/console/app/src/routes/zen/util/provider/openai.ts", "packages/console/app/src/routes/zen/util/provider/anthropic.ts", "packages/console/app/src/routes/zen/util/provider/provider.ts"],
  ["packages/llm/src/route/transport/http.ts", "packages/llm/src/route/transport/websocket.ts", "packages/llm/src/route/transport/index.ts"],
  ["packages/opencode/src/session/todo-autoclose.ts", "packages/opencode/src/session/todo.ts"],
  ["packages/opencode/src/tool/task.ts", "packages/opencode/src/tool/tool.ts"]
]
```

</details>

<details>
<summary>Hotspots (Top 10 by fan-in)</summary>

| Symbol | Fan In | File |
|---|---|---|
| `describe` | 359 | `packages/sdk/js/src/error-interceptor.ts` |
| `t` (i18n) | 172 | `packages/storybook/.storybook/mocks/app/context/language.ts` |
| `buildClientParams` | 125 | `packages/sdk/js/src/v2/gen/core/params.gen.ts` |
| `eq` | 87 | `packages/ui/src/components/motion-spring.tsx` |
| `provide` | 62 | `packages/opencode/src/project/with-instance.ts` |
| `useDialog` | 61 | `packages/opencode/src/cli/cmd/tui/ui/dialog.tsx` |
| `error` | 55 | `packages/core/src/util/log.ts` |
| `zod` | 54 | `packages/core/src/effect-zod.ts` |
| `use` | 52 | `packages/opencode/src/storage/db.ts` |
| `withStatics` | 51 | `packages/core/src/schema.ts` |

</details>
