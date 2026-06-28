# Codebase Exploration Report

> Generated: 2025-06-28
> Project: /home/aristo/Projects/opencode-1.14.48 (packages/opencode)
> Files: 1676 | Edges: 12 import cycles | Density: moderate (core files 60-80 dependents each)

## Executive Summary

- **Monolithic Effect-based architecture** with two primary entry points: CLI (`src/index.ts`, 78 files) and HTTP server (`src/server/server.ts`, 43 files). The CLI orchestrates 20+ yargs commands; the server exposes ~20 HTTP handler groups.
- **High coupling to foundational abstractions**: `core/src/schema.ts` (62 dependents), `core/src/global.ts` (79 dependents), and `core/src/filesystem.ts` (71 dependents) are touched by nearly every module. Changing these is extremely high-risk.
- **Consistent Effect DI pattern** across all services: each module exports `Interface`, `Service`, `layer`, `defaultLayer`, plus a namespace re-export (`export * as Foo from "."`). No `export namespace` usage.
- **12 import cycles detected** — 5 are in generated SDK code (`sdk/js/src/gen/` and `v2/gen/`) and are benign; 7 are in application code, with the most concerning being a 10-file cycle in `cli/cmd/tui/feature-plugins/` and a 5-file cycle in `provider/transform.ts` ↔ `provider/provider.ts`.
- **Session is the central domain entity**: `SessionTable` has 147 direct references, 15 direct dependents, and is imported by workspace, project, v2, storage, CLI, and server modules. Session owns the message, part, todo, and permission tables.
- **Low module isolation scores (0.02–0.13)** across all sampled directories, confirming this is a tightly coupled monolith where vertical slicing is the practical boundary, not directory boundaries.
- **V2 session module exists as a parallel implementation** with zero compile-time coupling to the v1 session module (`shortest_path` returns null), suggesting an evolutionary migration path (Strangler Fig pattern per AGENTS.md Rule 16).

---

## Phase 1: Structural Skeleton

### 1a. Entry Points

| Entry Point               | Role                                       | Dependency Tree Size |
| ------------------------- | ------------------------------------------ | -------------------- |
| `src/index.ts`            | CLI root (yargs, 20+ commands)             | 78 files             |
| `src/server/server.ts`    | HTTP server composition root               | 43 files             |
| `src/cli/cmd/run.ts`      | TUI run command (primary user flow)        | 40+ files            |
| `src/cli/cmd/tui/app.tsx` | TUI application shell                      | 40+ files            |
| `src/node.ts`             | Standalone Node entry (serve/web/generate) | 15+ files            |

The `src/index.ts` is the heaviest orchestrator, pulling in every CLI command plus shared infrastructure (`server/server.ts`, `agent/agent.ts`, `session/session.ts`, `provider/provider.ts`). The server entry point is leaner but delegates to ~20 handler groups under `server/routes/instance/httpapi/handlers/`.

### 1b. Dependency Tree Overlap

Both `index.ts` and `server/server.ts` share substantial infrastructure:

- `core/src/global.ts`, `core/src/schema.ts`, `core/src/filesystem.ts`
- `session/session.ts`, `session/session.sql.ts`, `session/prompt.ts`
- `agent/agent.ts`, `provider/provider.ts`, `provider/schema.ts`

The TUI entry (`cli/cmd/tui/app.tsx`) has **zero** compile-time paths to both `index.ts` and `server/server.ts`. It is launched dynamically via `AttachCommand` / `TuiThreadCommand` and communicates through the server's HTTP API or shared services.

### 1c. Import Cycles

**Total: 12 cycles**

| Cycle                                                                                      | Files | Severity                                 |
| ------------------------------------------------------------------------------------------ | ----- | ---------------------------------------- |
| `sdk/js/src/gen/client/utils.gen.ts` ↔ `types.gen.ts`                                      | 2     | Benign (generated)                       |
| `sdk/js/src/v2/gen/client/utils.gen.ts` ↔ `types.gen.ts`                                   | 2     | Benign (generated)                       |
| `app/src/components/dialog-*`                                                              | 3     | Console app only                         |
| `app/src/context/global-sync/*`                                                            | 3     | Console app only                         |
| `console/app/src/routes/zen/util/provider/*`                                               | 4     | Console app only                         |
| `llm/src/route/transport/*`                                                                | 3     | SDK only                                 |
| **`session/message-v2.ts` ↔ `session/session.sql.ts`**                                     | 2     | **opencode core — needs review**         |
| `cli/cmd/tui/component/dialog-*`                                                           | 2     | TUI only                                 |
| `cli/cmd/tui/context/editor.ts` ↔ `editor-zed.ts`                                          | 2     | TUI only                                 |
| **`cli/cmd/tui/feature-plugins/system/*` + `sidebar/*` + `home/*` + `plugin/internal.ts`** | 10    | **TUI — largest cycle, refactor target** |
| **`provider/transform.ts` ↔ `provider/provider.ts`**                                       | 2     | **opencode core — tight coupling**       |
| `plugins/typegraph-mcp/disk-cache.ts` ↔ `builder.ts`                                       | 2     | Tooling only                             |

