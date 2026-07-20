# CLI Run Module Architecture

## Module Organization

The `cli/cmd/run/` directory follows a **layered architecture**:

```
cli/cmd/run/
├── event-loop.ts          # Event loop orchestrator (imports handlers)
├── session-data.ts        # Reducer orchestrator (imports handlers)
├── stream.ts              # Stream transport (imports reducers)
├── stream.transport.ts    # Low-level transport (imports stream.ts)
├── *.shared.ts            # Pure state machines (no imports from above)
├── session-data/
│   ├── handlers/*.ts      # Event-specific handlers (pure, no side effects)
│   ├── utils.ts           # Shared utilities (pure functions)
│   └── types.ts           # Type definitions
└── types.ts               # Public type exports
```

## Dependency Rules

1. **`.shared.ts` files** import ONLY from:
   - Other `.shared.ts` files
   - `types.ts`
   - External libraries (no internal imports)

2. **Handler files** (`session-data/handlers/*.ts`) import ONLY from:
   - `../utils.ts`
   - `../types.ts`
   - External libraries

3. **Orchestrator files** (`event-loop.ts`, `session-data.ts`) import:
   - Handlers
   - Utils
   - Types

4. **Transport files** (`stream.ts`, `stream.transport.ts`) import:
   - Orchestrators
   - Types
   - NEVER import handlers directly

## Handler Signature Pattern

All event handlers follow this signature:

```ts
export function handleEventName(
  data: SessionData,      // mutated in-place
  event: SpecificEvent,   // typed event
  sessionID: string,      // filter context
  ...options              // thinking, limits, etc.
): SessionDataOutput | undefined  // undefined = no footer update
```

**Key constraints:**
- Handlers **MUST NOT** call footer APIs directly
- Handlers **MUST NOT** perform IO (filesystem, network)
- Handlers **MUST** return `undefined` if no footer update is needed
- Handlers **MAY** mutate `data.maps` and `data.lists` in-place

## Testing Strategy

### Unit Tests (handlers, utils)
- Import functions directly
- Construct minimal `SessionData` via `createSessionData()`
- Assert on returned `SessionDataOutput`
- No mocks needed (pure functions)

### Characterization Tests (private functions)
- Test internal functions before refactoring
- Lock down behavior with exhaustive edge cases
- Name: `*.characterization.test.ts`

### Integration Tests (event loop, transport)
- Use `makeCtx()` helper to construct `LoopContext`
- Mock `client`, `emit`, `tool` as needed
- Use `asyncStream()` to wrap event arrays

## Refactoring Precedents

### Phase 2 — State Machine Decomposition

`session-data.ts` was decomposed from 967 → 81 lines via 8-phase extraction:

1. Extract types to `types.ts`
2. Extract 26 utils to `utils.ts`
3. Extract `session.error` handler
4. Extract `permission.*` and `question.*` handlers
5. Extract `message.part.delta` handler
6. Extract `message.part.updated` handler (largest, ~200 lines)
7. Extract `message.updated` handler
8. Clean up to thin orchestrator

**Key insight:** All 88 characterization tests passed without modification because the public API (`reduceSessionData`, `createSessionData`) remained in `session-data.ts`.

### Phase 1 — Event Loop Extraction

`run.ts` event loop was extracted from 122 → 6 handler functions:

- `handleMessageUpdated` — prints agent/model info
- `handleToolPart` — handles tool completed/error, task running, step events
- `handleSessionError` — extracts and accumulates error messages
- `handleSessionStatus` — checks for idle status to break the loop
- `handlePermissionAsked` — auto-rejects or auto-approves permissions
- `loop` — orchestrator that dispatches events to handlers

**Key insight:** `LoopContext` interface encapsulates all closure-captured dependencies, making handlers testable without mocking the entire `run.ts` module.

### Phase 0 — Characterization Tests

Before any refactoring, 146 characterization tests were written:

- `event-loop.characterization.test.ts` — event flow, permission scenarios
- `session-data.characterization.test.ts` — 88 behaviors across 12 categories
- `footer.characterization.test.ts` — history, autocomplete, submit flows

**Key insight:** Characterization tests lock behavior BEFORE extraction, eliminating regression risk and enabling confident refactoring.
