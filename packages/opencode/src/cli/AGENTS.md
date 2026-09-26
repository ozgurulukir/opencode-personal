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

## Unknown commands are project paths

A subcommand that doesn't exist is NOT rejected as "unknown command" — it is parsed as the `opencode [project]` positional. After removing a CLI subcommand (e.g. `upgrade`), `opencode <word>` fails with `Error: Failed to change directory to <cwd>\<word>` because it tries to start in a directory named `<word>`. Removing a command also requires deleting its `.command(...)` entry in `src/index.ts`; there is no dynamic/auto command registration.