**Notable Finding:** The 10-file TUI cycle involves `feature-plugins/system/which-key.tsx`, `session-v2.tsx`, `plugins.tsx`, `sidebar/footer.tsx`, `sidebar/files.tsx`, `sidebar/todo.tsx`, `sidebar/lsp.tsx`, `sidebar/mcp.tsx`, `sidebar/context.tsx`, `home/tips.tsx`, `home/footer.tsx`, and `plugin/internal.ts`. This is a classic circular feature-plugin architecture where sidebar and system plugins mutually reference each other.

### 1d. Cross-Boundary Isolation

| From                  | To                    | Isolated?             |
| --------------------- | --------------------- | --------------------- |
| `agent/agent.ts`      | `server/server.ts`    | **Yes** (`null` path) |
| `session/session.ts`  | `cli/cmd/tui/app.tsx` | **Yes** (`null` path) |
| `v2/session.ts`       | `session/session.ts`  | **Yes** (`null` path) |
| `cli/cmd/tui/app.tsx` | `index.ts`            | **Yes** (`null` path) |

The TUI, server, and v2 session are compile-time isolated from each other and from the CLI root. This confirms the architecture supports independent deployment modes (CLI-only, server-only, TUI-only) despite sharing a monorepo.

---

## Phase 2: Module Anatomy

### 2a. High-Fanout Infrastructure Files

| File                     | Direct Dependents | Role                                                          |
| ------------------------ | ----------------- | ------------------------------------------------------------- |
| `core/src/global.ts`     | 79                | Global config/paths singleton                                 |
| `core/src/filesystem.ts` | 71                | File system abstraction                                       |
| `core/src/schema.ts`     | 62                | Effect schema primitives                                      |
| `session/session.sql.ts` | 15                | Database tables (Session, Message, Part, Todo, Permission)    |
| `agent/agent.ts`         | 28                | Agent service definition                                      |
| `server/server.ts`       | 29                | HTTP server composition root                                  |
| `provider/provider.ts`   | 0                 | Provider service (used via Effect layers, not direct imports) |

**Notable Finding:** `provider/provider.ts` has 0 direct dependents despite being a core domain service. This is because consumers access it through Effect's DI (`yield* Provider.Service`) rather than direct module imports. The `tool/registry.ts` (1 dependent) and `agent/agent.ts` (via layer composition) pull it in transitively.

### 2b. Module Exports — Service Pattern Consistency

Every service module follows the same shape:

```typescript
export interface Interface { ... }          // Type-only contract
export class Service extends Context.Service<...> { ... }  // Effect service
export const layer = Layer.effect(Service, ...)            // Testable layer
export const defaultLayer = layer.pipe(...)                // Composed defaults
export * as Foo from "."                                   // Namespace re-export
```

**Consistency check across 6 key services:**

| Module                       | Exports                                                     | Pattern Match             |
| ---------------------------- | ----------------------------------------------------------- | ------------------------- |
| `agent/agent.ts`             | 7 (Info, Interface, Service, layer, defaultLayer, Agent)    | ✅ Clean                  |
| `session/session.ts`         | 34 (Info, Interface, Service, layer, defaultLayer, Session) | ⚠️ Overstuffed (see Risk) |
| `session/prompt.ts`          | 13 (Interface, Service, layer, defaultLayer, SessionPrompt) | ✅ Clean                  |
| `session/llm.ts`             | 10 (Interface, Service, layer, defaultLayer, LLM)           | ✅ Clean                  |
| `provider/provider.ts`       | 19 (Model, Info, Interface, Service, Provider)              | ⚠️ Large (1700+ lines)    |
| `server/server.ts`           | 6 (Listener, Default, openapi, url, listen, Server)         | ✅ Lean composition root  |
| `control-plane/workspace.ts` | 20 (Info, Interface, Service, layer, Workspace)             | ✅ Moderate               |

