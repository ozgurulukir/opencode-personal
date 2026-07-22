# CLI Effect Prompt Wrapper

## `@clack/prompts` spinner API

The project uses `@clack/prompts@1.7.0` (stable). `spinner.error(msg)` exists and shows a red error icon. The `stop(msg, code)` signature was simplified to `stop(msg?)` — the `code` parameter is no longer used. The wrapper in `prompt.ts` maps `stop(msg, code)` truthy to `s.error(msg)` and falsy to `s.stop(msg)`.

**Stale node_modules gotcha**: If `tsgo` reports `Property 'error' does not exist on type 'SpinnerResult'`, the installed version is likely the old `1.0.0-alpha.1` (which removed `.error()`) instead of `1.7.0`. Verify with `node -e "require('@clack/prompts/package.json').version"`. If stale, remove `node_modules/.bun/@clack+prompts@1.0.0-alpha.1/` and run `bun install`.
