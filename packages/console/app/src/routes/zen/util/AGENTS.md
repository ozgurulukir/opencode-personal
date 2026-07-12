# Zen API Util — Architecture & Testing Notes

## SST Resource Access

- `billing.ts`, `reload.ts`, `usage.ts` import `@opencode-ai/console-core/lite.js` which accesses SST resources at **module load time**. `BlackData.getLimits()` and `Subscription.analyzeWeeklyUsage()` trigger SST at **call time**. Tests mock these 3 modules via `mock.module()` with `afterAll(() => mock.restore())`.
- `setup.ts` uses **type-only imports** (`import type`) for all dependencies to avoid SST side-effects on module load. `handler.ts` imports real implementations and passes them as deps.

## Deps Injection Pattern

- `retry.ts`, `setup.ts`, `response.ts`, `handler.ts` accept functions as deps (optional with `??` defaults to real implementations) for testability without SST/DB. Example: `RetryDeps` includes optional `selectProvider`, `validateModelSettings`, `fetchWith429Retry` etc.
- `handler()` accepts an optional 3rd parameter `deps?: HandlerDeps` for injecting mid-level functions (parseRequest, setupRequest, executeRetriableRequest, response handlers). This enables integration tests without `mock.module`.

## Provider Response Conversion

- `createResponseConverter(from, to)` produces a **new object** and drops unknown fields. `cost` and `error.message` prefix must be applied **after** conversion, not before — otherwise they are lost when formats differ.
- `fromAnthropicResponse` has an early return: if the response has a `choices` array (OpenAI format), it returns as-is without conversion. Tests for format conversion must use real Anthropic-shaped input (`type: "message"`, `content: [{ type: "text", text: ... }]`), not OpenAI-shaped input.

## AuthInfo Type

- `AuthInfo` interface is defined in `auth.ts` and used across all zen/util modules. Replaced the former `Record<string, any>` in `billing.ts`. `authInfo as any` casts are fully eliminated.
- `usage.ts` and `reload.ts` accept `AuthInfo | undefined` but use `const info = authInfo!` after the anonymous/balance guard check — these functions are only called when authInfo is defined.

## Billing Logic

- `billing.ts` uses a `limited` flag pattern instead of try/catch: when a limit is exceeded with `useBalance=true`, sets `limited=true` and skips remaining checks, falling through to the next billing source. This fixed a bug in the original try/catch where `useBalance=true` + fixed limit exceeded + rolling limit OK would incorrectly return "subscription".