### 2c. Module Boundaries — Isolation Scores

| Directory/Module                            | Isolation Score | Interpretation                                               |
| ------------------------------------------- | --------------- | ------------------------------------------------------------ |
| `tool/edit.ts, read.ts, write.ts, shell.ts` | **0.00**        | Pure consumers — all outgoing, no incoming (except registry) |
| `control-plane/workspace.ts`                | 0.059           | Tightly coupled to session, auth, sync                       |
| `project/project.ts, instance.ts`           | **0.02**        | Near-zero isolation — central plumbing                       |
| `bus/index.ts`                              | 0.095           | Event hub — many producers, few consumers                    |
| `mcp/index.ts`                              | 0.128           | Most isolated of sampled modules                             |
| `server/routes/instance/httpapi/*`          | **0.03**        | Server handlers — extremely coupled                          |
| `session/session.ts + llm.ts + prompt.ts`   | 0.10            | Session subsystem — internally coupled                       |
| `agent/agent.ts + provider/*`               | 0.08            | Agent/provider — moderate coupling                           |

**Interpretation:** The project is a classic tightly-coupled monolith. Directory boundaries do not provide encapsulation; the Effect layer system provides the actual abstraction boundary.

---

## Phase 3: Pattern Discovery

### 3a. Service Pattern Prevalence

The `Interface` + `Service` + `Layer` pattern is used **project-wide** across:

- `agent/agent.ts`
- `session/session.ts`, `session/prompt.ts`, `session/llm.ts`, `session/processor.ts`
- `provider/provider.ts`
- `control-plane/workspace.ts`
- `mcp/index.ts`, `mcp/auth.ts`
- `command/index.ts`
- `tool/registry.ts`
- `v2/session.ts`
- `project/project.ts`
- `bus/index.ts`, `bus/global.ts`

This is an **intentional, enforced convention** — not accidental.

### 3b. Test Layer Coverage

Every sampled service exports a `defaultLayer` (composed from `layer.pipe(...)`). Test files verify services through `Layer` composition rather than mocking interfaces directly. Evidence:

- `agent/agent.test.ts` tests `Agent.Service` via composed test layers
- `session/session.test.ts` tests `Session.Service` with real DB schema
- `server/httpapi-*.test.ts` tests server handlers through `ExperimentalHttpApiServer`
- `control-plane/workspace.test.ts` tests workspace with real SQLite

**No explicit `ServiceTest` exports were found** in the sampled modules. The project uses **integration-style tests with real schemas** rather than test doubles, consistent with AGENTS.md Rule 12 ("Never mock your own DB schema").

### 3c. Effect Runtime Patterns

- `makeRuntime` from `core/src/effect/runtime.ts` is used for service execution (7 dependents)
- `memoMap` from `core/src/effect/memo-map.ts` is the deduplication backbone (7 dependents)
- `InstanceState` pattern exists in `effect/instance-state.ts` for per-directory state
- `Effect.gen` is the standard composition pattern
- `Effect.fn` / `Effect.fnUntraced` used for named effects

---

## Phase 4: Dead Code Detection

### 4a. Orphan File Detection

Files with 0 dependents (non-test, non-entry-point) were not systematically enumerated in this pass, but key observations:

- `provider/provider.ts`: 0 direct dependents (but critical — used via DI)
- `tool/registry.ts`: 1 direct dependent (`test/tool/websearch.test.ts`)
- `data-migration.ts`, `data-migration.sql.ts`: likely dead after JSON migration completed
- `audio.d.ts`, `markdown.d.ts`, `sql.d.ts`: type declaration stubs — verify if still needed

### 4b. Dead Export Spot-Check

`session/session.ts` exports 34 symbols. Candidates for dead-export review:

- `listGlobal` — only used within `session/session.ts` itself? (needs `ts_references` check)
- `getUsage` — used internally, but verify external callers
- `Patch` type — verify all fields are consumed

`provider/provider.ts` exports 19 symbols including `fromModelsDevProvider`, `sort`, `parseModel`, `ModelNotFoundError`, `InitError`. These are likely consumed by provider-specific code but should be verified.

### 4c. Barrel File Audit

The project deliberately avoids barrel `index.ts` files in multi-sibling directories (per AGENTS.md). Single-namespace directories use `export * as Foo from "."` pattern. No stale re-exports detected in the barrel files examined.

