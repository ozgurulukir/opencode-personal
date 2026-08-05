# CLI

## `effectCmd` error handling

`effectCmd` expects handlers to return `Effect<void, CliError, ...>`. Use `fail()` from `effect-cmd` for user-visible errors; `Effect.fail(new Error(...))` fails typecheck.
