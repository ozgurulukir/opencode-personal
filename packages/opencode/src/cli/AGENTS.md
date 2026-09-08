# CLI

## Session event consumers

`cmd/run/AGENTS.md` documents the run command's V2-to-legacy reducer boundary.
The in-workspace GitHub command (`cmd/github.ts`) starts prompts through the
shared `SessionPrompt.Service` compatibility facade but observes
`SessionEvent.*.Sync` for tool and text output. Keep those responsibilities
separate: prompt invocation compatibility does not justify subscribing to the
old `MessageV2.Event.PartUpdated` stream.

## `effectCmd` error handling

`effectCmd` expects handlers to return `Effect<void, CliError, ...>`. Use `fail()` from `effect-cmd` for user-visible errors; `Effect.fail(new Error(...))` fails typecheck.