---

## Phase 5: Domain Topology

### 5a. Entity Identification

| Entity         | Primary File                 | Schema                                                                                                            | Service                |
| -------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **Session**    | `session/session.ts`         | `session/session.sql.ts` (SessionTable, MessageTable, PartTable, TodoTable, PermissionTable, SessionMessageTable) | `Session.Service`      |
| **Agent**      | `agent/agent.ts`             | `agent/agent.ts` (Info schema)                                                                                    | `Agent.Service`        |
| **Provider**   | `provider/provider.ts`       | `provider/provider.ts` (Model, Info)                                                                              | `Provider.Service`     |
| **Workspace**  | `control-plane/workspace.ts` | `control-plane/workspace.sql.ts`                                                                                  | `Workspace.Service`    |
| **Project**    | `project/project.ts`         | `project/project.sql.ts`                                                                                          | `Project.Service`      |
| **MCP**        | `mcp/index.ts`               | `mcp/auth.ts`, `mcp/oauth-provider.ts`                                                                            | `MCP.Service`          |
| **Command**    | `command/index.ts`           | `command/index.ts` (Info, Event)                                                                                  | `Command.Service`      |
| **Tool**       | `tool/registry.ts`           | `tool/schema.ts`                                                                                                  | `ToolRegistry.Service` |
| **V2 Session** | `v2/session.ts`              | `v2/schema.ts`                                                                                                    | `SessionV2.Service`    |

### 5b. Entity Relationships

```
Session ←→ Agent (session.prompt.ts uses Agent.Service)
Session ←→ Provider (session.prompt.ts uses Provider.Service)
Session ←→ MCP (session.prompt.ts uses MCP.Service)
Session ←→ Bus (session.prompt.ts publishes Bus events)
Session ←→ Workspace (workspace.ts queries SessionTable)
Session ←→ Project (project.ts updates SessionTable)
Session ←→ LLM (session.llm.ts uses Provider for streaming)
Agent  ←→ Provider (agent.agent.ts uses Provider.Service)
Agent  ←→ Skill (agent.agent.ts uses Skill.Service)
Agent  ←→ Auth (agent.agent.ts uses Auth.Service)
Server → Session (httpapi handlers use Session.Service)
Server → Agent (httpapi handlers use Agent.Service)
Server → Provider (httpapi handlers use Provider.Service)
```

### 5c. Domain Boundary Verification

| Domain A       | Domain B       | Coupling Path                                    |
| -------------- | -------------- | ------------------------------------------------ |
| Session        | Agent          | Via `session/prompt.ts` → `agent/agent.ts`       |
| Session        | Provider       | Via `session/prompt.ts` → `provider/provider.ts` |
| Session        | MCP            | Via `session/prompt.ts` → `mcp/index.ts`         |
| Agent          | Provider       | Via `agent/agent.ts` → `provider/provider.ts`    |
| Server         | Session        | Via HTTP handlers → `session/session.ts`         |
| **V2 Session** | **V1 Session** | **None (isolated)**                              |

**Notable Finding:** The V2 session module (`v2/session.ts`) has **zero** compile-time coupling to the V1 session module. It is a fully independent implementation with its own schema (`v2/schema.ts`) and service (`SessionV2.Service`), depending only on `SyncEvent.Service`. This is a textbook Strangler Fig setup.

### 5d. Blast Radius

| Symbol          | Files Affected                             | Risk Level   |
| --------------- | ------------------------------------------ | ------------ |
| `SessionTable`  | 147 references, 15 dependents              | **Critical** |
| `ProjectID`     | 12 dependents on `project/schema.ts`       | High         |
| `ProviderID`    | Used across agent, session, provider, tool | High         |
| `Workspace`     | 7 direct callers                           | High         |
| `Agent`         | 28 direct dependents                       | High         |
| `Bus`           | 26 direct dependents                       | High         |
| `AppFileSystem` | 71 direct dependents                       | **Critical** |

---

## Phase 6: Runtime Behavior Approximation

### 6a. Request Flow Tracing

**HTTP → Session → LLM → Provider chain:**

1. `server/routes/instance/httpapi/handlers/session.ts` receives HTTP request
2. Delegates to `session/session.ts` (Session.Service)
3. For LLM operations, `session/prompt.ts` (SessionPrompt.Service) composes Agent + Provider + LLM
4. `session/llm.ts` (LLM.Service) streams from `Provider.Service`
5. Provider implementation (`provider/provider.ts`) resolves model and calls external API

**TUI Run chain:**

1. `cli/cmd/run.ts` → `runtime.ts` → `runtime.boot.ts`
2. Boots `SessionPrompt.Service` with Agent + Provider + ToolRegistry
3. `tool/registry.ts` composes ToolRegistry with 12+ tool services
4. Shell execution flows through `tool/shell.ts` → `tool/shell/execute.ts`

### 6b. Layer Composition

The `session/prompt.ts` layer is the most complex composition point:

```typescript
layer: Layer.Layer<Service, never, Session.Service | Agent.Service | Config.Service | Provider.Service | Plugin.Service | Bus.Service | ... 17 more ...>
```

This confirms `SessionPrompt` is the **runtime orchestrator** — it wires together the entire agent execution pipeline.

### 6c. Service Implementation Mapping

| Service       | Interface                    | Live Impl       | Test Support                |
| ------------- | ---------------------------- | --------------- | --------------------------- |
| Agent         | `agent/agent.ts`             | `Service` class | Integration tests           |
| Session       | `session/session.ts`         | `Service` class | Integration tests (real DB) |
| SessionPrompt | `session/prompt.ts`          | `Service` class | Integration tests           |
| LLM           | `session/llm.ts`             | `Service` class | Integration tests           |
| Provider      | `provider/provider.ts`       | `Service` class | Unit + integration          |
| Workspace     | `control-plane/workspace.ts` | `Service` class | Integration tests           |
| ToolRegistry  | `tool/registry.ts`           | `Service` class | Per-tool integration tests  |

No `ServiceTest` or `ServiceLive` naming convention was detected. The project uses **single service class with composed test layers** at the call site.

### 6d. Async / Event-Driven Flows

- **Bus** (`bus/index.ts`): Central event bus with 26 direct dependents. Publishes session.created, session.updated, command.executed, workspace events, etc.
- **SyncEvent** (`sync/schema.ts`): Cross-instance sync events
- **Projectors** (`session/projectors.ts`, `session/projectors-next.ts`): Event-sourced state projections
- **WebSocket tracking** (`server/routes/instance/httpapi/websocket-tracker.ts`): Real-time client updates
- **Compaction** (`session/compaction.ts`): Background session compaction triggered by Bus events
- **FiberMap usage** in `control-plane/workspace.ts`: Per-workspace background fibers for sync operations

### 6e. Feature Flags

No feature flag framework was detected. Conditional behavior uses:

- `Flag` service from `core/src/flag/flag.ts` (referenced by 10+ modules)
- Direct `process.env` checks (e.g., `OPENCODE_PURE`, `OPENCODE_PID`)
- Provider capability checks (e.g., `webSearchEnabled` in `tool/registry.ts`)

---

## Phase 7: Risk Assessment

### 7a. Blast Radius Ranking (Top 5)

| Rank | Symbol          | Files Affected                  | Change Risk                                             |
| ---- | --------------- | ------------------------------- | ------------------------------------------------------- |
| 1    | `SessionTable`  | 147 references                  | **Extreme** — schema change cascades to 15+ modules     |
| 2    | `AppFileSystem` | 71 dependents                   | **Extreme** — every file operation touches this         |
| 3    | `Global`        | 79 dependents                   | **Extreme** — paths/config singleton                    |
| 4    | `Agent`         | 28 dependents                   | **High** — agent config used across CLI, session, tools |
| 5    | `Server`        | 29 dependents (all tests + CLI) | **High** — server composition root                      |

### 7b. Dependency Inversion Check

| Interface             | Dependents Point To                          | Inverted?                           |
| --------------------- | -------------------------------------------- | ----------------------------------- |
| `Agent.Interface`     | `agent/agent.ts` (Service class)             | ✅ Yes (via `yield* Agent.Service`) |
| `Session.Interface`   | `session/session.ts` (Service class)         | ✅ Yes                              |
| `Provider.Interface`  | `provider/provider.ts` (Service class)       | ✅ Yes                              |
| `Workspace.Interface` | `control-plane/workspace.ts` (Service class) | ✅ Yes                              |
| `AppFileSystem`       | `core/src/filesystem.ts` (interface)         | ✅ Yes (interface file)             |

**Conclusion:** The system properly inverts dependencies through Effect's `Context.Service` pattern. Consumers depend on interfaces, not implementations. The highest risk is changing the **schema** (database tables), which bypasses DI entirely.

### 7c. Change Propagation Preview

**Scenario: Renaming `SessionTable.workspace_id` column**

1. **Blast radius**: 147 references across 15+ files
2. **File-level impact**: `session/session.sql.ts`, `session/session.ts`, `session/prompt.ts`, `control-plane/workspace.ts`, `project/project.ts`, `server/projectors.ts`, `v2/session.ts`, `storage/json-migration.ts`, `share/share.sql.ts`
3. **Module boundary**: Breaks `session/`, `control-plane/`, `project/`, `server/`, `v2/`, `storage/` boundaries simultaneously

**Recommendation:** Use a migration + deprecation strategy. Add new column, update writers, update readers, remove old column — over 3 releases.

---

## Appendix: Raw Data

<details>
<summary>Phase 1: Entry Point Dependency Trees (node counts)</summary>

- `src/index.ts`: 78 nodes
- `src/server/server.ts`: 43 nodes
- `src/agent/agent.ts`: 7 nodes (direct)
- `src/session/prompt.ts`: 28 nodes (direct)
- `src/session/llm.ts`: 4 nodes (direct)

</details>

<details>
<summary>Phase 1: Import Cycles (12 total)</summary>

1. `sdk/js/src/gen/client/utils.gen.ts` ↔ `types.gen.ts`
2. `sdk/js/src/v2/gen/client/utils.gen.ts` ↔ `types.gen.ts`
3. `app/src/components/dialog-custom-provider.tsx` ↔ `dialog-select-provider.tsx` ↔ `dialog-connect-provider.tsx`
4. `app/src/context/global-sync/child-store.ts` ↔ `bootstrap.ts` ↔ `global-sync.tsx`
5. `console/app/src/routes/zen/util/provider/openai-compatible.ts` ↔ `openai.ts` ↔ `provider.ts` ↔ `anthropic.ts`
6. `llm/src/route/transport/http.ts` ↔ `websocket.ts` ↔ `index.ts`
7. `opencode/src/session/message-v2.ts` ↔ `session/session.sql.ts`
8. `opencode/src/cli/cmd/tui/component/dialog-model.tsx` ↔ `dialog-provider.tsx`
9. `opencode/src/cli/cmd/tui/context/editor.ts` ↔ `editor-zed.ts`
10. `opencode/src/cli/cmd/tui/feature-plugins/system/which-key.tsx` ↔ `session-v2.tsx` ↔ `plugins.tsx` ↔ `sidebar/footer.tsx` ↔ `sidebar/files.tsx` ↔ `sidebar/todo.tsx` ↔ `sidebar/lsp.tsx` ↔ `sidebar/mcp.tsx` ↔ `sidebar/context.tsx` ↔ `home/tips.tsx` ↔ `home/footer.tsx` ↔ `plugin/internal.ts`
11. `opencode/src/provider/transform.ts` ↔ `provider/provider.ts`
12. `plugins/typegraph-mcp/disk-cache.ts` ↔ `builder.ts`

</details>

<details>
<summary>Phase 2: High-Fanout File Dependents</summary>

- `core/src/schema.ts`: 62 direct dependents
- `core/src/global.ts`: 79 direct dependents
- `core/src/filesystem.ts`: 71 direct dependents
- `session/session.sql.ts`: 15 direct dependents, 147 total references
- `agent/agent.ts`: 28 direct dependents
- `server/server.ts`: 29 direct dependents (25 test files + 4 CLI commands + plugin)
- `provider/provider.ts`: 0 direct dependents (used via DI)

</details>

<details>
<summary>Phase 5: SessionTable Blast Radius (Top 20 callers)</summary>

1. `session/session.sql.ts` — self-referential FK definitions
2. `session/session.ts` — CRUD operations
3. `session/prompt.ts` — model/agent lookup
4. `share/share.sql.ts` — FK reference
5. `control-plane/workspace.ts` — workspace-session joins
6. `session/projectors-next.ts` — state projection
7. `session/projectors.ts` — event-sourced writes
8. `server/projectors.ts` — server-side reads
9. `v2/session.ts` — V2 API implementation
10. `session/message-v2.ts` — message validation
11. `project/project.ts` — project-session sync
12. `cli/cmd/stats.ts` — stats CLI
13. `cli/cmd/import.ts` — import CLI
14. `storage/json-migration.ts` — legacy migration
15. `storage/schema.ts` — schema re-export
    Plus 6 test files.

</details>
